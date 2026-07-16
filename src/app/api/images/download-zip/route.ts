// 다중 이미지 ZIP 다운로드.
//
// 보안 원칙 (P2a — /library 만 사용):
//   1) 클라이언트가 넘긴 ids 를 절대 그대로 신뢰하지 않는다.
//   2) scope 별로 SELECT 시 사용자의 접근 가능 조건을 강제한다.
//        - library:  user_id = auth.uid()      (본인 소유 이미지)
//        - community: is_public = TRUE          (P2b 에서 활용)
//   3) 요청 개수와 실제 조회 결과 개수가 다르면 → 403.
//   4) 최대 이미지 개수 / 총 용량 초과 시 → 실패.
//   5) 서버가 알고 있는 r2_key 만 fetch (경로 인젝션 차단).
//
// 스트리밍:
//   Node.js archiver 로 zip 을 스트림으로 만들어 응답 body 에 그대로 pipe 한다.
//   전체 zip 을 메모리에 로드하지 않아 Railway 컨테이너 메모리에 안전.

export const runtime = 'nodejs';
export const maxDuration = 300;

import { Readable } from 'node:stream';
import { z } from 'zod';

// archiver 는 CommonJS 함수 export (`module.exports = function archiver(...)`).
// @types/archiver 는 default callable signature 를 노출하지 않는 데다,
// Next.js 의 serverComponentsExternalPackages 로 external 처리하면 default
// import shim 이 붙지 않아 런타임에 함수가 아닌 { default: fn } 로 잡힐 수도
// 있다. 두 형태 모두 안전하게 대응.
import * as archiverImport from 'archiver';
import type { Archiver, ArchiverOptions } from 'archiver';

type ArchiverFactory = (
  format: 'zip' | 'tar' | 'json',
  options?: ArchiverOptions,
) => Archiver;

const createArchive: ArchiverFactory =
  typeof archiverImport === 'function'
    ? (archiverImport as unknown as ArchiverFactory)
    : (archiverImport as unknown as { default: ArchiverFactory }).default;

import { apiError } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const MAX_IMAGES = 50;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300 MB

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IMAGES),
  scope: z.enum(['library', 'community']),
});

interface ImageRow {
  id: string;
  r2_key: string;
  user_id: string;
  is_public: boolean;
  status: string;
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return apiError(
      'VALIDATION_ERROR',
      `요청 형식이 올바르지 않아요 (최대 ${MAX_IMAGES}장).`,
    );
  }

  // Scope 별 SELECT 조건을 서버가 강제. RLS 도 함께 필터해주지만 계층 방어 목적으로 명시.
  let query = supabase
    .from('images')
    .select('id, r2_key, user_id, is_public, status');

  if (body.scope === 'library') {
    query = query.eq('user_id', user.id);
  } else {
    query = query.eq('is_public', true);
  }
  query = query.in('id', body.ids);

  const { data, error } = await query;
  if (error) {
    console.error('[download-zip] query error', error);
    return apiError('INTERNAL_ERROR', '이미지 조회 실패');
  }

  const rows = (data ?? []) as ImageRow[];
  if (rows.length !== body.ids.length) {
    return apiError('FORBIDDEN', '권한이 없는 이미지가 포함돼 있어요');
  }

  // library scope 는 status='saved' 만 다운로드 허용 (개별 download 라우트와 동일 정책).
  if (body.scope === 'library') {
    const notSaved = rows.filter((r) => r.status !== 'saved');
    if (notSaved.length > 0) {
      return apiError(
        'VALIDATION_ERROR',
        '저장 완료된 이미지만 다운로드할 수 있어요',
      );
    }
  }

  // download_events 는 백그라운드로 로깅 (실패해도 다운로드는 진행).
  const service = createSupabaseServiceClient();
  const eventRows = rows.map((r) => ({
    user_id: user.id,
    image_id: r.id,
    event_type: 'download' as const,
  }));
  void service
    .from('download_events')
    .insert(eventRows)
    .then((res) => {
      if (res.error) {
        console.error('[download-zip] download_events insert failed', res.error);
      }
    });

  // archiver 스트림 준비. 응답 시작 후 백그라운드로 각 이미지를 순차 fetch + append.
  const archive: Archiver = createArchive('zip', { zlib: { level: 6 } });

  archive.on('warning', (err: Error) => {
    console.warn('[download-zip] archiver warning', err);
  });
  archive.on('error', (err: Error) => {
    console.error('[download-zip] archiver error', err);
  });

  // R2 fetch → append → finalize 를 별도 태스크로 실행.
  // 총 용량 초과 시 archive.abort() 로 스트림 조기 종료.
  void (async () => {
    let totalBytes = 0;
    try {
      for (const row of rows) {
        const key = row.r2_key;
        const url = publicUrl(key);
        const res = await fetch(url);
        if (!res.ok || !res.body) {
          console.error('[download-zip] R2 fetch failed', key, res.status);
          archive.abort();
          return;
        }
        const contentLength = res.headers.get('content-length');
        if (contentLength) {
          totalBytes += Number(contentLength);
          if (totalBytes > MAX_TOTAL_BYTES) {
            console.error('[download-zip] total size exceeded', totalBytes);
            archive.abort();
            return;
          }
        }
        const ext = key.split('.').pop()?.toLowerCase() ?? 'png';
        const safeExt = ext === 'webp' ? 'webp' : 'png';
        const nodeStream = Readable.fromWeb(
          res.body as unknown as import('node:stream/web').ReadableStream,
        );
        archive.append(nodeStream, { name: `${row.id}.${safeExt}` });
      }
      await archive.finalize();
    } catch (err) {
      console.error('[download-zip] pipeline error', err);
      try {
        archive.abort();
      } catch {
        // ignore
      }
    }
  })();

  const today = new Date().toISOString().slice(0, 10);
  const filename = `clipart-studio-${today}-${rows.length}장.zip`;
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

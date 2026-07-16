// 다중 이미지 ZIP 다운로드.
//
// 보안 원칙 (P2a — /library 만 사용, P2b 에서 /community 확장):
//   1) 클라이언트가 넘긴 ids 를 절대 그대로 신뢰하지 않는다.
//   2) scope 별로 SELECT 시 사용자의 접근 가능 조건을 강제한다.
//        - library:  user_id = auth.uid()      (본인 소유 이미지)
//        - community: is_on_community = TRUE   (Community 페이지 노출 이미지)
//   3) 요청 개수와 실제 조회 결과 개수가 다르면 → 403.
//   4) 최대 이미지 개수 / 총 용량 초과 시 → 실패.
//   5) 서버가 알고 있는 r2_key 만 fetch (경로 인젝션 차단).
//
// 압축 라이브러리:
//   JSZip. 순수 JS 라 Next.js webpack 과의 궁합 문제 없음. 스트리밍은 안 되고
//   전체 zip 을 메모리 버퍼로 만들므로 총 용량 상한을 100 MB 로 제한 —
//   Railway 512 MB 컨테이너에 안전한 수준.

export const runtime = 'nodejs';
export const maxDuration = 300;

import JSZip from 'jszip';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const MAX_IMAGES = 50;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB (메모리 버퍼링 안전선)

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IMAGES),
  scope: z.enum(['library', 'community']),
});

interface ImageRow {
  id: string;
  r2_key: string;
  user_id: string;
  is_on_community: boolean;
  status: string;
}

export async function POST(request: Request) {
  try {
    console.log('[download-zip] start', { nodeVersion: process.version });

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
    console.log('[download-zip] body ok', {
      scope: body.scope,
      ids: body.ids.length,
    });

    // Scope 별 SELECT 조건 강제 (RLS + 명시 조건의 이중 방어).
    let query = supabase
      .from('images')
      .select('id, r2_key, user_id, is_on_community, status');

    if (body.scope === 'library') {
      query = query.eq('user_id', user.id);
    } else {
      query = query.eq('is_on_community', true);
    }
    query = query.in('id', body.ids);

    const { data, error } = await query;
    if (error) {
      console.error('[download-zip] query error', error);
      return apiError('INTERNAL_ERROR', '이미지 조회 실패');
    }

    const rows = (data ?? []) as ImageRow[];
    console.log('[download-zip] rows fetched', {
      requested: body.ids.length,
      returned: rows.length,
    });
    if (rows.length !== body.ids.length) {
      return apiError('FORBIDDEN', '권한이 없는 이미지가 포함돼 있어요');
    }

    // library scope 는 status='saved' 만 다운로드 허용.
    if (body.scope === 'library') {
      const notSaved = rows.filter((r) => r.status !== 'saved');
      if (notSaved.length > 0) {
        return apiError(
          'VALIDATION_ERROR',
          '저장 완료된 이미지만 다운로드할 수 있어요',
        );
      }
    }

    // R2 이미지 순차 fetch 후 arrayBuffer 로 받아 JSZip 에 add.
    // 순차 처리로 메모리 스파이크 억제 + 상한 검사.
    const zip = new JSZip();
    let totalBytes = 0;
    for (const row of rows) {
      const key = row.r2_key;
      const url = publicUrl(key);
      const res = await fetch(url);
      if (!res.ok) {
        console.error('[download-zip] R2 fetch failed', key, res.status);
        return apiError('INTERNAL_ERROR', '이미지 파일을 가져오지 못했어요');
      }
      const buf = Buffer.from(await res.arrayBuffer());
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        console.error('[download-zip] total size exceeded', totalBytes);
        return apiError(
          'VALIDATION_ERROR',
          `총 용량이 상한(${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB)을 초과했어요. 이미지 수를 줄여주세요.`,
        );
      }
      const ext = key.split('.').pop()?.toLowerCase() ?? 'png';
      const safeExt = ext === 'webp' ? 'webp' : 'png';
      zip.file(`${row.id}.${safeExt}`, buf);
    }

    console.log('[download-zip] generating zip', { totalBytes, entries: rows.length });
    const zipArrayBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    console.log('[download-zip] zip ready', { zipSize: zipArrayBuffer.byteLength });

    // download_events 는 백그라운드 로깅 (실패해도 응답에는 영향 없음).
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

    const today = new Date().toISOString().slice(0, 10);
    const filename = `clipart-studio-${today}-${rows.length}장.zip`;

    // ArrayBuffer 를 Blob 으로 wrap 해서 Web Response body 로 전달.
    const responseBody = new Blob([zipArrayBuffer], { type: 'application/zip' });
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(zipArrayBuffer.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[download-zip] fatal', err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return apiError('INTERNAL_ERROR', `ZIP 생성 실패 — ${message}`);
  }
}

// Organization library ZIP download (P5-C Phase B-2).
//
// POST /api/organizations/[slug]/download-zip
//   body: { imageIds: string[] }
//
// 보안:
//   - 요청자가 조직의 active 멤버여야 한다.
//   - 요청 imageIds 중 이 조직에 실제 공유된 (image_organization_shares) 것만
//     조회. 요청 개수와 다르면 403.
//   - 개수·용량 상한은 개인 라이브러리 다운로드와 동일 규칙 재사용.

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
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB

const bodySchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(MAX_IMAGES),
});

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
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

    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', params.slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
    const orgId = (org as { id: string }).id;

    const { data: me } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!me) return apiError('FORBIDDEN', '조직 멤버만 다운로드할 수 있어요');

    // shares 관계로 검증 + 실제 이미지 메타 조회. service role 로 조회해서
    // RLS 우회 (요청자가 조직 멤버임은 위에서 확인).
    const service = createSupabaseServiceClient();
    const { data: shareRows, error } = await service
      .from('image_organization_shares')
      .select('image_id, images!inner(id, r2_key, status)')
      .eq('organization_id', orgId)
      .in('image_id', body.imageIds);

    if (error) {
      console.error('[org download-zip] query error', error);
      return apiError('INTERNAL_ERROR', '이미지 조회 실패');
    }

    const rows = (shareRows ?? []).map((r) => {
      const row = r as unknown as {
        image_id: string;
        images: { id: string; r2_key: string; status: string };
      };
      return row.images;
    });

    if (rows.length !== body.imageIds.length) {
      return apiError(
        'FORBIDDEN',
        '이 조직에 공유되지 않은 이미지가 포함돼 있어요',
      );
    }

    const notSaved = rows.filter((r) => r.status !== 'saved');
    if (notSaved.length > 0) {
      return apiError(
        'VALIDATION_ERROR',
        '저장 완료된 이미지만 다운로드할 수 있어요',
      );
    }

    const zip = new JSZip();
    let totalBytes = 0;
    for (const row of rows) {
      const key = row.r2_key;
      const url = publicUrl(key);
      const res = await fetch(url);
      if (!res.ok) {
        console.error('[org download-zip] R2 fetch failed', key, res.status);
        return apiError('INTERNAL_ERROR', '이미지 파일을 가져오지 못했어요');
      }
      const buf = Buffer.from(await res.arrayBuffer());
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return apiError(
          'VALIDATION_ERROR',
          `총 용량이 상한(${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB)을 초과했어요. 이미지 수를 줄여주세요.`,
        );
      }
      const ext = key.split('.').pop()?.toLowerCase() ?? 'png';
      const safeExt = ext === 'webp' ? 'webp' : 'png';
      zip.file(`${row.id}.${safeExt}`, buf);
    }

    const zipArrayBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // download_events 기록 (백그라운드 — 실패해도 다운로드 응답에는 영향 없음).
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
          console.error('[org download-zip] download_events insert failed', res.error);
        }
      });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `${params.slug}-${today}-${rows.length}장.zip`;

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
    console.error('[org download-zip] fatal', err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return apiError('INTERNAL_ERROR', `ZIP 생성 실패 — ${message}`);
  }
}

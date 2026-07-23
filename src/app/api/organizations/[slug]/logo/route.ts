// Organization logo upload (P5-D-B).
//
// POST — owner 만. FormData(file). sharp 로 정규화 후 R2 put + organizations.avatar_url 갱신.
//   업로드 성공 시 기존 avatar_url 이 R2 키 형태였다면 옛 파일 삭제.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';

import { apiError, apiOk } from '@/lib/api-error';
import { deleteObject, publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
]);

interface NormalizedReference {
  bytes: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

async function loadContext(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id, avatar_url')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, prevUrl: null, role: null as OrganizationRole | null };
  const orgRow = org as { id: string; avatar_url: string | null };

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgRow.id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return {
    orgId: orgRow.id,
    prevUrl: orgRow.avatar_url,
    role: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

// avatar_url 이 우리 R2 도메인 아래 파일이라면 이전 파일 지우기 위한 키 추출.
function extractR2Key(url: string | null): string | null {
  if (!url) return null;
  const base = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base || !url.startsWith(base)) return null;
  try {
    return decodeURI(url.slice(base.length + 1));
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, prevUrl, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 로고를 변경할 수 있어요');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('VALIDATION_ERROR', '이미지 업로드 형식이 아닙니다');
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'file 필드가 필요합니다');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return apiError('VALIDATION_ERROR', '이미지 크기가 너무 커요 (5MB 이하)');
  }
  if (file.type && !ACCEPTED_MIME.has(file.type)) {
    return apiError('VALIDATION_ERROR', '지원하지 않는 이미지 형식이에요');
  }

  const rawBytes = Buffer.from(await file.arrayBuffer());

  let normalized: NormalizedReference;
  try {
    const { normalizeReferenceImage } = await import('@/services/image-gen/normalize');
    normalized = await normalizeReferenceImage(rawBytes);
  } catch (err) {
    console.error('[org logo] normalize failed', err);
    return apiError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : '이미지 변환에 실패했어요',
    );
  }

  const key = `org-logos/${orgId}/${randomUUID()}.png`;

  try {
    await putObject({
      key,
      body: normalized.bytes,
      contentType: normalized.contentType,
    });
  } catch (err) {
    console.error('[org logo] R2 put failed', err);
    return apiError('INTERNAL_ERROR', '이미지 저장에 실패했어요');
  }

  const newUrl = publicUrl(key);

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ avatar_url: newUrl })
    .eq('id', orgId);
  if (updateError) {
    console.error('[org logo] update error', updateError);
    await deleteObject(key).catch(() => {});
    return apiError('INTERNAL_ERROR', '로고 저장 실패');
  }

  // 이전 로고 파일이 우리 R2 관리 파일이면 정리 (외부 URL 이면 건드리지 않음).
  const prevKey = extractR2Key(prevUrl);
  if (prevKey && prevKey !== key) {
    await deleteObject(prevKey).catch((err) => {
      console.error('[org logo] prev delete failed', err);
    });
  }

  return apiOk({ avatarUrl: newUrl });
}

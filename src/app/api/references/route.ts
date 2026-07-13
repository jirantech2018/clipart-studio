// 참조 이미지 슬롯 — 계정당 최대 5개.
// POST: 사용자가 업로드한 이미지를 sharp로 정규화(PNG 재인코딩 + 리사이즈) 후
//       R2에 저장하고 reference_images 행을 만든다. DB 트리거가 5개 초과를 막는다.
// GET:  내 슬롯 목록을 최신순으로 돌려준다.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';

import { apiError, apiOk } from '@/lib/api-error';
// normalizeReferenceImage (sharp)는 POST에서만 필요하므로 handler 내부에서
// 동적으로 로드한다. 정적 import로 두면 sharp 로드 실패가 GET까지 500으로
//번지는 문제가 있었다.
import { publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { REFERENCE_IMAGE_SLOT_LIMIT } from '@/types/domain';

import type { NormalizedReference } from '@/services/image-gen/normalize';
import type { ReferenceImageSlot } from '@/types/domain';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 사용자 원본 상한 (정규화 전)
const ACCEPTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

interface Row {
  id: string;
  user_id: string;
  r2_key: string;
  filename: string | null;
  width: number;
  height: number;
  created_at: string;
}

function toSlot(row: Row): ReferenceImageSlot {
  return {
    id: row.id,
    userId: row.user_id,
    r2Key: row.r2_key,
    url: publicUrl(row.r2_key),
    filename: row.filename,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data, error } = await supabase
    .from('reference_images')
    .select('id, user_id, r2_key, filename, width, height, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return apiError('INTERNAL_ERROR', '참조 이미지를 불러오지 못했어요');

  const rows = (data ?? []) as Row[];
  return apiOk({
    slots: rows.map(toSlot),
    limit: REFERENCE_IMAGE_SLOT_LIMIT,
  });
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 미리 슬롯 개수 체크 (DB 트리거가 최종 방어)
  const { count: existing } = await supabase
    .from('reference_images')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((existing ?? 0) >= REFERENCE_IMAGE_SLOT_LIMIT) {
    return apiError('VALIDATION_ERROR', '참조 이미지 슬롯이 가득 찼어요. 하나를 삭제해주세요');
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
    return apiError('VALIDATION_ERROR', '이미지 크기가 너무 커요 (15MB 이하)');
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
    console.error('[references] normalize failed', err);
    return apiError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : '이미지 변환에 실패했어요',
    );
  }

  const id = randomUUID();
  const r2Key = `references/${user.id}/${id}.png`;

  try {
    await putObject({
      key: r2Key,
      body: normalized.bytes,
      contentType: normalized.contentType,
    });
  } catch (err) {
    console.error('[references] R2 put failed', err);
    return apiError('INTERNAL_ERROR', '이미지 저장에 실패했어요');
  }

  const { data, error } = await supabase
    .from('reference_images')
    .insert({
      id,
      user_id: user.id,
      r2_key: r2Key,
      filename: file.name || null,
      width: normalized.width,
      height: normalized.height,
    })
    .select('id, user_id, r2_key, filename, width, height, created_at')
    .single();

  if (error || !data) {
    // 트리거가 잡은 제한 위반이거나 알 수 없는 실패. R2 객체 롤백 시도.
    const { deleteObject } = await import('@/services/r2/upload');
    await deleteObject(r2Key).catch(() => {});
    const isLimit = error?.message?.includes('reference_image_limit_reached');
    return apiError(
      isLimit ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      isLimit
        ? '참조 이미지 슬롯이 가득 찼어요. 하나를 삭제해주세요'
        : '참조 이미지 저장 실패',
    );
  }

  return apiOk({ slot: toSlot(data as Row) }, 201);
}

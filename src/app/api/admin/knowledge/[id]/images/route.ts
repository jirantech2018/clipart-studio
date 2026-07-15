// Knowledge 에 참고 이미지 업로드. multipart form:
//   file             (필수)
//   reference_type   'positive' | 'negative' (기본 positive)
//   caption          (선택)
//   viewpoint        (선택)
//   is_primary       'true' | 'false' (기본 false)
//   sort_order       숫자 (기본 999)
//
// sharp 로 정규화 (기존 references 흐름 재사용) → PNG 재인코딩 + 리사이즈.
// R2 prefix: knowledge/{knowledge_id}/{image_id}.png
// DB trigger 가 positive 10 / negative 5 상한을 강제. 초과 시 400 반환.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { imageRowToDomain } from '@/services/knowledge';
import { putObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { ReferenceType } from '@/types/domain';

interface NormalizedReference {
  bytes: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: apiError('UNAUTHORIZED', '로그인이 필요합니다') } as const;
  }
  if (!isAdmin(user.email)) {
    return { error: apiError('FORBIDDEN', '관리자 전용 페이지입니다') } as const;
  }
  return { user } as const;
}

function parseBool(raw: FormDataEntryValue | null): boolean | undefined {
  if (raw === null) return undefined;
  const v = String(raw).toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function parseRefType(raw: FormDataEntryValue | null): ReferenceType | undefined {
  if (raw === null) return undefined;
  const v = String(raw).toLowerCase();
  if (v === 'positive' || v === 'negative') return v;
  return undefined;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();

  // Knowledge 존재 확인
  const { data: parent } = await service
    .from('knowledge')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();
  if (!parent) {
    return apiError('NOT_FOUND', 'Knowledge 를 찾을 수 없습니다');
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

  const referenceType = parseRefType(form.get('reference_type')) ?? 'positive';
  const caption = String(form.get('caption') ?? '').slice(0, 1000);
  const viewpoint = String(form.get('viewpoint') ?? '').slice(0, 100);
  const isPrimary = parseBool(form.get('is_primary')) ?? false;
  const sortOrderRaw = form.get('sort_order');
  const sortOrder =
    typeof sortOrderRaw === 'string' && sortOrderRaw.length > 0
      ? Math.min(10000, Math.max(0, Number.parseInt(sortOrderRaw, 10) || 999))
      : 999;

  const rawBytes = Buffer.from(await file.arrayBuffer());

  let normalized: NormalizedReference;
  try {
    // 기존 references upload 와 동일한 sharp 정규화 재사용
    const { normalizeReferenceImage } = await import('@/services/image-gen/normalize');
    normalized = await normalizeReferenceImage(rawBytes);
  } catch (err) {
    console.error('[admin/knowledge/images] normalize failed', err);
    return apiError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : '이미지 변환에 실패했어요',
    );
  }

  const id = randomUUID();
  const r2Key = `knowledge/${params.id}/${id}.png`;

  try {
    await putObject({
      key: r2Key,
      body: normalized.bytes,
      contentType: normalized.contentType,
    });
  } catch (err) {
    console.error('[admin/knowledge/images] R2 put failed', err);
    return apiError('INTERNAL_ERROR', '이미지 저장에 실패했어요');
  }

  // is_primary=true 인 경우 기존 primary 를 먼저 false 로 내리고 삽입.
  // (unique partial index 가 있어 그렇게 하지 않으면 삽입 실패.)
  if (isPrimary) {
    await service
      .from('knowledge_images')
      .update({ is_primary: false })
      .eq('knowledge_id', params.id)
      .eq('reference_type', referenceType)
      .eq('is_primary', true);
  }

  const { data, error } = await service
    .from('knowledge_images')
    .insert({
      id,
      knowledge_id: params.id,
      r2_key: r2Key,
      caption,
      viewpoint,
      reference_type: referenceType,
      is_primary: isPrimary,
      sort_order: sortOrder,
      width: normalized.width,
      height: normalized.height,
      filename: file.name || null,
    })
    .select(
      'id, knowledge_id, r2_key, caption, viewpoint, reference_type, is_primary, sort_order, width, height, filename, created_at',
    )
    .single();

  if (error || !data) {
    // Trigger 가 상한 초과 잡았거나 unique index 위반 등 → R2 롤백
    const { deleteObject } = await import('@/services/r2/upload');
    await deleteObject(r2Key).catch(() => {});

    const msg = error?.message ?? '';
    if (msg.includes('positive_image_limit_reached')) {
      return apiError('VALIDATION_ERROR', 'Positive 이미지 최대 10장까지 등록 가능해요');
    }
    if (msg.includes('negative_image_limit_reached')) {
      return apiError('VALIDATION_ERROR', 'Negative 이미지 최대 5장까지 등록 가능해요');
    }
    console.error('[admin/knowledge/images POST] db error', error);
    return apiError('INTERNAL_ERROR', '이미지 등록 실패');
  }

  return apiOk(
    {
      image: imageRowToDomain(
        data as unknown as {
          id: string;
          knowledge_id: string;
          r2_key: string;
          caption: string;
          viewpoint: string;
          reference_type: ReferenceType;
          is_primary: boolean;
          sort_order: number;
          width: number;
          height: number;
          filename: string | null;
          created_at: string;
        },
      ),
    },
    201,
  );
}

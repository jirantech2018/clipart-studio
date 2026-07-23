// Organization reference images (P5-D-B).
//
// GET  — active 조직 멤버가 목록 조회 (sort_order 정순, 이후 created_at).
// POST — owner 만 업로드. FormData(file). sharp 로 정규화 후 R2 put + DB insert.
//        5개 초과 시 트리거가 check_violation. 최상단에서도 사전 검증.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';

import { apiError, apiOk } from '@/lib/api-error';
import { deleteObject, publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

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
const LIMIT = 5;

interface NormalizedReference {
  bytes: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

interface Row {
  id: string;
  organization_id: string;
  r2_key: string;
  filename: string | null;
  width: number;
  height: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export interface OrgReferenceImage {
  id: string;
  organizationId: string;
  r2Key: string;
  url: string;
  filename: string | null;
  width: number;
  height: number;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
}

function toDomain(row: Row): OrgReferenceImage {
  return {
    id: row.id,
    organizationId: row.organization_id,
    r2Key: row.r2_key,
    url: publicUrl(row.r2_key),
    filename: row.filename,
    width: row.width,
    height: row.height,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function loadContext(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, role: null as OrganizationRole | null };
  const orgId = (org as { id: string }).id;

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return {
    orgId,
    role: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (!role) return apiError('FORBIDDEN', '조직 멤버만 볼 수 있어요');

  const { data, error } = await supabase
    .from('organization_reference_images')
    .select('*')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[org ref-images GET] error', error);
    return apiError('INTERNAL_ERROR', '조회 실패');
  }

  return apiOk({
    references: (data ?? []).map((r) => toDomain(r as Row)),
    limit: LIMIT,
  });
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 업로드할 수 있어요');
  }

  const { count: existing } = await supabase
    .from('organization_reference_images')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if ((existing ?? 0) >= LIMIT) {
    return apiError(
      'VALIDATION_ERROR',
      `참조 이미지 슬롯이 가득 찼어요 (최대 ${LIMIT}개). 하나를 삭제해주세요`,
    );
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
    console.error('[org ref-images] normalize failed', err);
    return apiError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : '이미지 변환에 실패했어요',
    );
  }

  const id = randomUUID();
  // 조직 references 는 org 폴더로 분리 — 개인 references/{userId} 와 안 겹치게.
  const r2Key = `org-references/${orgId}/${id}.png`;

  try {
    await putObject({
      key: r2Key,
      body: normalized.bytes,
      contentType: normalized.contentType,
    });
  } catch (err) {
    console.error('[org ref-images] R2 put failed', err);
    return apiError('INTERNAL_ERROR', '이미지 저장에 실패했어요');
  }

  // sort_order 는 마지막 값 + 1 (없으면 0). 사용자가 나중에 조정.
  const { data: lastRow } = await supabase
    .from('organization_reference_images')
    .select('sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (lastRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('organization_reference_images')
    .insert({
      id,
      organization_id: orgId,
      r2_key: r2Key,
      filename: file.name || null,
      width: normalized.width,
      height: normalized.height,
      sort_order: nextOrder,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error || !data) {
    await deleteObject(r2Key).catch(() => {});
    const isLimit = error?.message?.includes('org_reference_image_limit_reached');
    return apiError(
      isLimit ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      isLimit
        ? `참조 이미지 슬롯이 가득 찼어요 (최대 ${LIMIT}개)`
        : '참조 이미지 저장 실패',
    );
  }

  return apiOk({ reference: toDomain(data as Row) }, 201);
}

// 홈 히어로 배너 이미지 카탈로그 — 관리자 전용.
//
// GET  /api/admin/home-hero-images        — 목록 (sort_order, created_at DESC)
// POST /api/admin/home-hero-images        — 업로드 (multipart file)
//
// 이미지 정규화는 admin/knowledge/images 와 동일한 sharp 파이프라인 재사용.
// R2 prefix: home-hero/{image_id}.png

export const runtime = 'nodejs';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl, putObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

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

interface HomeHeroImageRow {
  id: string;
  r2_key: string;
  filename: string | null;
  width: number;
  height: number;
  sort_order: number;
  enabled: boolean;
  created_at: string;
}

export interface HomeHeroImage {
  id: string;
  r2Key: string;
  url: string;
  filename: string | null;
  width: number;
  height: number;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
}

function rowToDomain(row: HomeHeroImageRow): HomeHeroImage {
  return {
    id: row.id,
    r2Key: row.r2_key,
    url: publicUrl(row.r2_key),
    filename: row.filename,
    width: row.width,
    height: row.height,
    sortOrder: row.sort_order,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

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

export async function GET() {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('home_hero_images')
    .select('id, r2_key, filename, width, height, sort_order, enabled, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/home-hero-images GET]', error);
    return apiError('INTERNAL_ERROR', '히어로 이미지를 불러오지 못했어요');
  }

  const images = ((data ?? []) as HomeHeroImageRow[]).map(rowToDomain);
  return apiOk({ images });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

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

  let normalized: { bytes: Buffer; contentType: 'image/png'; width: number; height: number };
  try {
    const { normalizeReferenceImage } = await import('@/services/image-gen/normalize');
    normalized = await normalizeReferenceImage(rawBytes);
  } catch (err) {
    console.error('[admin/home-hero-images POST] normalize failed', err);
    return apiError(
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : '이미지 변환에 실패했어요',
    );
  }

  const id = randomUUID();
  const r2Key = `home-hero/${id}.png`;

  try {
    await putObject({
      key: r2Key,
      body: normalized.bytes,
      contentType: normalized.contentType,
    });
  } catch (err) {
    console.error('[admin/home-hero-images POST] R2 put failed', err);
    return apiError('INTERNAL_ERROR', '이미지 저장에 실패했어요');
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('home_hero_images')
    .insert({
      id,
      r2_key: r2Key,
      filename: file.name || null,
      width: normalized.width,
      height: normalized.height,
    })
    .select('id, r2_key, filename, width, height, sort_order, enabled, created_at')
    .single();

  if (error || !data) {
    const { deleteObject } = await import('@/services/r2/upload');
    await deleteObject(r2Key).catch(() => {});
    console.error('[admin/home-hero-images POST] db error', error);
    return apiError('INTERNAL_ERROR', '이미지 등록 실패');
  }

  return apiOk({ image: rowToDomain(data as HomeHeroImageRow) }, 201);
}

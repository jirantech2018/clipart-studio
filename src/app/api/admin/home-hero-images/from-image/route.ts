// 관리자가 기존 공유 라이브러리(is_on_community=TRUE) 이미지 중 하나를 홈
// 배너 카탈로그에 등록. 파일 업로드 없이 참조만 만들면 되므로 빠르다.
//
// POST /api/admin/home-hero-images/from-image
//   body: { imageId }
//
// - 관리자 전용 (isAdmin 게이팅)
// - imageId 는 반드시 is_on_community=TRUE 인 이미지여야 함
// - 중복 등록 방지: home_hero_images.r2_key UNIQUE 로 이미 자연스럽게 차단
//   (같은 원본 이미지의 r2_key 는 두 번 못 들어감)

import { ZodError, z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { HomeHeroImage } from '@/app/api/admin/home-hero-images/route';

const bodySchema = z.object({
  imageId: z.string().uuid(),
});

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

interface HomeHeroImageRow {
  id: string;
  r2_key: string;
  filename: string | null;
  width: number;
  height: number;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  source_image_id: string | null;
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
    sourceImageId: row.source_image_id,
  };
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body: { imageId: string };
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();

  const { data: img } = await service
    .from('images')
    .select('id, r2_key, width, height, is_on_community')
    .eq('id', body.imageId)
    .maybeSingle();
  if (!img) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');
  const src = img as {
    id: string;
    r2_key: string;
    width: number;
    height: number;
    is_on_community: boolean;
  };
  if (!src.is_on_community) {
    return apiError(
      'VALIDATION_ERROR',
      '공유 라이브러리에 공개된 이미지만 배너로 등록할 수 있어요',
    );
  }

  const { data, error } = await service
    .from('home_hero_images')
    .insert({
      r2_key: src.r2_key,
      source_image_id: src.id,
      filename: null,
      width: src.width,
      height: src.height,
    })
    .select(
      'id, r2_key, filename, width, height, sort_order, enabled, created_at, source_image_id',
    )
    .single();

  if (error || !data) {
    // r2_key UNIQUE 위반이면 이미 배너에 있는 이미지.
    if (error?.message?.includes('duplicate key')) {
      return apiError(
        'CONFLICT',
        '이미 홈 배너에 등록된 이미지예요',
      );
    }
    console.error('[admin/home-hero-images/from-image] insert error', error);
    return apiError('INTERNAL_ERROR', '배너 등록 실패');
  }

  return apiOk({ image: rowToDomain(data as HomeHeroImageRow) }, 201);
}

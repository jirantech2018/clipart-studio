// 이미지 업스케일 — Real-ESRGAN (Replicate) 로 2x / 4x 확대 후 결과를
// 라이브러리에 새 이미지로 저장하고 다운로드 URL 을 돌려준다.
//
// POST /api/images/[id]/upscale   body: { scale: 2 | 4 }
//   - 소유자만 실행 가능 (다른 사람 이미지 업스케일은 허용하지 않음).
//   - 크레딧: 2x = 1, 4x = 2. reserveCredits 로 원자적 차감, 업스케일
//     실패 시 refundCredits 로 환불.
//   - 결과 이미지는 images 테이블에 별도 row 로 저장 (is_upscaled=true,
//     upscaled_from_id=원본, parent_image_id=원본). tagging 은 하지 않는다
//     (원본 시점에 이미 완료).

export const runtime = 'nodejs';
export const maxDuration = 180; // 4x 는 20-40초, Railway 여유 확보

import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  InsufficientCreditsError,
  refundCredits,
  reserveCredits,
} from '@/services/credit';
import {
  UpscaleUpstreamError,
  upscaleFromUrl,
  type UpscaleScale,
  type UpscaleUpstreamCategory,
} from '@/services/image-gen/upscale';
import type { ErrorCode } from '@/lib/api-error';
import { deleteObject, publicUrl, putObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const bodySchema = z.object({
  scale: z.union([z.literal(2), z.literal(4)]),
});

// scale 별 크레딧 비용. 나중에 조정 편하도록 상수로.
const CREDIT_COST: Record<UpscaleScale, number> = { 2: 1, 4: 2 };

// 클라이언트에 노출할 공통 안내 메시지. Replicate 인증 문제 · 계정 크레딧
// 소진 · 모델 스키마 오류 등 내부 원인은 절대 노출하지 않는다.
const USER_FACING_UPSCALE_MESSAGE =
  '현재 고화질 변환 서비스를 일시적으로 사용할 수 없습니다. 크레딧은 차감되지 않았어요. 잠시 후 다시 시도해 주세요.';

const UPSCALE_ERROR_CODE_BY_CATEGORY: Record<UpscaleUpstreamCategory, ErrorCode> = {
  unconfigured: 'UPSCALE_UPSTREAM_UNCONFIGURED',
  unauthorized: 'UPSCALE_UPSTREAM_UNAUTHORIZED',
  quota: 'UPSCALE_UPSTREAM_QUOTA',
  request_invalid: 'UPSCALE_REQUEST_INVALID',
  failed: 'UPSCALE_UPSTREAM_FAILED',
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: { scale: UpscaleScale };
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

  // RLS 통과 시 소유자 or authenticated/public. 업스케일은 소유자만.
  const { data: image } = await supabase
    .from('images')
    .select('id, user_id, r2_key, prompt, model, status')
    .eq('id', params.id)
    .maybeSingle();
  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');
  if ((image as { user_id: string }).user_id !== user.id) {
    return apiError('FORBIDDEN', '내 이미지만 업스케일할 수 있어요');
  }
  if ((image as { status: string }).status !== 'saved') {
    return apiError('VALIDATION_ERROR', '저장된 이미지만 업스케일할 수 있어요');
  }

  const cost = CREDIT_COST[body.scale];
  let remainingCredits: number;
  try {
    remainingCredits = await reserveCredits(user.id, cost);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return apiError('INSUFFICIENT_CREDITS', '이번 달 크레딧이 부족해요', {
        requiredCredits: cost,
      });
    }
    throw err;
  }

  const src = image as {
    id: string;
    user_id: string;
    r2_key: string;
    prompt: string;
    model: string;
  };

  const sourceUrl = publicUrl(src.r2_key);

  let upscaled: Awaited<ReturnType<typeof upscaleFromUrl>>;
  try {
    upscaled = await upscaleFromUrl(sourceUrl, body.scale);
  } catch (err) {
    // 서버 로그에는 Replicate 원본 status / message / stack 유지.
    // 클라이언트에는 category → 안전한 error code + 공통 안내 문구만.
    console.error(`[upscale] failed for image ${src.id}`, {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      category: err instanceof UpscaleUpstreamError ? err.category : null,
      upstreamStatus: err instanceof UpscaleUpstreamError ? err.upstreamStatus : null,
    });
    await refundCredits(user.id, cost).catch((refundErr) => {
      console.error(
        `[upscale] refund failed after upstream error for image ${src.id}`,
        refundErr,
      );
    });
    const code: ErrorCode = err instanceof UpscaleUpstreamError
      ? UPSCALE_ERROR_CODE_BY_CATEGORY[err.category]
      : 'UPSCALE_UPSTREAM_FAILED';
    return apiError(code, USER_FACING_UPSCALE_MESSAGE);
  }

  // 실측 크기 (sharp 로 metadata 읽음) — Real-ESRGAN 결과 크기 신뢰 확인.
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(upscaled.bytes).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    // metadata 실패해도 업스케일 자체는 완료 — width/height 0 로 저장.
  }

  const newId = randomUUID();
  const r2Key = `users/${user.id}/${newId}.png`;

  try {
    await putObject({
      key: r2Key,
      body: upscaled.bytes,
      contentType: upscaled.contentType,
    });
  } catch (err) {
    console.error(`[upscale] R2 put failed for ${newId}`, err);
    await refundCredits(user.id, cost).catch(() => {});
    return apiError('INTERNAL_ERROR', '업스케일 결과 저장에 실패했어요');
  }

  const service = createSupabaseServiceClient();
  const { error: insertError } = await service.from('images').insert({
    id: newId,
    user_id: user.id,
    prompt: src.prompt,
    model: src.model,
    r2_key: r2Key,
    generation_mode: 'upscale',
    parent_image_id: src.id,
    upscaled_from_id: src.id,
    is_upscaled: true,
    status: 'saved',
    pending_expires_at: null,
    width,
    height,
  });

  if (insertError) {
    console.error(`[upscale] insert failed for ${newId}`, insertError);
    await deleteObject(r2Key).catch(() => {});
    await refundCredits(user.id, cost).catch(() => {});
    return apiError('INTERNAL_ERROR', '업스케일 결과 등록에 실패했어요');
  }

  return apiOk(
    {
      imageId: newId,
      scale: body.scale,
      width,
      height,
      downloadUrl: `/api/images/${newId}/download`,
      remainingCredits,
    },
    201,
  );
}

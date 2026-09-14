// VisualPlan 기반 신규 클립아트 생성.
//
// 원칙:
//   - subject·unit·주제·정답 단어 조건문 없음. VisualPlan 필드만 프롬프트에 넣는다.
//   - 라이브러리 선검색 없음. 매번 신규 생성.
//   - 생성 이미지는 R2 업로드 후 images 테이블에 status='saved', is_on_community=false 로 삽입
//     (개인 자산). 학습자료 사용은 learning_document_clipart_usage 로 별도 추적.
//   - 커뮤니티 공유는 사용자 명시 액션 (기존 흐름) 에서만. 실패/미사용 이미지는
//     is_on_community=false 로 남으며 자동 공유되지 않는다.
//   - 관리자 통제 실행에서 크레딧 우회 (bypassCredits=true).

import { randomUUID } from 'node:crypto';

import { primaryAdapter } from '@/services/image-gen';
import { publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import type { VisualPlan } from '@/services/learning-generation/types';

export interface GenerateVisualInput {
  itemId: string;
  visualPlan: VisualPlan;
  userId: string;
  organizationId: string;
  /** 하나의 blueprint 에서 여러 장 생성 시 슬롯 인덱스 (0-based). */
  slotIndex: number;
}

export interface GeneratedVisual {
  imageId: string;
  r2Key: string;
  publicUrl: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
  model: string;
  itemId: string;
  slotIndex: number;
}

/**
 * VisualPlan → 이미지 생성 프롬프트.
 * 특정 과목·단원·정답 단어 하드코드 없음. Plan 이 채운 필드만 사용.
 */
function composeImagePrompt(vp: VisualPlan, slotIndex: number): string {
  const role = vp.educationalRoles[slotIndex] ?? vp.educationalRoles[0] ?? vp.purpose;
  return [
    vp.styleGuide,
    `표현 대상: ${vp.subjectMatter}`,
    `교육적 역할: ${role}`,
    `화면 구성: ${vp.composition}`,
    `표현 수준: ${vp.ageAppropriateStyle}`,
    `문자 정책: ${vp.textPolicy}`,
    `정답 노출 방지: ${vp.answerLeakPolicy}`,
  ].join('. ');
}

/**
 * VisualPlan 을 이미지로 생성해 R2 업로드 + images 테이블 삽입. 개인 자산으로 저장 (is_on_community=false).
 */
export async function generateVisual(input: GenerateVisualInput): Promise<GeneratedVisual> {
  const adapter = primaryAdapter();
  const prompt = composeImagePrompt(input.visualPlan, input.slotIndex);
  const size = '1024x1024';

  const gen = await adapter.generate({
    prompt,
    mode: 'text2img',
    size,
  });

  const imageId = randomUUID();
  const ext = gen.contentType === 'image/webp' ? 'webp' : 'png';
  const r2Key = `users/${input.userId}/${imageId}.${ext}`;

  await putObject({ key: r2Key, body: gen.imageBytes, contentType: gen.contentType });

  const service = createSupabaseServiceClient();
  const { error } = await service.from('images').insert({
    id: imageId,
    user_id: input.userId,
    organization_id: input.organizationId,
    prompt,
    model: gen.model,
    seed: gen.seed,
    r2_key: r2Key,
    generation_mode: 'text2img',
    school_profile_applied: false,
    status: 'saved',
    is_on_community: false,
    pending_expires_at: null,
    width: 1024,
    height: 1024,
  });
  if (error) throw new Error(`insert images failed: ${error.message}`);

  return {
    imageId,
    r2Key,
    publicUrl: publicUrl(r2Key),
    prompt,
    width: 1024,
    height: 1024,
    seed: gen.seed,
    model: gen.model,
    itemId: input.itemId,
    slotIndex: input.slotIndex,
  };
}

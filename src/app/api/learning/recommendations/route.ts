// POST /api/learning/recommendations — AI 단원·주제 3개 추천.
//
// 저비용 호출 (gpt-4o-mini). 크레딧 소진 없음. 학습 자료 생성 전 사용자 참고용.

export const runtime = 'nodejs';
export const maxDuration = 25;

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  generateRecommendations,
  LearningOrchestratorError,
} from '@/services/learning-orchestrator';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

import { recommendationsSchema } from '@/features/learning-helper/lib/schemas';

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  let body;
  try {
    body = recommendationsSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 해당 학년/과목의 seed topics 를 hint 로 전달.
  const service = createSupabaseServiceClient();
  const { data: hintRows } = await service
    .from('learning_common_topics')
    .select('unit, topic')
    .eq('grade', body.grade)
    .eq('subject_code', body.subject)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .limit(10);

  const hintTopics = ((hintRows as Array<{ unit: string; topic: string }> | null) ?? []).map(
    (r) => ({ unit: r.unit, topic: r.topic }),
  );

  try {
    const recommendations = await generateRecommendations(
      body.grade as 1 | 2 | 3 | 4 | 5 | 6,
      body.subject as 'KOR' | 'MATH',
      body.materialType as
        | 'multiple_choice'
        | 'individual_activity'
        | 'ox_quiz'
        | 'concept_summary'
        | 'reading_material',
      hintTopics,
    );
    return apiOk({ recommendations });
  } catch (err) {
    if (err instanceof LearningOrchestratorError) {
      const message =
        err.code === 'AI_TIMEOUT'
          ? 'AI 추천 응답이 너무 오래 걸렸어요.'
          : 'AI 추천 중 오류가 발생했어요.';
      return apiError('UPSTREAM_UNAVAILABLE', message);
    }
    console.error('[learning/recommendations POST]', err);
    return apiError('INTERNAL_ERROR', '추천 생성 실패');
  }
}

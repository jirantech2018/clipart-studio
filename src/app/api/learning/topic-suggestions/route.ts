// POST /api/learning/topic-suggestions
//
// 사용자가 단원(unit) 만 선택하고 주제를 정하지 못했을 때 도움받기 용도.
// 해당 단원 안에서 서로 다른 성격의 세부 주제 3개를 AI 추천 (basic/realworld/inquiry).
//
// M2-1 (v0.5): recommendations API 와 다르게 unit 이 이미 정해진 상태.
// 결과 카드 문구:
//   basic     → "기본 개념 익히기"
//   realworld → "생활 속에서 적용하기"
//   inquiry   → "생각을 넓혀 탐구하기"
//
// 크레딧 소진 없음 (저비용 gpt-4o-mini).

export const runtime = 'nodejs';
export const maxDuration = 25;

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { generateRecommendations, LearningOrchestratorError } from '@/services/learning-orchestrator';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

import { isMaterialTypeCode } from '@/features/learning-helper/domain/material-types';
import { isSubjectCode } from '@/features/learning-helper/domain/subjects';

const bodySchema = z.object({
  grade: z.number().int().min(1).max(6),
  subject: z.string().refine(isSubjectCode, '지원하지 않는 과목입니다'),
  materialType: z.string().refine(isMaterialTypeCode, '지원하지 않는 자료 유형입니다'),
  unit: z.string().min(1).max(80),
});

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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 같은 학년·과목·단원의 seed topic 을 hint 로 전달해 AI 추천 정확도 향상.
  const service = createSupabaseServiceClient();
  const { data: hintRows } = await service
    .from('learning_common_topics')
    .select('unit, topic')
    .eq('grade', body.grade)
    .eq('subject_code', body.subject)
    .eq('unit', body.unit)
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
    // 세부 주제 형태로 반환 — LearningInputForm 에서 클릭 시 topic 필드 자동 채움.
    return apiOk({ unit: body.unit, recommendations });
  } catch (err) {
    if (err instanceof LearningOrchestratorError) {
      const message =
        err.code === 'AI_TIMEOUT'
          ? '추천 응답이 너무 오래 걸렸어요.'
          : '추천 생성 중 오류가 발생했어요.';
      return apiError('UPSTREAM_UNAVAILABLE', message);
    }
    console.error('[learning/topic-suggestions POST]', err);
    return apiError('INTERNAL_ERROR', '추천 생성 실패');
  }
}

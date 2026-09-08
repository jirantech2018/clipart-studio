// GET /api/learning/topics?grade=X&subject=KOR
//
// 해당 학년·과목의 공통 학습 주제 (단원) 목록을 반환.
// M2-1 단원/주제 필드 분리를 위한 단원 select 데이터 소스.
//
// 응답: { data: { units: string[] } }  — display_order 순서
// 같은 unit 이 여러 topic 을 가지므로 unit 은 distinct 로 반환.

export const runtime = 'nodejs';
export const maxDuration = 15;

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import { isSubjectCode } from '@/features/learning-helper/domain/subjects';

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const url = new URL(request.url);
  const gradeStr = url.searchParams.get('grade');
  const subject = url.searchParams.get('subject');
  const grade = Number(gradeStr);

  if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
    return apiError('VALIDATION_ERROR', '학년은 1~6 사이의 정수여야 합니다');
  }
  if (!subject || !isSubjectCode(subject)) {
    return apiError('VALIDATION_ERROR', '지원하지 않는 과목입니다');
  }

  const service = createSupabaseServiceClient();
  const { data: rows, error } = await service
    .from('learning_common_topics')
    .select('unit, display_order')
    .eq('grade', grade)
    .eq('subject_code', subject)
    .eq('active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[learning/topics GET]', error);
    return apiError('INTERNAL_ERROR', '단원 목록을 불러오지 못했어요');
  }

  // 같은 unit 이 여러 topic 을 갖는 seed 이므로 unit 만 distinct.
  const seen = new Set<string>();
  const units: string[] = [];
  for (const row of (rows as Array<{ unit: string }> | null) ?? []) {
    if (!seen.has(row.unit)) {
      seen.add(row.unit);
      units.push(row.unit);
    }
  }

  return apiOk({ units });
}

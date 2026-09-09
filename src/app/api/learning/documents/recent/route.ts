// GET /api/learning/documents/recent?orgSlug=... — 최근 학습자료 목록.
//
// 재다운로드 진입용. 현재 조직의 최근 20건, 소유자 관계는 RLS 가 강제.

export const runtime = 'nodejs';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { searchParams } = new URL(request.url);
  const orgSlug = searchParams.get('orgSlug');
  if (!orgSlug) return apiError('VALIDATION_ERROR', 'orgSlug 가 필요합니다');

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) return apiError('VALIDATION_ERROR', '조직을 찾을 수 없어요');
  const organizationId = (orgRow as { id: string }).id;

  const { data, error } = await supabase
    .from('learning_documents')
    .select('id, title, grade, subject_code, material_type_code, topic, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[learning/documents/recent GET] failed', error);
    return apiError('INTERNAL_ERROR', '최근 학습자료를 불러오지 못했어요');
  }

  return apiOk({
    documents: (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        title: r.title as string,
        grade: r.grade as number,
        subjectCode: r.subject_code as string,
        materialTypeCode: r.material_type_code as string,
        topic: r.topic as string,
        createdAt: r.created_at as string,
      };
    }),
  });
}

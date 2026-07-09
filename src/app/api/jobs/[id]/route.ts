// Design Ref: §4.1 GET /api/jobs/:id — job status polling fallback

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return apiError('NOT_FOUND', '해당 Job을 찾을 수 없습니다');
  return apiOk(data);
}

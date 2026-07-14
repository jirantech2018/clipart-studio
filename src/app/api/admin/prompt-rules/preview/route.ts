// 관리자 미리보기 API. 임의의 사용자 프롬프트를 넣으면 현재 활성 rule 을 로드해서
// 어떤 rule 이 실제로 적용/제외되는지, 최종 프롬프트가 어떻게 만들어지는지 돌려준다.
// 실제 이미지 생성은 하지 않으므로 크레딧을 소비하지 않는다.

export const runtime = 'nodejs';
export const maxDuration = 10;

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { composeRules, loadActiveRules } from '@/services/prompt-rules';
import { createSupabaseServerClient } from '@/services/supabase/server';

const previewSchema = z.object({
  prompt: z.string().min(1, '프롬프트를 입력하세요').max(2000),
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자 전용 페이지입니다');

  let body: z.infer<typeof previewSchema>;
  try {
    body = previewSchema.parse(await request.json());
  } catch {
    return apiError('VALIDATION_ERROR', '프롬프트가 비어 있거나 너무 깁니다');
  }

  const rules = await loadActiveRules();
  const composed = composeRules({ rules, userSection: body.prompt });

  const applied = rules.filter((r) => composed.appliedRuleIds.includes(r.id));
  const dropped = rules.filter((r) => composed.droppedRuleIds.includes(r.id));

  return apiOk({
    appliedRules: applied.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      priority: r.priority,
    })),
    droppedRules: dropped.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      priority: r.priority,
    })),
    finalPrompt: composed.prompt,
    finalLength: composed.prompt.length,
    totalActiveRules: rules.length,
  });
}

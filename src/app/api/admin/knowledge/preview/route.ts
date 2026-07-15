// 관리자 Preview API. 임의의 사용자 프롬프트에 대해 파이프라인과 동일한
// matchKnowledgeForPrompt + composeKnowledgePrompt 를 실행한 결과를 돌려준다.
// 실제 이미지 생성은 하지 않아 크레딧이 소비되지 않는다.

export const runtime = 'nodejs';
export const maxDuration = 15;

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { composeKnowledgePrompt, matchKnowledgeForPrompt } from '@/services/knowledge';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { ReferenceType } from '@/types/domain';

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

  const matches = await matchKnowledgeForPrompt(body.prompt);
  const composed = composeKnowledgePrompt(matches, body.prompt);

  // 매칭된 Knowledge 마다 primary positive 썸네일 URL 을 함께 보내서 UI 에서 즉시 표시.
  const matchesOut = matches.map((m) => {
    const positives = m.knowledge.images
      .filter((i) => i.referenceType === ('positive' as ReferenceType))
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });
    const primary = positives[0] ?? null;
    return {
      knowledgeId: m.knowledge.id,
      knowledgeName: m.knowledge.name,
      priority: m.knowledge.priority,
      matchedTriggers: m.matchedTriggers,
      triggerScore: m.triggerScore,
      llmScore: m.llmScore,
      reason: m.reason,
      primaryImageUrl: primary ? primary.url : null,
    };
  });

  return apiOk({
    matches: matchesOut,
    finalPrompt: composed.prompt,
    finalLength: composed.prompt.length,
    appliedKnowledgeIds: composed.appliedKnowledgeIds,
    referenceImageUrls: composed.referenceImageKeys.map((k) => publicUrl(k)),
  });
}

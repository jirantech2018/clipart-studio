// Admin console — read/update the single-row admin_settings.
// Access: ADMIN_EMAIL whitelist only. Everything else → 403.

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const patchSchema = z.object({
  systemPrompt: z.string().max(4000, '시스템 프롬프트는 4000자 이내로 작성해주세요'),
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

export async function GET() {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('admin_settings')
    .select('system_prompt, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) return apiError('INTERNAL_ERROR', '설정을 불러오지 못했습니다');

  return apiOk({
    systemPrompt: (data?.system_prompt as string) ?? '',
    updatedAt: (data?.updated_at as string) ?? null,
  });
}

export async function PATCH(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return apiError('VALIDATION_ERROR', '입력값을 확인해주세요');
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from('admin_settings')
    .update({
      system_prompt: body.systemPrompt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  if (error) return apiError('INTERNAL_ERROR', '저장 실패');
  return apiOk({ ok: true });
}

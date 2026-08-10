// Admin editable policy — 신규 가입 초기 크레딧 등 app_settings key/value.
//
// GET   /api/admin/app-settings
//   response: { settings: { initialSignupCredits: number } }
// PATCH /api/admin/app-settings
//   body: { initialSignupCredits?: number }
//   - 넘긴 키만 upsert. 값 유효성은 여기서 검증.
//   - handle_new_user() 트리거가 다음 signup 부터 이 값을 즉시 사용.

import { ZodError, z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const KEY_INITIAL_CREDITS = 'initial_signup_credits';

async function readSettings(): Promise<{ initialSignupCredits: number }> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('app_settings')
    .select('key, value')
    .in('key', [KEY_INITIAL_CREDITS]);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ key: string; value: string }>) {
    map.set(row.key, row.value);
  }

  const raw = map.get(KEY_INITIAL_CREDITS);
  const parsed = raw != null ? Number.parseInt(raw, 10) : NaN;
  const initialSignupCredits = Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;

  return { initialSignupCredits };
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const settings = await readSettings();
  return apiOk({ settings });
}

const patchSchema = z.object({
  initialSignupCredits: z.number().int().min(0).max(1_000_000).optional(),
});

export async function PATCH(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 수정할 수 있어요');

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const upserts: Array<{ key: string; value: string; updated_by: string }> = [];

  if (body.initialSignupCredits !== undefined) {
    upserts.push({
      key: KEY_INITIAL_CREDITS,
      value: String(body.initialSignupCredits),
      updated_by: user.id,
    });
  }

  if (upserts.length === 0) {
    // 아무 것도 안 넘겼으면 현재 값만 반환.
    const settings = await readSettings();
    return apiOk({ settings });
  }

  const { error } = await service
    .from('app_settings')
    .upsert(upserts, { onConflict: 'key' });
  if (error) {
    console.error('[admin app-settings PATCH] upsert error', error);
    return apiError('INTERNAL_ERROR', '설정 저장 실패');
  }

  const settings = await readSettings();
  return apiOk({ settings });
}

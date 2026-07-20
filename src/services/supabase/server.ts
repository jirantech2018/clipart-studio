// Design Ref: §9.4 Infrastructure layer — Supabase server client for Route Handlers

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from Server Component — Middleware refreshes the session
          }
        },
      },
    },
  );
}

// Service role client — bypasses RLS. Use only for trusted server operations
// (credit reserve/refund via RPC, cron jobs, activity logs, invite reads).
//
// 주의: @supabase/ssr 의 createServerClient 는 쿠키 기반 auth 를 전제로 하기 때문에
// service role 키를 넣어도 실제 요청에는 auth.uid() 컨텍스트가 anon 으로 들어가서
// RLS 를 뚫지 못하는 경우가 생긴다. Service role 은 반드시 순수한
// @supabase/supabase-js 의 createClient 로 만들어야 한다.
export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

// Magic link / OAuth callback — exchanges code for session and redirects
// Design Ref: §4.1 Auth flow (Supabase Auth OAuth/OTP callback)
// URL: /auth/callback (must not be inside a Route Group so it stays literal)

import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/services/supabase/server';

// Railway 컨테이너 안에서 request.url 은 http://localhost:8080/... 로 잡히므로,
// 실제 외부 URL 은 x-forwarded-host / x-forwarded-proto 헤더로 재구성해야 한다.
// (invites POST route 에서 이미 같은 fix 를 적용한 이력 있음.)
function externalBaseUrl(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, '');

  const headers = request.headers;
  const forwardedHost = headers.get('x-forwarded-host') ?? headers.get('host');
  const forwardedProto = headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedHost && !forwardedHost.startsWith('localhost')) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/onboarding';
  // Open-redirect 방어: 사이트 내부 상대 경로만 허용
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/onboarding';

  const baseUrl = externalBaseUrl(request);

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_code`);
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${baseUrl}${next}`);
}

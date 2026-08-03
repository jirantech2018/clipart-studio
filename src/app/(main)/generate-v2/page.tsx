// generate-v2 (Conversation UI) 신규 페이지 — server 진입점.
//
// 헤더 nav 에는 아직 연결하지 않고, 직접 URL 로만 접근하여 검수한다.
// 기존 /generate 는 그대로 유지 — 상태·API 모두 격리.
//
// 왜 server 컴포넌트인가:
//   /generate 와 동일 패턴으로 SSR 시점의 profile.credits 를 client 로 넘겨,
//   client 는 storeCredits ?? initialCredits 로 fallback 한다. layout 이
//   이미 profile 을 조회하지만 Server → 하위 페이지로 데이터를 직접
//   내려주는 표준 경로가 없어, 이번 커밋에서는 최소 변경 원칙에 따라 page
//   가 credits 만 재조회한다 (지시 §3 "page 재조회가 최소 변경이라면 그대로
//   진행해도 됩니다"). 최종 Source of Truth 는 authStore.

import { redirect } from 'next/navigation';

import { GenerateV2Client } from '@/features/generation-v2/components/GenerateV2Client';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function GenerateV2Page() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', user.id)
    .single();

  return <GenerateV2Client initialCredits={profile?.credits ?? 0} />;
}

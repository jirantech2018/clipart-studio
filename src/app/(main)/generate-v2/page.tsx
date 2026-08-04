// generate-v2 (Conversation UI) 신규 페이지 — server 진입점.
//
// URL query:
//   ?parent=<image_id>  : 이 이미지로 다시 만들기 (chaining / img2img).
//                         존재하고 조회 가능하면 v2 옵션 상단에 참조 카드로
//                         노출되도록 client 로 넘긴다.
//
// 왜 server 컴포넌트인가:
//   /generate 와 동일 패턴으로 SSR 시점의 profile.credits 를 client 로 넘겨,
//   client 는 storeCredits ?? initialCredits 로 fallback 한다.

import { redirect } from 'next/navigation';

import { GenerateV2Client } from '@/features/generation-v2/components/GenerateV2Client';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { parent?: string };
}

export default async function GenerateV2Page({ searchParams }: Props) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const parentId = searchParams.parent?.trim() || null;

  const [profileResult, parentResult] = await Promise.all([
    supabase.from('profiles').select('credits').eq('id', user.id).single(),
    parentId
      ? supabase
          .from('images')
          .select('id, prompt, r2_key, thumbnail_r2_key')
          .eq('id', parentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const parentRow = parentResult.data as {
    id: string;
    prompt: string;
    r2_key: string;
    thumbnail_r2_key: string | null;
  } | null;

  const parent = parentRow
    ? {
        id: parentRow.id,
        prompt: parentRow.prompt,
        thumbnailUrl: publicUrl(parentRow.thumbnail_r2_key ?? parentRow.r2_key),
      }
    : null;

  return (
    <GenerateV2Client
      initialCredits={profileResult.data?.credits ?? 0}
      parent={parent}
    />
  );
}

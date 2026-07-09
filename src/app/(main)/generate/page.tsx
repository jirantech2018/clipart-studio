// Design Ref: §5.4 Generation Page composition — server fetches School Profile + credits, delegates UI to client
// Optional ?parent=<image_id> switches the form into chaining (i2i) mode.

import { redirect } from 'next/navigation';

import { GenerationForm } from '@/features/generation/components/GenerationForm';
import { BatchProgressPanel } from '@/features/generation/components/BatchProgressPanel';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface GeneratePageProps {
  searchParams: { parent?: string };
}

export default async function GeneratePage({ searchParams }: GeneratePageProps) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: schoolProfile }] = await Promise.all([
    supabase
      .from('profiles')
      .select('credits, credits_reset_at')
      .eq('id', user.id)
      .single(),
    supabase.from('school_profiles').select('school_name').eq('user_id', user.id).maybeSingle(),
  ]);

  // Optional chaining source. RLS allows own images and any is_public image,
  // so someone sharing a Community image link can chain from it too.
  const parentId = searchParams.parent ?? null;
  let parent: { id: string; prompt: string; thumbnailUrl: string } | null = null;
  if (parentId) {
    const { data: row } = await supabase
      .from('images')
      .select('id, prompt, r2_key, thumbnail_r2_key')
      .eq('id', parentId)
      .maybeSingle();
    if (row) {
      const thumbnailKey =
        (row.thumbnail_r2_key as string) ?? (row.r2_key as string);
      parent = {
        id: row.id as string,
        prompt: row.prompt as string,
        thumbnailUrl: publicUrl(thumbnailKey),
      };
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <GenerationForm
          hasSchoolProfile={!!schoolProfile}
          schoolName={(schoolProfile?.school_name as string) ?? null}
          initialCredits={profile?.credits ?? 0}
          creditsResetAt={(profile?.credits_reset_at as string) ?? null}
          parent={parent}
        />
      </div>
      <div className="min-w-0">
        <BatchProgressPanel />
      </div>
    </div>
  );
}

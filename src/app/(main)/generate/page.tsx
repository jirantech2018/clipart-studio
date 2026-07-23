// Design Ref: §5.4 Generation Page composition — server fetches School Profile + credits, delegates UI to client
// Optional ?parent=<image_id> switches the form into chaining (i2i) mode.
// P5-D-C: Optional ?org=<slug> switches the form into org-context mode —
// school AI settings and reference images come from that org instead of the
// personal profile / references.

import { redirect } from 'next/navigation';

import { GenerationForm } from '@/features/generation/components/GenerationForm';
import { BatchProgressPanel } from '@/features/generation/components/BatchProgressPanel';
import { SchoolContextCard } from '@/features/generation/components/SchoolContextCard';
import { ReferenceLibrarySection } from '@/features/references/components/ReferenceLibrarySection';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { SchoolLevel } from '@/types/domain';

export const dynamic = 'force-dynamic';

interface GeneratePageProps {
  searchParams: { parent?: string; org?: string };
}

export interface OrgGenerationContext {
  id: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  schoolLevel: SchoolLevel | null;
  basePrompt: string | null;
  styleEnabled: boolean;
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

  // ---- 조직 컨텍스트 판별 ---------------------------------------------------
  // ?org=<slug> 로 들어오면 그 조직의 학교 AI 설정과 참조 이미지를 로드.
  // 요청자가 그 조직의 active 멤버가 아니면 403 표시 (자동 개인 폴백 없음 —
  // 사용자 명세 Q3 (b)).
  const orgSlug = searchParams.org?.trim() || null;
  let orgContext: OrgGenerationContext | null = null;
  let orgAccessError: string | null = null;

  if (orgSlug) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id, slug, name, avatar_url, school_level, base_prompt, style_enabled, deleted_at')
      .eq('slug', orgSlug)
      .maybeSingle();

    if (!orgRow || (orgRow as { deleted_at: string | null }).deleted_at) {
      orgAccessError = '요청한 조직을 찾을 수 없어요.';
    } else {
      const orgId = (orgRow as { id: string }).id;
      const { data: member } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (!member) {
        orgAccessError = '이 조직의 멤버가 아니에요.';
      } else {
        const row = orgRow as {
          id: string;
          slug: string;
          name: string;
          avatar_url: string | null;
          school_level: SchoolLevel | null;
          base_prompt: string | null;
          style_enabled: boolean;
        };
        orgContext = {
          id: row.id,
          slug: row.slug,
          name: row.name,
          avatarUrl: row.avatar_url,
          schoolLevel: row.school_level,
          basePrompt: row.base_prompt,
          styleEnabled: row.style_enabled,
        };
      }
    }
  }

  // Optional chaining source. RLS allows own images plus authenticated/public
  // visibility, so any Community or link-shared image can be chained from too.
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
      <div className="min-w-0 space-y-6">
        <GenerationForm
          hasSchoolProfile={!!schoolProfile}
          schoolName={(schoolProfile?.school_name as string) ?? null}
          initialCredits={profile?.credits ?? 0}
          creditsResetAt={(profile?.credits_reset_at as string) ?? null}
          parent={parent}
          orgContext={orgContext}
          orgAccessError={orgAccessError}
        />
        {/* 폼 아래에 개인 참조 이미지 카드 (개인/조직 무관하게 항상 표시).
            그 아래에 학교 설정 적용 카드 — 우측 드롭다운으로 개인/조직 선택. */}
        {!parent && <ReferenceLibrarySection />}
        {!parent && (
          <SchoolContextCard
            orgContext={orgContext}
            hasSchoolProfile={!!schoolProfile}
            personalSchoolName={(schoolProfile?.school_name as string) ?? null}
          />
        )}
      </div>
      <div className="min-w-0">
        <BatchProgressPanel />
      </div>
    </div>
  );
}

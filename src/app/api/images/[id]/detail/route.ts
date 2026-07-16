// Design Ref: §5.4 Image Detail Page — server-side lookup with tags/categories embed.
// RLS lets us see own images and public ones; non-visible ids surface as 404.

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data: row } = await supabase
    .from('images')
    .select('*, image_tags(tag), image_categories(category)')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const rawTags = (row.image_tags as Array<{ tag: string }> | null) ?? [];
  const rawCats = (row.image_categories as Array<{ category: string }> | null) ?? [];

  return apiOk({
    id: row.id as string,
    userId: row.user_id as string,
    prompt: row.prompt as string,
    model: row.model as string,
    seed: (row.seed as number) ?? null,
    visibility: row.visibility as import('@/types/domain').ImageVisibility,
    isOnCommunity: row.is_on_community as boolean,
    parentImageId: (row.parent_image_id as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    generationMode: row.generation_mode as string,
    referenceImageId: (row.reference_image_id as string) ?? null,
    schoolProfileApplied: row.school_profile_applied as boolean,
    width: (row.width as number) ?? 1024,
    height: (row.height as number) ?? 1024,
    createdAt: row.created_at as string,
    fullUrl: publicUrl(row.r2_key as string),
    thumbnailUrl: publicUrl((row.thumbnail_r2_key as string) ?? (row.r2_key as string)),
    tags: rawTags.map((t) => t.tag),
    categories: rawCats.map((c) => c.category),
    isOwner: (row.user_id as string) === user.id,
  });
}

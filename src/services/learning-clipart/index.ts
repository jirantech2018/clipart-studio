// 학습자료 클립아트 매칭 (R2 라이브러리 검색).
//
// 원칙:
//   - subject·unit·topic·단어 문자열 검사 없음.
//   - blueprint 가 계획한 서술적 clipartHint(검색어) 만 입력으로 사용.
//   - 조회 대상: 공유 라이브러리 (is_on_community=true, status='saved') 만.
//     조직 사설 이미지·개인 이미지는 권한 이슈로 이번 스코프에서 제외.
//   - 서비스 롤로 조회하되 위 필터로 안전 범위 보장.
//   - 매칭 실패 시 이 blueprint 는 이미지 없이 진행 (텍스트만).
//   - 새 이미지 생성은 이번 스코프에서 미지원 (크레딧 정책 변경 필요 시 별도 승인).

import { createSupabaseServiceClient } from '@/services/supabase/server';
import { publicUrl } from '@/services/r2/upload';

export interface ClipartMatch {
  imageId: string;
  r2Key: string;
  thumbnailR2Key: string | null;
  thumbnailUrl: string;
  prompt: string;
  width: number;
  height: number;
  source: 'library';
}

/**
 * Score = tag exact match hits + fulltext score. Ties broken by newer created_at.
 * We fetch candidates from three independent signals (tag / category / FTS) and
 * take the best across them.
 */
export async function findClipartByHint(
  hint: string,
  opts: { limit?: number } = {},
): Promise<ClipartMatch[]> {
  const trimmed = hint.trim();
  if (!trimmed) return [];
  const limit = opts.limit ?? 3;

  const service = createSupabaseServiceClient();

  // Split hint into search tokens (words only, min length 2).
  const tokens = Array.from(
    new Set(
      trimmed
        .split(/[\s,·\-·:;()·\/]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
        .slice(0, 6),
    ),
  );
  if (tokens.length === 0) return [];

  const candidateIds = new Set<string>();

  await Promise.all([
    // Tag exact matches for each token
    ...tokens.map(async (token) => {
      const { data } = await service
        .from('image_tags')
        .select('image_id')
        .eq('tag', token)
        .limit(30);
      for (const row of data ?? []) candidateIds.add((row as { image_id: string }).image_id);
    }),
    // Category exact matches
    ...tokens.map(async (token) => {
      const { data } = await service
        .from('image_categories')
        .select('image_id')
        .eq('category', token)
        .limit(30);
      for (const row of data ?? []) candidateIds.add((row as { image_id: string }).image_id);
    }),
    // Full-text on search_vector (whole hint)
    (async () => {
      const { data } = await service
        .from('images')
        .select('id')
        .eq('status', 'saved')
        .eq('is_on_community', true)
        .textSearch('search_vector', trimmed, { type: 'websearch', config: 'simple' })
        .limit(30);
      for (const row of data ?? []) candidateIds.add((row as { id: string }).id);
    })(),
  ]);

  if (candidateIds.size === 0) return [];

  const { data: rows, error } = await service
    .from('images')
    .select('id, r2_key, thumbnail_r2_key, prompt, width, height, created_at, is_on_community, status')
    .in('id', Array.from(candidateIds))
    .eq('status', 'saved')
    .eq('is_on_community', true)
    .order('created_at', { ascending: false })
    .limit(limit * 3);

  if (error || !rows) return [];

  return rows.slice(0, limit).map((r) => {
    const row = r as {
      id: string;
      r2_key: string;
      thumbnail_r2_key: string | null;
      prompt: string;
      width: number;
      height: number;
    };
    const thumbnail = row.thumbnail_r2_key ?? row.r2_key;
    return {
      imageId: row.id,
      r2Key: row.r2_key,
      thumbnailR2Key: row.thumbnail_r2_key,
      thumbnailUrl: publicUrl(thumbnail),
      prompt: row.prompt,
      width: row.width,
      height: row.height,
      source: 'library' as const,
    };
  });
}

/**
 * Fetch one clipart per (itemId, clipartHint) tuple. Returns a map keyed by
 * itemId with the top-1 match or null when nothing was found.
 */
export async function findClipartsForItems(
  items: Array<{ itemId: string; clipartHint?: string }>,
): Promise<Map<string, ClipartMatch | null>> {
  const out = new Map<string, ClipartMatch | null>();
  await Promise.all(
    items.map(async (it) => {
      if (!it.clipartHint || !it.clipartHint.trim()) {
        out.set(it.itemId, null);
        return;
      }
      const hits = await findClipartByHint(it.clipartHint, { limit: 1 });
      out.set(it.itemId, hits[0] ?? null);
    }),
  );
  return out;
}

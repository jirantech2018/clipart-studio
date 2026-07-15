// Knowledge CMS service — DB row 를 domain 타입으로 변환하고, knowledge + images 를
// 한꺼번에 로드하는 헬퍼를 제공한다. RLS 가 authenticated 를 차단하므로 이 서비스는
// 반드시 service_role 클라이언트로만 호출한다.

import { classifyKnowledge } from '@/services/knowledge/classifier';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import { KNOWLEDGE_API_IMAGE_LIMIT } from '@/types/domain';

import type { KnowledgeMatch } from '@/services/knowledge/classifier';
import type {
  Knowledge,
  KnowledgeImage,
  ReferenceType,
} from '@/types/domain';

export type { KnowledgeMatch } from '@/services/knowledge/classifier';

interface KnowledgeRow {
  id: string;
  name: string;
  description: string;
  triggers: string[] | null;
  negative_prompt: string;
  category: string | null;
  sort_order: number | null;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface KnowledgeImageRow {
  id: string;
  knowledge_id: string;
  r2_key: string;
  caption: string;
  viewpoint: string;
  reference_type: ReferenceType;
  is_primary: boolean;
  sort_order: number;
  width: number;
  height: number;
  filename: string | null;
  created_at: string;
}

export function imageRowToDomain(row: KnowledgeImageRow): KnowledgeImage {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    r2Key: row.r2_key,
    url: publicUrl(row.r2_key),
    caption: row.caption,
    viewpoint: row.viewpoint,
    referenceType: row.reference_type,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
    filename: row.filename,
    createdAt: row.created_at,
  };
}

export function knowledgeRowToDomain(
  row: KnowledgeRow,
  images: KnowledgeImage[] = [],
): Knowledge {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggers: row.triggers ?? [],
    negativePrompt: row.negative_prompt,
    category: row.category ?? '',
    sortOrder: row.sort_order ?? 100,
    priority: row.priority,
    enabled: row.enabled,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const KNOWLEDGE_SELECT =
  'id, name, description, triggers, negative_prompt, category, sort_order, priority, enabled, created_at, updated_at';

/**
 * knowledge 한 건을 이미지까지 함께 조회. 없으면 null.
 */
export async function loadKnowledgeWithImages(
  id: string,
): Promise<Knowledge | null> {
  const supabase = createSupabaseServiceClient();
  const { data: kRow, error: kErr } = await supabase
    .from('knowledge')
    .select(KNOWLEDGE_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (kErr) {
    console.error('[knowledge] load knowledge', kErr);
    return null;
  }
  if (!kRow) return null;

  const { data: imgRows, error: imgErr } = await supabase
    .from('knowledge_images')
    .select(
      'id, knowledge_id, r2_key, caption, viewpoint, reference_type, is_primary, sort_order, width, height, filename, created_at',
    )
    .eq('knowledge_id', id)
    .order('reference_type', { ascending: true })
    .order('sort_order', { ascending: true });

  if (imgErr) {
    console.error('[knowledge] load images', imgErr);
    return knowledgeRowToDomain(kRow as unknown as KnowledgeRow, []);
  }

  const images = (imgRows ?? []).map((r) =>
    imageRowToDomain(r as unknown as KnowledgeImageRow),
  );
  return knowledgeRowToDomain(kRow as unknown as KnowledgeRow, images);
}

/**
 * 전체 knowledge 목록 + 이미지. 관리자 UI list 용.
 * enabled 필터, name 부분검색 옵션.
 */
export async function loadKnowledgeList(opts?: {
  enabledOnly?: boolean;
  search?: string;
}): Promise<Knowledge[]> {
  const supabase = createSupabaseServiceClient();

  let kQuery = supabase
    .from('knowledge')
    .select(KNOWLEDGE_SELECT)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('priority', { ascending: true });

  if (opts?.enabledOnly) {
    kQuery = kQuery.eq('enabled', true);
  }
  if (opts?.search && opts.search.trim().length > 0) {
    kQuery = kQuery.ilike('name', `%${opts.search.trim()}%`);
  }

  const { data: kRows, error: kErr } = await kQuery;
  if (kErr) {
    console.error('[knowledge] load list', kErr);
    return [];
  }
  if (!kRows || kRows.length === 0) return [];

  const knowledgeIds = kRows.map((k) => (k as { id: string }).id);

  const { data: imgRows, error: imgErr } = await supabase
    .from('knowledge_images')
    .select(
      'id, knowledge_id, r2_key, caption, viewpoint, reference_type, is_primary, sort_order, width, height, filename, created_at',
    )
    .in('knowledge_id', knowledgeIds)
    .order('reference_type', { ascending: true })
    .order('sort_order', { ascending: true });

  if (imgErr) {
    console.error('[knowledge] list images', imgErr);
  }

  const byKnowledgeId = new Map<string, KnowledgeImage[]>();
  for (const r of imgRows ?? []) {
    const row = r as unknown as KnowledgeImageRow;
    const bucket = byKnowledgeId.get(row.knowledge_id) ?? [];
    bucket.push(imageRowToDomain(row));
    byKnowledgeId.set(row.knowledge_id, bucket);
  }

  return kRows.map((k) =>
    knowledgeRowToDomain(
      k as unknown as KnowledgeRow,
      byKnowledgeId.get((k as { id: string }).id) ?? [],
    ),
  );
}

// ------------------------------------------------------------
// Pipeline entry points (Phase C)
// ------------------------------------------------------------

/**
 * 활성 Knowledge 를 로드해 사용자 프롬프트와 매칭시켜 정렬된 결과를 돌려준다.
 * 매칭이 하나도 없으면 빈 배열을 돌려주므로 caller 는 자연스럽게 prompt_rules
 * fallback 경로를 탈 수 있다.
 */
export async function matchKnowledgeForPrompt(
  prompt: string,
): Promise<KnowledgeMatch[]> {
  const list = await loadKnowledgeList({ enabledOnly: true });
  if (list.length === 0) return [];
  try {
    return await classifyKnowledge(prompt, list);
  } catch (err) {
    console.error('[knowledge] classify failed', err);
    return [];
  }
}

export interface ComposedKnowledge {
  /** [Knowledge] + [User] + [Negative] 로 조립된 최종 프롬프트. */
  prompt: string;
  /** 실제 이미지 API 에 첨부할 positive 대표 이미지들. 최대 KNOWLEDGE_API_IMAGE_LIMIT 장. */
  referenceImageKeys: string[];
  /** 실제 파이프라인 로깅용. */
  appliedKnowledgeIds: string[];
  /** 이미지가 없는 매칭까지 포함해 참고용으로 함께 노출. */
  matches: KnowledgeMatch[];
}

/**
 * Knowledge 매칭 결과와 이미 조립된 사용자 섹션을 받아 최종 프롬프트 텍스트를 조립하고
 * 이미지 API 첨부용 R2 key 목록을 선별한다.
 *
 * - description 은 매칭 상위부터 순서대로 나열.
 * - negative_prompt 는 중복 제거해서 하나의 [Negative] 블록으로.
 * - referenceImageKeys 는 각 Knowledge 의 primary positive 이미지가 있으면 그것부터,
 *   없으면 그 Knowledge 의 sort_order 첫 positive 이미지를 사용. 상한
 *   KNOWLEDGE_API_IMAGE_LIMIT 장까지 취한 뒤 잘라낸다.
 */
export function composeKnowledgePrompt(
  matches: KnowledgeMatch[],
  userSection: string,
): ComposedKnowledge {
  if (matches.length === 0) {
    return {
      prompt: userSection,
      referenceImageKeys: [],
      appliedKnowledgeIds: [],
      matches: [],
    };
  }

  const knowledgeLines: string[] = [];
  const negativeLines: string[] = [];
  const seenNegative = new Set<string>();
  const referenceImageKeys: string[] = [];
  const appliedKnowledgeIds: string[] = [];

  for (const match of matches) {
    const k = match.knowledge;
    knowledgeLines.push(`- ${k.name}: ${k.description}`);
    appliedKnowledgeIds.push(k.id);

    if (k.negativePrompt.trim().length > 0) {
      const norm = k.negativePrompt.trim();
      if (!seenNegative.has(norm)) {
        seenNegative.add(norm);
        negativeLines.push(`- ${norm}`);
      }
    }

    if (referenceImageKeys.length < KNOWLEDGE_API_IMAGE_LIMIT) {
      const positives = k.images
        .filter((img) => img.referenceType === 'positive')
        .sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          return a.sortOrder - b.sortOrder;
        });
      const pick = positives[0];
      if (pick) referenceImageKeys.push(pick.r2Key);
    }
  }

  const parts: string[] = [];
  if (knowledgeLines.length > 0) {
    parts.push(`[Knowledge]\n${knowledgeLines.join('\n')}`);
  }
  parts.push(`[User]\n${userSection}`);
  if (negativeLines.length > 0) {
    parts.push(`[Negative]\n${negativeLines.join('\n')}`);
  }

  return {
    prompt: parts.join('\n\n'),
    referenceImageKeys: referenceImageKeys.slice(0, KNOWLEDGE_API_IMAGE_LIMIT),
    appliedKnowledgeIds,
    matches,
  };
}

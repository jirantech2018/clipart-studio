// Knowledge CMS service — DB row 를 domain 타입으로 변환하고, knowledge + images 를
// 한꺼번에 로드하는 헬퍼를 제공한다. RLS 가 authenticated 를 차단하므로 이 서비스는
// 반드시 service_role 클라이언트로만 호출한다.

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import type {
  Knowledge,
  KnowledgeImage,
  ReferenceType,
} from '@/types/domain';

interface KnowledgeRow {
  id: string;
  name: string;
  description: string;
  triggers: string[] | null;
  negative_prompt: string;
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
    priority: row.priority,
    enabled: row.enabled,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * knowledge 한 건을 이미지까지 함께 조회. 없으면 null.
 */
export async function loadKnowledgeWithImages(
  id: string,
): Promise<Knowledge | null> {
  const supabase = createSupabaseServiceClient();
  const { data: kRow, error: kErr } = await supabase
    .from('knowledge')
    .select('id, name, description, triggers, negative_prompt, priority, enabled, created_at, updated_at')
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
    .select('id, name, description, triggers, negative_prompt, priority, enabled, created_at, updated_at')
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

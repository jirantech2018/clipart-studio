'use client';

// Design Ref: §5.4 LineageTree — parents + children up to 3 levels
// Cheap to enable/disable per image detail view; small payload, cached by react-query.

import { useQuery } from '@tanstack/react-query';

export interface LineageNode {
  id: string;
  prompt: string;
  thumbnailUrl: string;
  parentImageId: string | null;
  width?: number;
  height?: number;
}

export interface LineageResponse {
  self: LineageNode;
  ancestors: LineageNode[];
  descendants: LineageNode[][];
  ancestorTruncated: boolean;
  descendantTruncated: boolean;
}

async function fetchLineage(id: string): Promise<LineageResponse> {
  const res = await fetch(`/api/images/${id}/lineage`);
  if (!res.ok) throw new Error('계보를 불러오지 못했습니다');
  const json = (await res.json()) as { data: LineageResponse };
  return json.data;
}

export function useLineage(id: string) {
  return useQuery({
    queryKey: ['lineage', id],
    queryFn: () => fetchLineage(id),
    enabled: !!id,
  });
}

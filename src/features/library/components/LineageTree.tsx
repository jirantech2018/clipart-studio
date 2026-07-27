'use client';

// Design Ref: §5.4 LineageTree — 부모/자식 3단계 시각화, 그 이상은 truncated 표시.

import { ChevronRight, GitBranch, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLineage } from '@/features/library/hooks/useLineage';
import { cn } from '@/lib/utils';

import type { LineageNode } from '@/features/library/hooks/useLineage';

function NodeThumb({ node, size = 'md', highlight }: {
  node: LineageNode;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  const dim = size === 'lg' ? 'h-20 w-20' : size === 'md' ? 'h-16 w-16' : 'h-12 w-12';
  return (
    <Link
      href={`/image/${node.id}`}
      title={node.prompt}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border bg-muted transition-transform hover:scale-[1.03]',
        dim,
        highlight && 'ring-2 ring-primary',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={node.thumbnailUrl}
        alt={node.prompt}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </Link>
  );
}

export function LineageTree({ imageId }: { imageId: string }) {
  const { data, isLoading, isError } = useLineage(imageId);

  if (isLoading || isError || !data) return null;

  const { self, ancestors, descendants, ancestorTruncated, descendantTruncated } = data;
  const hasAncestors = ancestors.length > 0;
  const hasDescendants = descendants.some((level) => level.length > 0);

  if (!hasAncestors && !hasDescendants) return null;

  // Ancestors are ordered from immediate parent → older. Reverse for left-to-right timeline.
  const ancestorChain = [...ancestors].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GitBranch className="h-5 w-5" aria-hidden="true" />
          계보 (3단계)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasAncestors && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">부모 이미지</h3>
            <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
              {ancestorTruncated && (
                <>
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </>
              )}
              {ancestorChain.map((node) => (
                <div key={node.id} className="flex items-center gap-2">
                  <NodeThumb node={node} size="sm" />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
              ))}
              <NodeThumb node={self} size="md" highlight />
            </div>
          </section>
        )}

        {hasDescendants && (
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">자식 이미지</h3>
            <div className="space-y-3">
              {descendants.map((level, idx) => (
                <div key={idx} className="space-y-1">
                  <p className="text-sm uppercase tracking-wide text-muted-foreground">
                    {idx === 0 ? '직계 자식' : idx === 1 ? '2단계' : '3단계'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {level.map((node) => (
                      <NodeThumb key={node.id} node={node} size="sm" />
                    ))}
                  </div>
                </div>
              ))}
              {descendantTruncated && (
                <p className="text-sm text-muted-foreground">
                  일부 단계에서 자식 이미지가 많아 12개까지만 표시했습니다.
                </p>
              )}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

// 상세 편집 페이지의 client 래퍼. detail fetch + 메타 편집 + 이미지 편집 조합.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { KnowledgeImagesEditor } from '@/features/knowledge/components/KnowledgeImagesEditor';
import { KnowledgeMetaForm } from '@/features/knowledge/components/KnowledgeMetaForm';
import { useKnowledgeDetail } from '@/features/knowledge/hooks/useKnowledge';

export function KnowledgeDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useKnowledgeDetail(id);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-64 animate-pulse rounded-md bg-muted" />
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
          Knowledge 를 불러오지 못했어요.
          <button
            type="button"
            onClick={() => refetch()}
            className="text-primary underline-offset-4 hover:underline"
          >
            다시 시도
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/knowledge')}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            목록으로
          </button>
        </CardContent>
      </Card>
    );
  }

  const knowledge = data.knowledge;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/knowledge"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Knowledge 목록으로
      </Link>

      <KnowledgeMetaForm initial={knowledge} />

      <div className="space-y-2">
        <h2 className="text-base font-semibold">참고 이미지</h2>
        <KnowledgeImagesEditor knowledgeId={knowledge.id} images={knowledge.images} />
      </div>
    </div>
  );
}

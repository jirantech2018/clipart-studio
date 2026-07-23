'use client';

// 조직 라이브러리용 이미지 카드. 커뮤니티 큐레이션 상태를 뱃지로 표시하고,
// 조직 owner 에게는 공유 라이브러리 공개/해제 액션을 노출한다.
//
// 상태 (사용자 명세):
//   미공개                   — is_on_community=false
//   공유 라이브러리 공개 중   — is_on_community=true AND source_org=현재 조직
//   기존 공개 이미지          — is_on_community=true AND source_org=NULL (grandfather)
//   다른 조직에서 공개 중     — is_on_community=true AND source_org≠현재 조직
//
// Owner 액션:
//   미공개 → "공유 라이브러리에 공개"
//   공유 라이브러리 공개 중 → "공유 라이브러리에서 해제"
//   기존 공개 이미지 / 다른 조직에서 공개 중 → 액션 없음 (현재 조직에서 제어 불가)

import { Download, Globe2, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import {
  usePublishToCommunity,
  useUnpublishFromCommunity,
  useUnshareImage,
} from '@/features/organization/hooks/useOrganizationShares';
import { cn } from '@/lib/utils';

import type { OrganizationImage } from '@/features/organization/hooks/useOrganizationShares';

type PublishStatus = 'unpublished' | 'publishedByThisOrg' | 'grandfather' | 'publishedByOtherOrg';

function resolveStatus(
  image: OrganizationImage,
  currentOrgId: string | null,
): PublishStatus {
  if (!image.isOnCommunity) return 'unpublished';
  if (image.communitySourceOrganizationId === null) return 'grandfather';
  if (currentOrgId && image.communitySourceOrganizationId === currentOrgId) {
    return 'publishedByThisOrg';
  }
  return 'publishedByOtherOrg';
}

const STATUS_LABEL: Record<PublishStatus, string> = {
  unpublished: '미공개',
  publishedByThisOrg: '공유 라이브러리 공개 중',
  grandfather: '기존 공개 이미지',
  publishedByOtherOrg: '다른 조직에서 공개 중',
};

const STATUS_TONE: Record<PublishStatus, string> = {
  unpublished: 'bg-muted text-muted-foreground',
  publishedByThisOrg: 'bg-primary text-primary-foreground',
  grandfather: 'bg-amber-100 text-amber-900',
  publishedByOtherOrg: 'bg-slate-200 text-slate-700',
};

export function OrganizationImageCard({
  slug,
  orgId,
  image,
  canUnshare,
  isOrgOwner,
}: {
  slug: string;
  orgId: string | null;
  image: OrganizationImage;
  canUnshare: boolean;
  isOrgOwner: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const unshare = useUnshareImage();
  const publish = usePublishToCommunity(slug);
  const unpublish = useUnpublishFromCommunity(slug);

  const status = resolveStatus(image, orgId);
  const busy = publish.isPending || unpublish.isPending;

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadImageFile(image.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
    }
  }

  async function handleUnshare() {
    if (!confirm('이 이미지를 조직 라이브러리에서 내릴까요? (원본은 그대로 유지됩니다)')) return;
    try {
      await unshare.mutateAsync({ slug, imageId: image.id });
      toast.success('조직에서 내렸어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '내리기 실패');
    }
  }

  async function handlePublish() {
    try {
      await publish.mutateAsync([image.id]);
      toast.success('공유 라이브러리에 공개했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공개 실패');
    }
  }

  async function handleUnpublish() {
    if (!confirm('이 이미지를 공유 라이브러리에서 내릴까요? (조직 라이브러리에는 그대로 남습니다)')) return;
    try {
      await unpublish.mutateAsync([image.id]);
      toast.success('공유 라이브러리에서 내렸어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패');
    }
  }

  return (
    <div
      className="group relative overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow"
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
    >
      <Link
        href={`/image/${image.id}`}
        className="block h-full w-full"
        title={image.prompt}
        aria-label={image.prompt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />
      </Link>

      <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
        <AIGeneratedBadge />
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm',
            STATUS_TONE[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleDownload}
          disabled={downloading}
          className="h-8 px-2 shadow-md"
        >
          {downloading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Download className="mr-1 h-3 w-3" />
          )}
          다운로드
        </Button>

        {/* Owner 전용 공개/해제 액션 — grandfather / 다른 조직 소스는 노출 안 함 */}
        {isOrgOwner && status === 'unpublished' && (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={handlePublish}
            disabled={busy}
            className="h-8 px-2 shadow-md"
            title="공유 라이브러리에 공개"
          >
            {publish.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Globe2 className="mr-1 h-3 w-3" />
            )}
            공개
          </Button>
        )}
        {isOrgOwner && status === 'publishedByThisOrg' && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleUnpublish}
            disabled={busy}
            className="h-8 px-2 shadow-md"
            title="공유 라이브러리에서 해제"
          >
            {unpublish.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Globe2 className="mr-1 h-3 w-3" />
            )}
            해제
          </Button>
        )}

        {canUnshare && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleUnshare}
            disabled={unshare.isPending}
            className="h-8 px-2 shadow-md text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="조직에서 내리기"
            aria-label="조직에서 내리기"
          >
            {unshare.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

'use client';

// 조직에 공유된 이미지 그리드. LibraryGrid 와 유사한 무한 스크롤 패턴.
// P5-C Phase B-2: multi-select 인프라 + 액션바 (ZIP · owner 전용 공개/해제/제거).
//
// 다중선택 대상 자동 필터 정책 (사용자 결정 - a):
//   선택된 이미지가 여러 상태로 섞여 있어도 액션을 막지 않는다. 각 액션은
//   자기 자격에 맞는 이미지만 대상으로 삼고, 대상 개수를 버튼 라벨에
//   표시한다. 대상 0 이면 비활성화. 완료 후 성공/제외/실패 개수를 toast 로.

import { ArrowLeft, Download, Globe2, GlobeLock, Loader2, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { MultiSelectActionBar } from '@/components/multiselect/MultiSelectActionBar';
import type { MultiSelectAction } from '@/components/multiselect/MultiSelectActionBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  OrganizationImageCard,
  resolveStatus,
} from '@/features/organization/components/OrganizationImageCard';
import {
  downloadOrgImagesAsZip,
  useOrganizationImages,
  usePublishToCommunity,
  useUnpublishFromCommunity,
  useUnshareImage,
} from '@/features/organization/hooks/useOrganizationShares';
import { useOrganization } from '@/features/organization/hooks/useOrganizations';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';
import { cn } from '@/lib/utils';

import type { OrgLibraryFilter } from '@/features/organization/hooks/useOrganizationShares';
import type { SelectionScope } from '@/lib/store/selectionStore';

const FILTER_LABELS: Record<OrgLibraryFilter, string> = {
  all: '전체',
  unpublished: '미공개',
  published: '공유 라이브러리 공개 중',
};

export function OrganizationLibraryGrid({
  slug,
  currentUserId,
  hideOrgHeader = false,
}: {
  slug: string;
  currentUserId: string;
  /** 조직 홈에 embed 될 때 상단의 뒤로가기 + 조직 이름 헤더를 숨긴다. */
  hideOrgHeader?: boolean;
}) {
  const [filter, setFilter] = useState<OrgLibraryFilter>('all');
  const [zipPending, setZipPending] = useState(false);
  const [batchUnsharePending, setBatchUnsharePending] = useState(false);
  const { data: orgData, isLoading: orgLoading } = useOrganization(slug);
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOrganizationImages(slug, filter, 'newest');

  const org = orgData?.organization;
  const isOrgOwner = org?.myRole === 'owner';
  const orgId = org?.id ?? null;

  const selectionScope: SelectionScope = `organization:${slug}`;
  const selection = useMultiSelection(selectionScope);

  const publish = usePublishToCommunity(slug);
  const unpublish = useUnpublishFromCommunity(slug);
  const unshare = useUnshareImage();

  const images = useMemo(
    () => data?.pages.flatMap((p) => p.images) ?? [],
    [data],
  );

  // id → image 매핑. 액션 자격 판단에 사용.
  const imageIndex = useMemo(() => {
    const map = new Map(images.map((i) => [i.id, i]));
    return map;
  }, [images]);

  // 현재 선택된 것 중 로드된 이미지들만 (다른 페이지에 있어도 store 에는 있을 수 있음).
  const selectedResolved = useMemo(
    () =>
      selection.selectedIds
        .map((id) => imageIndex.get(id))
        .filter((v): v is NonNullable<typeof v> => !!v),
    [selection.selectedIds, imageIndex],
  );

  const publishTargetIds = useMemo(
    () =>
      selectedResolved
        .filter((img) => resolveStatus(img, orgId) === 'unpublished')
        .map((img) => img.id),
    [selectedResolved, orgId],
  );
  const unpublishTargetIds = useMemo(
    () =>
      selectedResolved
        .filter((img) => resolveStatus(img, orgId) === 'publishedByThisOrg')
        .map((img) => img.id),
    [selectedResolved, orgId],
  );
  // ZIP / 조직에서 제거는 선택된 전부 대상.
  const totalSelectedIds = selection.selectedIds;
  // "조직에서 제거" 안내 — 이 조직 소스로 커뮤니티 공개 중인 게 포함되면 표시.
  const removeAlsoUnpublishes = useMemo(
    () =>
      selectedResolved.filter((img) => resolveStatus(img, orgId) === 'publishedByThisOrg')
        .length,
    [selectedResolved, orgId],
  );

  // 필터·조직 변경 시 선택 초기화. 페이지 언마운트 시에도.
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, filter]);
  useEffect(() => {
    return () => selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSentinel = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useIntersection(onSentinel, {
    enabled: hasNextPage && !isFetchingNextPage,
  });

  // 배치 액션 핸들러들.

  async function handleBatchPublish() {
    const targets = publishTargetIds;
    const excluded = selection.count - targets.length;
    if (targets.length === 0) return;
    if (
      !confirm(
        `${targets.length}개 이미지를 공유 라이브러리에 공개할까요?` +
          (excluded > 0 ? `\n(대상 아님으로 제외: ${excluded}개)` : ''),
      )
    ) {
      return;
    }
    try {
      const res = await publish.mutateAsync(targets);
      const success = res.publishedCount;
      const serverSkipped = res.skippedCount;
      const totalExcluded = excluded + serverSkipped;
      toast.success(
        totalExcluded > 0
          ? `공개 완료 ${success}개 · 제외 ${totalExcluded}개`
          : `공개 완료 ${success}개`,
      );
      selection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공개 실패');
    }
  }

  async function handleBatchUnpublish() {
    const targets = unpublishTargetIds;
    const excluded = selection.count - targets.length;
    if (targets.length === 0) return;
    if (
      !confirm(
        `${targets.length}개 이미지를 공유 라이브러리에서 해제할까요?` +
          (excluded > 0 ? `\n(대상 아님으로 제외: ${excluded}개)` : ''),
      )
    ) {
      return;
    }
    try {
      const res = await unpublish.mutateAsync(targets);
      const success = res.unpublishedCount;
      const serverSkipped = targets.length - success;
      const totalExcluded = excluded + serverSkipped;
      toast.success(
        totalExcluded > 0
          ? `해제 완료 ${success}개 · 제외 ${totalExcluded}개`
          : `해제 완료 ${success}개`,
      );
      selection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '해제 실패');
    }
  }

  async function handleBatchZip() {
    if (zipPending) return;
    const ids = totalSelectedIds;
    if (ids.length === 0) return;
    setZipPending(true);
    try {
      await downloadOrgImagesAsZip(slug, ids);
      toast.success('다운로드를 시작했어요');
      selection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 다운로드 실패');
    } finally {
      setZipPending(false);
    }
  }

  async function handleBatchRemove() {
    if (batchUnsharePending) return;
    const ids = totalSelectedIds;
    if (ids.length === 0) return;
    const notice =
      removeAlsoUnpublishes > 0
        ? `\n\n선택 중 ${removeAlsoUnpublishes}개는 현재 조직을 통해 공유 라이브러리에도 공개돼 있어요. 조직에서 제거하면 공유 라이브러리에서도 자동으로 내려갑니다.`
        : '';
    if (
      !confirm(
        `${ids.length}개 이미지를 조직 라이브러리에서 내릴까요? (원본은 그대로 유지됩니다)${notice}`,
      )
    ) {
      return;
    }
    setBatchUnsharePending(true);
    // 개별 unshare 를 병렬 처리하고 개별 결과 집계.
    let success = 0;
    let failed = 0;
    await Promise.all(
      ids.map(async (id) => {
        try {
          await unshare.mutateAsync({ slug, imageId: id });
          success += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBatchUnsharePending(false);
    if (failed === 0) {
      toast.success(`조직에서 내렸어요 ${success}개`);
    } else {
      toast.error(`제거 ${success}개 · 실패 ${failed}개`);
    }
    selection.clear();
  }

  const actions: MultiSelectAction[] = useMemo(() => {
    const list: MultiSelectAction[] = [];

    list.push({
      key: 'download-zip',
      label: zipPending
        ? 'ZIP 만드는 중…'
        : `ZIP 다운로드 (${totalSelectedIds.length})`,
      icon: zipPending ? Loader2 : Download,
      variant: 'default',
      isPending: zipPending,
      onClick: handleBatchZip,
      disabled: totalSelectedIds.length === 0,
    });

    if (isOrgOwner) {
      list.push({
        key: 'publish',
        label: publish.isPending
          ? '공개 중…'
          : `공유 라이브러리 공개 (${publishTargetIds.length})`,
        icon: publish.isPending ? Loader2 : Globe2,
        variant: 'outline',
        isPending: publish.isPending,
        onClick: handleBatchPublish,
        disabled: publishTargetIds.length === 0,
      });
      list.push({
        key: 'unpublish',
        label: unpublish.isPending
          ? '해제 중…'
          : `공유 라이브러리 해제 (${unpublishTargetIds.length})`,
        icon: unpublish.isPending ? Loader2 : GlobeLock,
        variant: 'outline',
        isPending: unpublish.isPending,
        onClick: handleBatchUnpublish,
        disabled: unpublishTargetIds.length === 0,
      });
    }

    list.push({
      key: 'remove',
      label: batchUnsharePending
        ? '제거 중…'
        : `조직에서 제거 (${totalSelectedIds.length})`,
      icon: batchUnsharePending ? Loader2 : Trash2,
      variant: 'destructive',
      isPending: batchUnsharePending,
      onClick: handleBatchRemove,
      disabled: totalSelectedIds.length === 0,
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zipPending,
    publish.isPending,
    unpublish.isPending,
    batchUnsharePending,
    totalSelectedIds.length,
    publishTargetIds.length,
    unpublishTargetIds.length,
    isOrgOwner,
  ]);

  if (orgLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (!org) {
    return <p className="text-sm text-muted-foreground">조직을 찾을 수 없어요.</p>;
  }

  return (
    <div className="space-y-4">
      {!hideOrgHeader && (
        <Link
          href={`/organization/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {org.name}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">조직 라이브러리</h2>
          <p className="text-sm text-muted-foreground">
            멤버들이 이 조직에 공유한 이미지 모음이에요.
          </p>
        </div>
        <Link
          href={`/generate?org=${slug}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />이 조직에서 생성
        </Link>
      </div>

      {/* 공개 상태 필터 — 세그먼트 컨트롤 형태 */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1 text-sm">
        {(['all', 'unpublished', 'published'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              filter === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={filter === key}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="mb-3 aspect-square animate-pulse break-inside-avoid rounded-lg bg-muted"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            불러오는 중 문제가 생겼어요.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : images.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            {filter === 'all' ? (
              <>
                <p>아직 이 조직에 공유된 이미지가 없어요.</p>
                <p className="text-xs">
                  내 라이브러리에서 이미지 상세를 열고 "조직에 공유" 를 눌러 얹을 수 있어요.
                </p>
              </>
            ) : filter === 'unpublished' ? (
              <p>미공개 상태의 이미지가 없어요.</p>
            ) : (
              <p>이 조직에서 공유 라이브러리에 공개한 이미지가 없어요.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
            {images.map((image) => (
              <div key={image.id} className="mb-3 break-inside-avoid">
                <OrganizationImageCard
                  slug={slug}
                  orgId={orgId}
                  selectionScope={selectionScope}
                  image={image}
                  canUnshare={image.userId === currentUserId || isOrgOwner}
                  isOrgOwner={isOrgOwner}
                />
              </div>
            ))}
            {isFetchingNextPage &&
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="mb-3 aspect-square animate-pulse break-inside-avoid rounded-lg bg-muted"
                  aria-hidden="true"
                />
              ))}
          </div>
          {hasNextPage && (
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
          )}
          {!hasNextPage && (
            <div className="flex justify-center py-4 text-xs text-muted-foreground">
              모두 불러왔어요
            </div>
          )}
        </>
      )}

      <MultiSelectActionBar
        count={selection.count}
        selectedIds={totalSelectedIds}
        actions={actions}
        onClear={selection.clear}
      />
    </div>
  );
}

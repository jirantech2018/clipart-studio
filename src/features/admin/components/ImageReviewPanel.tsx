'use client';

// M5 Super Admin Image Review — 전체 이미지 그리드 + 필터 + trash/restore.

import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
  useAdminImages,
  useAdminRestoreImage,
  useAdminTrashImage,
  type AdminImageRow,
  type AdminImagesFilters,
  type AdminTrashReason,
} from '@/features/admin/hooks/useAdminImages';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { cn } from '@/lib/utils';

const REASON_LABEL: Record<AdminTrashReason, string> = {
  LOW_QUALITY: '품질이 낮은 결과',
  GENERATION_ERROR: '생성 오류',
  TEXT_ERROR: '텍스트 오류',
  DUPLICATE: '중복 이미지',
  INAPPROPRIATE: '부적절한 이미지',
  OTHER: '기타',
};

const TYPE_LABEL: Record<'all' | 'personal' | 'general', string> = {
  all: '전체',
  personal: '개인',
  general: '조직',
};

const STATUS_LABEL: Record<'all' | 'active' | 'trashed', string> = {
  all: '전체',
  active: '활성',
  trashed: '휴지통',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ImageReviewPanel() {
  const [filters, setFilters] = useState<AdminImagesFilters>({
    status: 'all',
    type: 'all',
  });
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useAdminImages(filters);
  const trash = useAdminTrashImage();
  const restore = useAdminRestoreImage();
  const [trashTarget, setTrashTarget] = useState<AdminImageRow | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');

  const images = (data?.pages ?? []).flatMap((p) =>
    p && Array.isArray(p.images) ? p.images : [],
  );

  // 스크롤 sentinel 이 뷰포트에 들어오면 다음 페이지 fetch.
  const onSentinel = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const sentinelRef = useIntersection(onSentinel, {
    enabled: hasNextPage && !isFetchingNextPage,
  });
  const filtered = ownerQuery
    ? images.filter((i) =>
        (i.ownerEmail ?? '').toLowerCase().includes(ownerQuery.trim().toLowerCase()),
      )
    : images;

  async function handleRestore(id: string) {
    try {
      await restore.mutateAsync(id);
      toast.success('복원했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '복원 실패');
    }
  }

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="space-y-3 rounded-md border bg-card p-3">
        <FilterRow label="상태">
          {(['all', 'active', 'trashed'] as const).map((k) => (
            <Chip
              key={k}
              active={filters.status === k}
              onClick={() => setFilters({ ...filters, status: k })}
            >
              {STATUS_LABEL[k]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Workspace">
          {(['all', 'personal', 'general'] as const).map((k) => (
            <Chip
              key={k}
              active={filters.type === k}
              onClick={() => setFilters({ ...filters, type: k })}
            >
              {TYPE_LABEL[k]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="생성일">
          <input
            type="date"
            value={filters.dateFrom ? filters.dateFrom.slice(0, 10) : ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={filters.dateTo ? filters.dateTo.slice(0, 10) : ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
        </FilterRow>
        <FilterRow label="이메일 검색">
          <input
            type="search"
            value={ownerQuery}
            onChange={(e) => setOwnerQuery(e.target.value)}
            placeholder="생성자 이메일 일부"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
          >
            {isFetching ? '새로고침…' : '새로고침'}
          </button>
        </FilterRow>
      </div>

      {/* 그리드 */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <p className="rounded-md border p-6 text-center text-sm text-destructive">
          불러오지 못했어요.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          결과가 없어요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((img) => (
            <div
              key={img.id}
              className={cn(
                'group relative overflow-hidden rounded-lg border bg-muted shadow-sm',
                img.trashStatus === 'TRASHED' && 'opacity-70',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.thumbnailUrl}
                alt={img.prompt}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
                {img.trashStatus === 'TRASHED' && (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium text-white shadow">
                    휴지통
                  </span>
                )}
                {img.organizationName && (
                  <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white shadow">
                    {img.organizationName}
                  </span>
                )}
              </div>
              <div className="bg-background p-2 text-[11px]">
                <div className="truncate text-muted-foreground">
                  {img.ownerEmail ?? '(email 없음)'}
                </div>
                <div className="text-muted-foreground/70">{formatDateTime(img.createdAt)}</div>
                {img.trashStatus === 'TRASHED' && img.trashReason && (
                  <div className="mt-1 line-clamp-1 text-destructive" title={img.trashReason}>
                    {img.trashReason}
                  </div>
                )}
                <div className="mt-2 flex gap-1">
                  {img.trashStatus === 'ACTIVE' ? (
                    <button
                      type="button"
                      onClick={() => setTrashTarget(img)}
                      disabled={trash.isPending}
                      className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-destructive px-2 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" /> 휴지통
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRestore(img.id)}
                      disabled={restore.isPending}
                      className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {restore.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      복원
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 무한 스크롤 sentinel + 상태 표시 */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="pt-2 text-center text-xs text-muted-foreground">
          {hasNextPage ? (
            <>
              <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
              {isFetchingNextPage && (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  이미지를 더 불러오는 중…
                </span>
              )}
            </>
          ) : (
            <span>모든 이미지 표시가 완료되었습니다.</span>
          )}
        </div>
      )}

      {/* Trash 이유 선택 모달 */}
      <TrashReasonModal
        image={trashTarget}
        onClose={() => setTrashTarget(null)}
        onSubmit={async (reason, memo) => {
          if (!trashTarget) return;
          try {
            await trash.mutateAsync({ id: trashTarget.id, reason, memo });
            toast.success('휴지통으로 이동했어요');
            setTrashTarget(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : '휴지통 이동 실패');
          }
        }}
        pending={trash.isPending}
      />
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-3 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function TrashReasonModal({
  image,
  onClose,
  onSubmit,
  pending,
}: {
  image: AdminImageRow | null;
  onClose: () => void;
  onSubmit: (reason: AdminTrashReason, memo?: string) => void | Promise<void>;
  pending: boolean;
}) {
  const [reason, setReason] = useState<AdminTrashReason>('LOW_QUALITY');
  const [memo, setMemo] = useState('');
  if (!image) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">휴지통으로 이동</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {image.ownerEmail} · {image.organizationName ?? '워크스페이스 없음'}
          </p>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium">사유</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REASON_LABEL) as AdminTrashReason[]).map((k) => (
                <Chip key={k} active={reason === k} onClick={() => setReason(k)}>
                  {REASON_LABEL[k]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">메모 (선택)</label>
            <input
              type="text"
              maxLength={500}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="사용자에게 표시됩니다"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reason, memo.trim() || undefined)}
            disabled={pending}
            className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {pending ? '이동 중…' : '휴지통으로 이동'}
          </button>
        </div>
      </div>
    </div>
  );
}

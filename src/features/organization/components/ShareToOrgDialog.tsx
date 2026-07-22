'use client';

// 이미지 상세뷰에서 열리는 조직 공유 다이얼로그.
// 내가 속한 조직 중 이 이미지가 아직 공유되지 않은 곳을 선택해서 얹기.
// UI: 단순 모달 (Radix Dialog 대신 native <dialog> 기반 커스텀; 프로젝트에
// shadcn Dialog 가 없어서 최소한의 인라인 오버레이로 구현).

import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import {
  useImageSharedOrgs,
  useShareImage,
} from '@/features/organization/hooks/useOrganizationShares';
import { cn } from '@/lib/utils';

export function ShareToOrgDialog({
  imageId,
  open,
  onClose,
}: {
  imageId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: orgsData, isLoading: orgsLoading } = useMyOrganizations();
  const { data: sharedData, isLoading: sharedLoading } = useImageSharedOrgs(open ? imageId : null);
  const share = useShareImage();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  // ESC 로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const alreadySharedSlugs = useMemo(() => {
    const s = new Set<string>();
    for (const o of sharedData?.orgs ?? []) s.add(o.slug);
    return s;
  }, [sharedData]);

  const availableOrgs = (orgsData?.organizations ?? []).filter(
    (o) => !alreadySharedSlugs.has(o.slug),
  );

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    try {
      // 여러 조직에 공유 — 병렬 POST.
      await Promise.all(
        Array.from(selected).map((slug) =>
          share.mutateAsync({ slug, imageIds: [imageId] }),
        ),
      );
      toast.success(`${selected.size}개 조직에 공유했어요`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공유 실패');
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
    >
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="share-dialog-title" className="text-base font-semibold">
            조직에 공유
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {orgsLoading || sharedLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (orgsData?.organizations ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              속한 조직이 없어요. 먼저 조직을 만들거나 초대를 수락해주세요.
            </p>
          ) : availableOrgs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              이미 속한 모든 조직에 공유돼 있어요.
            </p>
          ) : (
            <div className="space-y-1">
              {availableOrgs.map((org) => {
                const isSelected = selected.has(org.slug);
                return (
                  <button
                    key={org.slug}
                    type="button"
                    onClick={() => toggle(org.slug)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-accent',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded border',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input',
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground">/{org.slug}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {sharedData?.orgs && sharedData.orgs.length > 0 && (
            <div className="mt-4 space-y-1 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">
                이미 공유된 조직
              </p>
              <div className="flex flex-wrap gap-1">
                {sharedData.orgs.map((o) => (
                  <span
                    key={o.slug}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px]"
                    title={`/${o.slug}`}
                  >
                    {o.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={selected.size === 0 || share.isPending}
          >
            {share.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {selected.size > 0 ? `${selected.size}곳에 공유` : '공유'}
          </Button>
        </div>
      </div>
    </div>
  );
}

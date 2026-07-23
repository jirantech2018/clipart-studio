'use client';

// 조직 공유 다이얼로그.
//
// 두 가지 진입점을 지원:
//   (1) 이미지 상세뷰 — 단일 이미지 (imageIds.length === 1). 이 경우 이미
//       공유된 조직 목록도 별도 섹션으로 안내.
//   (2) 개인 라이브러리 다중선택 — 여러 이미지. 각 조직 옆에 "새로 공유 N개"
//       예정 개수 표시 (share-preview API).
//
// 두 케이스 모두 배치 API `/api/images/share-organizations` 로 처리한다.
// 중복 페어는 서버가 조용히 스킵하고 duplicateCount 로 반환 → 사용자에게
// 결과 메시지로 안내.

import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import {
  useShareToMultipleOrgs,
  useSharePreview,
} from '@/features/organization/hooks/useOrganizationShares';
import { cn } from '@/lib/utils';

export function ShareToOrgDialog({
  imageIds,
  open,
  onClose,
  onDone,
}: {
  imageIds: string[];
  open: boolean;
  onClose: () => void;
  /** 공유 성공 시 부모에게 알림 (선택 초기화 등 후속 처리용) */
  onDone?: () => void;
}) {
  const { data: orgsData, isLoading: orgsLoading } = useMyOrganizations();
  const preview = useSharePreview(imageIds, open);
  const share = useShareToMultipleOrgs();

  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) setSelectedOrgIds(new Set());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 조직별 기존 공유 개수 매핑.
  const existingByOrg = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of preview.data?.perOrg ?? []) {
      map.set(p.organizationId, p.existingCount);
    }
    return map;
  }, [preview.data]);

  const imageCount = preview.data?.eligibleImageCount ?? imageIds.length;
  const isSingleImage = imageIds.length === 1;

  const orgs = orgsData?.organizations ?? [];

  function toggle(orgId: string) {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedOrgIds.size === 0) return;
    try {
      const res = await share.mutateAsync({
        imageIds,
        organizationIds: Array.from(selectedOrgIds),
      });
      const orgCount = selectedOrgIds.size;
      const created = res.createdCount;
      const dup = res.duplicateCount;
      // 결과 메시지 포맷 (사용자 명세):
      //   단일 조직: `조직에 공유했어요 4개 · 이미 공유됨 2개`
      //   여러 조직: `N개 조직에 공유했어요 · 신규 공유 K건 · 이미 공유됨 M건`
      let msg: string;
      if (orgCount === 1) {
        msg = dup > 0
          ? `조직에 공유했어요 ${created}개 · 이미 공유됨 ${dup}개`
          : `조직에 공유했어요 ${created}개`;
      } else {
        msg = dup > 0
          ? `${orgCount}개 조직에 공유했어요 · 신규 공유 ${created}건 · 이미 공유됨 ${dup}건`
          : `${orgCount}개 조직에 공유했어요 · 신규 공유 ${created}건`;
      }
      toast.success(msg);
      onDone?.();
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
            {isSingleImage
              ? '조직에 공유'
              : `${imageCount}개 이미지 조직에 공유`}
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
          {orgsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : orgs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              속한 조직이 없어요. 먼저 조직을 만들거나 초대를 수락해주세요.
            </p>
          ) : (
            <div className="space-y-1">
              {orgs.map((org) => {
                const isSelected = selectedOrgIds.has(org.id);
                const existing = existingByOrg.get(org.id) ?? 0;
                const newlyShared = Math.max(0, imageCount - existing);
                // 모든 이미지가 이미 이 조직에 공유돼 있으면 선택해도 무효(서버 스킵).
                // 그래도 사용자가 선택할 수는 있게 두되 라벨로 명확히 안내.
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => toggle(org.id)}
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
                    {preview.isLoading ? (
                      <span className="text-[11px] text-muted-foreground">…</span>
                    ) : (
                      <div className="flex flex-col items-end text-[11px]">
                        {newlyShared > 0 ? (
                          <span className="font-medium text-primary">
                            새로 공유 {newlyShared}개
                          </span>
                        ) : (
                          <span className="text-muted-foreground">모두 공유됨</span>
                        )}
                        {existing > 0 && (
                          <span className="text-muted-foreground">
                            이미 공유됨 {existing}개
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
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
            disabled={selectedOrgIds.size === 0 || share.isPending}
          >
            {share.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {selectedOrgIds.size > 0 ? `${selectedOrgIds.size}곳에 공유` : '공유'}
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

// STEP 2 카드 — 패키지 모드 ON 시 렌더.
//
// 목표 UI 매칭:
//   [2] AI 추천 제작 구성          [자동 추천됨]
//   설명 문구
//   ─────────────────────────────────────────────
//   ☑ 행사 포스터   설명         [-] N [+]
//   ☑ 가로형 배너   설명         [-] N [+]
//   ...
//   ─────────────────────────────────────────────
//   총 생성 이미지 35장      예상 사용 크레딧 🪙 35
//   [클립아트 만들기 (disabled — Phase 1 이므로)]

import { Coins, Info, Minus, Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { selectVisibleItems } from '@/features/generation-v2/lib/mergePackagePlan';
import { cn } from '@/lib/utils';

import type {
  PackageAiItem,
  PackageItemState,
} from '@/features/generation-v2/lib/packagePlanTypes';

interface Props {
  locked: boolean;
  aiItems: readonly PackageAiItem[];
  itemState: Record<string, PackageItemState>;
  userModifiedItemIds: readonly string[];
  isRecommendationLoading: boolean;
  isRecommendationAuto: boolean;
  onItemStateChange: (nextState: Record<string, PackageItemState>) => void;
  onUserModifiedItemIdsChange: (nextIds: string[]) => void;
}

const MIN_QTY = 0;
const MAX_QTY = 50;

export function PackageOptionCard({
  locked,
  aiItems,
  itemState,
  userModifiedItemIds,
  isRecommendationLoading,
  isRecommendationAuto,
  onItemStateChange,
  onUserModifiedItemIdsChange,
}: Props) {
  const visibleItems = selectVisibleItems({
    packageAiItems: aiItems,
    packageItemState: itemState,
    packageUserModifiedItemIds: userModifiedItemIds,
  });

  const totalImages = visibleItems
    .filter((it) => it.enabled)
    .reduce((sum, it) => sum + it.quantity, 0);

  // 크레딧 정책: 이미지 1장 = 1 크레딧 (기존 batchSize == credits 정책 재사용).
  const expectedCredits = totalImages;

  function markModified(id: string) {
    if (userModifiedItemIds.includes(id)) return;
    onUserModifiedItemIdsChange([...userModifiedItemIds, id]);
  }

  function toggleEnabled(id: string, next: boolean) {
    if (locked) return;
    const prev = itemState[id] ?? {
      enabled: true,
      quantity: aiItems.find((i) => i.id === id)?.defaultQuantity ?? 1,
    };
    onItemStateChange({ ...itemState, [id]: { ...prev, enabled: next } });
    markModified(id);
  }

  function changeQuantity(id: string, delta: number) {
    if (locked) return;
    const prev = itemState[id] ?? {
      enabled: true,
      quantity: aiItems.find((i) => i.id === id)?.defaultQuantity ?? 1,
    };
    const next = Math.max(MIN_QTY, Math.min(MAX_QTY, prev.quantity + delta));
    if (next === prev.quantity) return;
    onItemStateChange({ ...itemState, [id]: { ...prev, quantity: next } });
    markModified(id);
  }

  return (
    <section className="card flex h-full flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            2
          </span>
          <h3 className="text-base font-semibold">AI 추천 제작 구성</h3>
        </div>
        {isRecommendationAuto && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/5 px-2 py-0.5 text-[11px] text-primary">
            <Info className="h-3 w-3" aria-hidden="true" />
            <span>자동 추천됨</span>
            {isRecommendationLoading && <span>· 갱신 중…</span>}
          </span>
        )}
      </header>

      <p className="text-xs text-muted-foreground">
        입력한 정보를 바탕으로 필요한 클립아트 구성을 추천했어요. 항목과 수량은
        자유롭게 변경할 수 있습니다.
      </p>

      <div className="divide-y divide-border/60">
        {visibleItems.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {isRecommendationLoading
              ? 'AI 추천 구성을 불러오는 중…'
              : '목적·대상·스타일을 입력하면 추천 구성이 표시됩니다.'}
          </p>
        ) : (
          visibleItems.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(e) => toggleEnabled(item.id, e.target.checked)}
                disabled={locked}
                className="h-4 w-4 shrink-0 accent-primary"
                aria-label={`${item.name} 사용`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-primary">
                  {item.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.description}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <QuantityButton
                  onClick={() => changeQuantity(item.id, -1)}
                  disabled={locked || item.quantity <= MIN_QTY}
                  aria-label={`${item.name} 수량 감소`}
                >
                  <Minus className="h-3 w-3" />
                </QuantityButton>
                <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums text-foreground">
                  {item.quantity}
                </span>
                <QuantityButton
                  onClick={() => changeQuantity(item.id, +1)}
                  disabled={locked || item.quantity >= MAX_QTY}
                  aria-label={`${item.name} 수량 증가`}
                >
                  <Plus className="h-3 w-3" />
                </QuantityButton>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>총 생성 이미지</span>
          <strong className="tabular-nums text-primary">{totalImages}장</strong>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>예상 사용 크레딧</span>
          <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <strong className="tabular-nums text-primary">
            {expectedCredits}
          </strong>
        </div>
      </div>

      <Button
        type="button"
        // Phase 1 은 실제 생성 파이프라인 없음 → 항상 disabled.
        disabled
        title="이 기능은 준비 중입니다"
        className="mt-auto min-h-[44px] w-full"
      >
        <Sparkles className="mr-1 h-4 w-4" />
        클립아트 만들기
      </Button>
    </section>
  );
}

function QuantityButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        props.className,
      )}
    >
      {children}
    </button>
  );
}

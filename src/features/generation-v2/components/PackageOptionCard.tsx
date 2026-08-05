'use client';

// STEP 2 카드 — 패키지 모드 ON 시 렌더.
//
// 상태는 상위 ConversationBlock 이 BlockOptions.packagePlan 로 관리한다.
// 이 컴포넌트는 nested 객체를 통째로 받아 itemState / userModifiedItemIds
// 만 patch 로 돌려준다. CTA 는 Phase 1 동안 disabled 유지 (Phase 2 에서
// enabled 로만 전환되도록 구조는 유지).

import { Coins, Info, Minus, Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { selectVisibleItems } from '@/features/generation-v2/lib/mergePackagePlan';
import { computePackageTotalSlots } from '@/features/generation-v2/lib/packageSubmit';
import { cn } from '@/lib/utils';

import type {
  PackageItemState,
  PackagePlanState,
} from '@/features/generation-v2/lib/packagePlanTypes';

interface Props {
  locked: boolean;
  plan: PackagePlanState;
  onPlanChange: (patch: Partial<PackagePlanState>) => void;
  isRecommendationLoading: boolean;
  isRecommendationAuto: boolean;
  /** Phase 2 에서 handler 를 넘겨주면 CTA 가 실제로 동작한다.
   *  Phase 1 은 미전달 → 항상 disabled. */
  onSubmit?: () => void;
}

const MIN_QTY = 0;
const MAX_QTY = 50;

export function PackageOptionCard({
  locked,
  plan,
  onPlanChange,
  isRecommendationLoading,
  isRecommendationAuto,
  onSubmit,
}: Props) {
  const visibleItems = selectVisibleItems(plan);

  // Slot 합계는 CreditBadge · Package Submit · 이 카드 세 곳이 반드시 동일한
  // 값을 써야 한다. 공통 함수 computePackageTotalSlots 로 통일.
  const totalImages = computePackageTotalSlots(plan);
  const expectedCredits = totalImages;

  function markModified(id: string, nextState: Record<string, PackageItemState>) {
    const patch: Partial<PackagePlanState> = { itemState: nextState };
    if (!plan.userModifiedItemIds.includes(id)) {
      patch.userModifiedItemIds = [...plan.userModifiedItemIds, id];
    }
    onPlanChange(patch);
  }

  function toggleEnabled(id: string, next: boolean) {
    if (locked) return;
    const prev = plan.itemState[id] ?? {
      enabled: true,
      quantity: plan.aiItems.find((i) => i.id === id)?.defaultQuantity ?? 1,
    };
    const nextState = { ...plan.itemState, [id]: { ...prev, enabled: next } };
    markModified(id, nextState);
  }

  function changeQuantity(id: string, delta: number) {
    if (locked) return;
    const prev = plan.itemState[id] ?? {
      enabled: true,
      quantity: plan.aiItems.find((i) => i.id === id)?.defaultQuantity ?? 1,
    };
    const nextQty = Math.max(MIN_QTY, Math.min(MAX_QTY, prev.quantity + delta));
    if (nextQty === prev.quantity) return;
    const nextState = {
      ...plan.itemState,
      [id]: { ...prev, quantity: nextQty },
    };
    markModified(id, nextState);
  }

  const canSubmit = !locked && !!onSubmit && totalImages > 0;
  // CTA 가 왜 disabled 인지 hover title 로 그대로 노출. 원인 진단이 빨라진다.
  const disabledReason: string | null = !onSubmit
    ? '이 기능은 준비 중입니다'
    : totalImages === 0
      ? '1장 이상 선택해주세요'
      : locked
        ? '다른 생성이 진행 중이거나 이 블록이 이미 사용됐어요'
        : null;

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

      <div className="mt-auto space-y-1.5">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          title={disabledReason ?? undefined}
          className="min-h-[44px] w-full"
        >
          <Sparkles className="mr-1 h-4 w-4" />
          클립아트 만들기
        </Button>
        {disabledReason && (
          <p className="text-center text-xs text-muted-foreground">
            {disabledReason}
          </p>
        )}
      </div>
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

// AI 재추천 응답을 packagePlan 서브객체에 병합하는 순수 유틸.
//
// 규칙:
//   - keywords: aiKeywords 필드만 갱신. userAdded/userRemoved 는 그대로.
//     화면 표시용 최종 리스트는 selectVisibleKeywords 로 뽑는다.
//   - items:
//     · aiItems 는 응답으로 replace (aspectRatio/transparentBackground/
//       promptHint 등 확장 필드까지 포함해 그대로 저장)
//     · itemState 는 userModifiedItemIds 에 있는 id 만 이전 값 유지,
//       나머지는 새 item defaultQuantity + enabled=true 로 초기화
//     · 새 응답에서 사라진 id 는 userModifiedItemIds 에 있으면 state 유지,
//       없으면 state 에서 제거
//
// 이 유틸은 pure — store 를 직접 참조하지 않는다.

import type {
  PackageAiItem,
  PackageItemState,
  PackagePlanResponse,
  PackagePlanState,
} from './packagePlanTypes';

export interface MergeResult {
  aiKeywords: string[];
  aiItems: PackageAiItem[];
  itemState: Record<string, PackageItemState>;
  userModifiedItemIds: string[];
}

export function mergePackagePlan(
  current: Pick<
    PackagePlanState,
    'itemState' | 'userModifiedItemIds' | 'aiItems'
  >,
  response: PackagePlanResponse,
): MergeResult {
  const modifiedIds = new Set(current.userModifiedItemIds);
  const newItemIds = new Set(response.items.map((it) => it.id));

  const nextState: Record<string, PackageItemState> = {};

  // 새 items 반영. 사용자 수정 항목만 이전 값 유지.
  for (const item of response.items) {
    const previous = current.itemState[item.id];
    if (modifiedIds.has(item.id) && previous) {
      nextState[item.id] = { ...previous };
    } else {
      nextState[item.id] = { enabled: true, quantity: item.defaultQuantity };
    }
  }

  // 이전 응답에는 있었지만 새 응답에서 사라진 id — 사용자 수정한 경우만 유지.
  for (const id of Object.keys(current.itemState)) {
    if (newItemIds.has(id)) continue;
    if (modifiedIds.has(id)) {
      const previous = current.itemState[id];
      if (previous) nextState[id] = previous;
    }
  }

  const nextModifiedIds = current.userModifiedItemIds.filter(
    (id) => id in nextState,
  );

  return {
    aiKeywords: [...response.keywords],
    aiItems: response.items.map((it) => ({ ...it })),
    itemState: nextState,
    userModifiedItemIds: nextModifiedIds,
  };
}

/** 화면 표시용 최종 키워드 리스트. */
export function selectVisibleKeywords(
  plan: Pick<
    PackagePlanState,
    'aiKeywords' | 'userAddedKeywords' | 'userRemovedKeywords'
  >,
): string[] {
  const removed = new Set(plan.userRemovedKeywords);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of plan.aiKeywords) {
    if (removed.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of plan.userAddedKeywords) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 화면 표시용 최종 항목 리스트 (state 병합 후 원본 순서 유지). */
export interface VisiblePackageItem extends PackageAiItem {
  enabled: boolean;
  quantity: number;
}

export function selectVisibleItems(
  plan: Pick<PackagePlanState, 'aiItems' | 'itemState'>,
): VisiblePackageItem[] {
  const out: VisiblePackageItem[] = [];
  for (const item of plan.aiItems) {
    const state = plan.itemState[item.id];
    out.push({
      ...item,
      enabled: state?.enabled ?? true,
      quantity: state?.quantity ?? item.defaultQuantity,
    });
  }
  return out;
}

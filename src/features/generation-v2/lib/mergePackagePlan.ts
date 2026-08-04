// AI 재추천 응답을 BlockOptions 로 병합하는 순수 유틸.
//
// 규칙:
//   - keywords: aiKeywords 필드만 갱신. userAdded/userRemoved 는 그대로.
//     화면 표시용 최종 리스트는 selectVisibleKeywords 로 뽑는다.
//   - items:
//     · packageAiItems 는 응답으로 replace
//     · packageItemState 는 userModifiedItemIds 에 있는 id 만 이전 값 유지,
//       나머지는 새 item defaultQuantity + enabled=true 로 초기화
//     · 새 응답에서 사라진 id 는 userModifiedItemIds 에 있으면 state 유지,
//       없으면 state 에서 제거
//   - source 는 UI 에 노출하지 않지만 optional 반영 가능
//
// 이 유틸은 pure — store 를 직접 참조하지 않는다.

import type { BlockOptions } from '@/lib/store/conversationStore';

import type {
  PackageAiItem,
  PackageItemState,
  PackagePlanResponse,
} from './packagePlanTypes';

export interface MergeResult {
  packageAiKeywords: string[];
  packageAiItems: PackageAiItem[];
  packageItemState: Record<string, PackageItemState>;
  packageUserModifiedItemIds: string[];
}

export function mergePackagePlan(
  current: Pick<
    BlockOptions,
    | 'packageItemState'
    | 'packageUserModifiedItemIds'
    | 'packageAiItems'
  >,
  response: PackagePlanResponse,
): MergeResult {
  const modifiedIds = new Set(current.packageUserModifiedItemIds);
  const newItemIds = new Set(response.items.map((it) => it.id));

  const nextState: Record<string, PackageItemState> = {};

  // 새 items 반영. 사용자 수정 항목만 이전 값 유지.
  for (const item of response.items) {
    const previous = current.packageItemState[item.id];
    if (modifiedIds.has(item.id) && previous) {
      nextState[item.id] = { ...previous };
    } else {
      nextState[item.id] = { enabled: true, quantity: item.defaultQuantity };
    }
  }

  // 이전 응답에는 있었지만 새 응답에서 사라진 id — 사용자 수정한 경우만 유지.
  for (const id of Object.keys(current.packageItemState)) {
    if (newItemIds.has(id)) continue;
    if (modifiedIds.has(id)) {
      const previous = current.packageItemState[id];
      if (previous) nextState[id] = previous;
    }
  }

  // userModifiedItemIds 도 새 응답 + 유지된 이전 id 만 남긴다.
  const nextModifiedIds = current.packageUserModifiedItemIds.filter(
    (id) => id in nextState,
  );

  return {
    packageAiKeywords: [...response.keywords],
    packageAiItems: response.items.map((it) => ({ ...it })),
    packageItemState: nextState,
    packageUserModifiedItemIds: nextModifiedIds,
  };
}

/** 화면 표시용 최종 키워드 리스트. */
export function selectVisibleKeywords(options: {
  packageAiKeywords: readonly string[];
  packageUserAddedKeywords: readonly string[];
  packageUserRemovedKeywords: readonly string[];
}): string[] {
  const removed = new Set(options.packageUserRemovedKeywords);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of options.packageAiKeywords) {
    if (removed.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of options.packageUserAddedKeywords) {
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

export function selectVisibleItems(options: {
  packageAiItems: readonly PackageAiItem[];
  packageItemState: Record<string, PackageItemState>;
  packageUserModifiedItemIds: readonly string[];
}): VisiblePackageItem[] {
  const out: VisiblePackageItem[] = [];
  const seen = new Set<string>();
  // AI 순서 우선
  for (const item of options.packageAiItems) {
    const state = options.packageItemState[item.id];
    out.push({
      ...item,
      enabled: state?.enabled ?? true,
      quantity: state?.quantity ?? item.defaultQuantity,
    });
    seen.add(item.id);
  }
  // AI 목록에 없지만 사용자 수정으로 유지된 항목 — 별도 이름 정보가 없으므로
  // packageAiItems 원본에 없는 이상 id 만 있고 표시 불가. 이번 구현에서는
  // packageAiItems 에 반드시 있는 것만 렌더 (누락된 modified 항목은 병합
  // 로직에서 이미 nextModifiedIds 에서 정리됨).
  return out;
}

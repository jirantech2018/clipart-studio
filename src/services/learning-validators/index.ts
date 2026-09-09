// Learning validators — 3-layer runner.
//
// 순서: L1 (structural) → L2 (deterministic) → L3 (semantic AI)
// L1 실패 시 즉시 중단 (SCHEMA_ERROR — 재생성해도 해결 불가).
// L2/L3 는 각각 결과 반환. caller 가 병합해 부분 재생성 결정.

import type { LearningDocument } from '@/services/learning-renderer/schema';
import type {
  EvaluationResult,
  ResolvedLearningProfile,
} from '@/services/learning-profile';

import { runStructural } from './l1-structural';
import { runDeterministic } from './l2-deterministic';
import { runSemantic } from './l3-semantic';

export { runStructural } from './l1-structural';
export { runDeterministic } from './l2-deterministic';
export { runSemantic } from './l3-semantic';

export interface ValidatorInput {
  document: LearningDocument;
  profile: ResolvedLearningProfile;
  requestedGrade: number;
  requestedSubject: string;
  requestedMaterialType: string;
  requestedQuestionCount: number;
  requestedUnit?: string | null;
  requestedTopic: string;
}

export interface ThreeLayerResult {
  structural: EvaluationResult;
  deterministic: EvaluationResult | null;
  semantic: EvaluationResult | null;
  overallPassed: boolean;
  aggregateFailedItemIds: string[];
}

export async function runThreeLayer(input: ValidatorInput): Promise<ThreeLayerResult> {
  const structural = runStructural({
    document: input.document,
    requestedMaterialType: input.requestedMaterialType,
    requestedGrade: input.requestedGrade,
    requestedSubject: input.requestedSubject,
  });

  if (!structural.passed) {
    return {
      structural,
      deterministic: null,
      semantic: null,
      overallPassed: false,
      aggregateFailedItemIds: [],
    };
  }

  const deterministic = runDeterministic({
    document: input.document,
    profile: input.profile,
    requestedMaterialType: input.requestedMaterialType,
    requestedQuestionCount: input.requestedQuestionCount,
  });

  // deterministic 이 실패해도 L3 는 실행 (전체 문제점 파악 위해).
  const semantic = await runSemantic({
    document: input.document,
    profile: input.profile,
    requestedGrade: input.requestedGrade,
    requestedSubject: input.requestedSubject,
    requestedUnit: input.requestedUnit,
    requestedTopic: input.requestedTopic,
  });

  const failed = new Set<string>();
  for (const it of deterministic.failedItemIds) failed.add(it);
  for (const it of semantic.failedItemIds) failed.add(it);
  // set-level failures ('(set)', '(document)') 는 부분 재생성 대상에서 제외 —
  // 전체 재생성이 필요하기 때문. caller 가 별도 처리.
  const aggregateFailedItemIds = Array.from(failed).filter(
    (id) => !id.startsWith('('),
  );

  const overallPassed = structural.passed && deterministic.passed && semantic.passed;

  return {
    structural,
    deterministic,
    semantic,
    overallPassed,
    aggregateFailedItemIds,
  };
}

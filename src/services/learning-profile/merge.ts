// LearningProfile merge — 여러 프로필을 하나의 ResolvedLearningProfile 로 병합.
//
// 병합 원칙:
//   - 리스트 (learningGoals, allowedScope, excludedScope, semanticCriteria):
//     좁은 스코프가 넓은 스코프의 항목을 덮어쓰지 않고 append (중복 key 는 좁은 것 우선).
//   - 객체 (vocabularyGuidance, contentGuidance, deterministicRules):
//     좁은 스코프가 필드 단위로 override (undefined 는 덮어쓰지 않음).
//   - 병합 순서는 넓은 스코프부터 → 좁은 스코프.
//
// 반환값의 scopeChain 은 정확히 어떤 프로필이 어떤 순서로 병합됐는지 감사용.

import type {
  ContentGuidance,
  DeterministicRules,
  LearningGoal,
  LearningProfile,
  ResolvedLearningProfile,
  ScopeRule,
  SemanticCriterion,
  VocabularyGuidance,
} from './types';

export function mergeProfiles(
  profileSetCode: string,
  profiles: LearningProfile[],
): ResolvedLearningProfile {
  const scopeChain: ResolvedLearningProfile['scopeChain'] = profiles.map((p) => ({
    profileId: p.id,
    scopeType: p.scopeType,
    title: p.title,
    priority: p.priority,
    version: p.version,
  }));

  const learningGoals = mergeByKey<LearningGoal>(
    profiles.map((p) => p.learningGoals),
    (g) => g.code,
  );

  const allowedScope = mergeByKey<ScopeRule>(
    profiles.map((p) => p.allowedScope),
    (r) => r.key,
  );

  const excludedScope = mergeByKey<ScopeRule>(
    profiles.map((p) => p.excludedScope),
    (r) => r.key,
  );

  const semanticCriteria = mergeByKey<SemanticCriterion>(
    profiles.map((p) => p.semanticCriteria),
    (c) => c.key,
  );

  const vocabularyGuidance = mergeObject<VocabularyGuidance>(
    profiles.map((p) => p.vocabularyGuidance),
  );

  const contentGuidance = mergeObject<ContentGuidance>(profiles.map((p) => p.contentGuidance));

  const deterministicRules = mergeDeterministicRules(profiles.map((p) => p.deterministicRules));

  return {
    profileSetCode,
    scopeChain,
    learningGoals,
    allowedScope,
    excludedScope,
    vocabularyGuidance,
    contentGuidance,
    deterministicRules,
    semanticCriteria,
  };
}

/**
 * Merge lists keyed by a getter. Narrower scopes (later in the input array) override
 * earlier entries with the same key while preserving the append order otherwise.
 */
function mergeByKey<T>(lists: T[][], getKey: (item: T) => string): T[] {
  const out = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      out.set(getKey(item), item);
    }
  }
  return Array.from(out.values());
}

/**
 * Field-by-field override merge. Later objects override earlier ones per key,
 * but never with undefined.
 */
function mergeObject<T extends Record<string, unknown>>(objects: T[]): T {
  const out: Record<string, unknown> = {};
  for (const obj of objects) {
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out as T;
}

/**
 * Deterministic rules merge — sub-namespaces (multipleChoice, math, etc.) merged
 * separately so that a narrower scope's `math.requiresCarry` doesn't wipe out a
 * broader scope's `math.numberRange`.
 */
function mergeDeterministicRules(rulesList: DeterministicRules[]): DeterministicRules {
  const out: Record<string, unknown> = {};
  for (const rules of rulesList) {
    for (const [namespace, sub] of Object.entries(rules)) {
      if (sub === undefined) continue;
      if (typeof sub === 'object' && sub !== null && !Array.isArray(sub)) {
        const prev = (out[namespace] as Record<string, unknown>) ?? {};
        const merged: Record<string, unknown> = { ...prev };
        for (const [k, v] of Object.entries(sub)) {
          if (v !== undefined) merged[k] = v;
        }
        out[namespace] = merged;
      } else {
        out[namespace] = sub;
      }
    }
  }
  return out as DeterministicRules;
}

// LearningProfile public entry.
//
// resolveLearningProfile: (subject, grade, unit?) → ResolvedLearningProfile
//   1) fetchApplicableProfiles 로 원격 조회
//   2) mergeProfiles 로 계층 병합
//   3) 아무 프로필도 안 잡히면 EMPTY_PROFILE 반환 (구조 검증만 통과시키는 기본값)

import { fetchApplicableProfiles } from './repository';
import { mergeProfiles } from './merge';
import type { ResolvedLearningProfile } from './types';

export * from './types';
export { fetchApplicableProfiles } from './repository';
export { mergeProfiles } from './merge';

export interface ResolveInput {
  subjectCode: string;
  grade: number;
  unitName?: string | null;
  domainCode?: string | null;
}

/**
 * Special sentinel returned when no active profile matches the request.
 * All downstream validators must handle this without treating it as a hard failure.
 */
export const EMPTY_PROFILE: ResolvedLearningProfile = {
  profileSetCode: '(none)',
  scopeChain: [],
  learningGoals: [],
  allowedScope: [],
  excludedScope: [],
  vocabularyGuidance: {},
  contentGuidance: {},
  deterministicRules: {},
  semanticCriteria: [],
};

export async function resolveLearningProfile(
  input: ResolveInput,
): Promise<ResolvedLearningProfile> {
  const { profileSetCode, profiles } = await fetchApplicableProfiles({
    subjectCode: input.subjectCode,
    grade: input.grade,
    unitName: input.unitName ?? null,
    domainCode: input.domainCode ?? null,
  });

  if (!profileSetCode || profiles.length === 0) return EMPTY_PROFILE;
  return mergeProfiles(profileSetCode, profiles);
}

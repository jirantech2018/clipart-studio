// LearningProfile repository — Supabase (service_role) 로 원격 조회.
//
// 조회 규칙 (5-scope 계층):
//   1) profile_set 은 code = 'KR_ELEM_2022_V1' (Phase 1 M2-1.8 seed).
//      추후 여러 세트 지원 시 (버전 교체) 이 상수만 변경.
//   2) scope 별 필터:
//       - curriculum   : subject/domain/unit 무관
//       - grade_subject: subject_code = X, grade_min <= G <= grade_max
//       - domain       : subject_code = X + domain_id 매칭 (domain 은 code 로 조회 후 id 획득)
//       - unit         : subject_code = X + grade_min=grade_max=G + unit_name = U
//       - exception    : 특수 케이스. 이 서비스는 fetch 만, 매칭은 caller 가.
//   3) status = 'active' 만 fetch (draft 는 회귀 후 별도 활성화).
//   4) 병합은 caller 가 mergeProfiles 로.

import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  LearningProfileSchema,
  type LearningProfile,
} from './types';

const ACTIVE_PROFILE_SET_CODE = 'KR_ELEM_2022_V1';

export interface FetchProfilesInput {
  subjectCode: string;
  grade: number;
  domainCode?: string | null;
  unitName?: string | null;
}

interface RawProfileRow {
  id: string;
  profile_set_id: string;
  scope_type: string;
  subject_code: string | null;
  domain_id: string | null;
  unit_name: string | null;
  grade_min: number;
  grade_max: number;
  title: string;
  description: string | null;
  learning_goals: unknown;
  prerequisites: unknown;
  allowed_scope: unknown;
  excluded_scope: unknown;
  vocabulary_guidance: unknown;
  content_guidance: unknown;
  deterministic_rules: unknown;
  semantic_criteria: unknown;
  priority: number;
  status: string;
  version: number;
}

function toCamel(row: RawProfileRow): LearningProfile {
  return LearningProfileSchema.parse({
    id: row.id,
    profileSetId: row.profile_set_id,
    scopeType: row.scope_type,
    subjectCode: row.subject_code,
    domainId: row.domain_id,
    unitName: row.unit_name,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    title: row.title,
    description: row.description,
    learningGoals: row.learning_goals ?? [],
    prerequisites: row.prerequisites ?? [],
    allowedScope: row.allowed_scope ?? [],
    excludedScope: row.excluded_scope ?? [],
    vocabularyGuidance: row.vocabulary_guidance ?? {},
    contentGuidance: row.content_guidance ?? {},
    deterministicRules: row.deterministic_rules ?? {},
    semanticCriteria: row.semantic_criteria ?? [],
    priority: row.priority ?? 0,
    status: row.status,
    version: row.version ?? 1,
  });
}

/**
 * Fetch all learning profiles that potentially apply to a (subject, grade, unit) request.
 *
 * Returns rows in scope-priority order: curriculum → grade_subject → domain → unit → exception.
 * Only active profiles from the active profile set are returned. If the profile set has no
 * active profiles (seed still draft), returns []. Caller decides to fall back or proceed
 * with empty profile.
 */
export async function fetchApplicableProfiles(
  input: FetchProfilesInput,
): Promise<{ profileSetCode: string | null; profiles: LearningProfile[] }> {
  const service = createSupabaseServiceClient();

  const { data: setRow, error: setErr } = await service
    .from('learning_profile_sets')
    .select('id, code, status')
    .eq('code', ACTIVE_PROFILE_SET_CODE)
    .maybeSingle();

  if (setErr) throw new Error(`learning_profile_sets fetch failed: ${setErr.message}`);
  if (!setRow) return { profileSetCode: null, profiles: [] };

  const setId = (setRow as { id: string }).id;

  // Fetch profiles matching (subject or global) and (grade in range).
  // Filter by status='active' — draft profiles never affect production flows.
  const { data: rows, error: rowErr } = await service
    .from('learning_profiles')
    .select('*')
    .eq('profile_set_id', setId)
    .eq('status', 'active')
    .lte('grade_min', input.grade)
    .gte('grade_max', input.grade);

  if (rowErr) throw new Error(`learning_profiles fetch failed: ${rowErr.message}`);

  const all = (rows ?? []) as RawProfileRow[];
  const applicable = all.filter((r) => {
    // curriculum: applies to everyone in grade range
    if (r.scope_type === 'curriculum') return true;

    // subject-scoped: must match subject
    if (r.subject_code && r.subject_code !== input.subjectCode) return false;

    if (r.scope_type === 'grade_subject') return true;
    if (r.scope_type === 'domain') return true; // caller can narrow further via input.domainCode if needed
    if (r.scope_type === 'unit') {
      if (!input.unitName) return false;
      return r.unit_name === input.unitName;
    }
    if (r.scope_type === 'exception') return true; // handled by caller
    return false;
  });

  const parsed = applicable.map(toCamel);

  // Order by scope priority (curriculum=1 ... exception=5), then by priority DESC, then version DESC.
  const scopeOrder: Record<string, number> = {
    curriculum: 1,
    grade_subject: 2,
    domain: 3,
    unit: 4,
    exception: 5,
  };
  parsed.sort((a, b) => {
    const so = (scopeOrder[a.scopeType] ?? 99) - (scopeOrder[b.scopeType] ?? 99);
    if (so !== 0) return so;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.version - a.version;
  });

  return { profileSetCode: (setRow as { code: string }).code, profiles: parsed };
}

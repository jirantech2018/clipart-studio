// 학년·과목 지원 매트릭스 — 활성 LearningProfile 을 서버에서 조회해서
// "어떤 (학년, 과목) 조합이 프로필 지원 범위인가" 를 알려준다.
//
// 원칙:
//   - 특정 학년·과목 문자열을 하드코딩하지 않는다.
//   - learning_profiles WHERE status='active' 만 조회.
//   - 지원되지 않는 조합은 UI 에서 "준비 중" 배지로 명확히 표시.

import { createSupabaseServiceClient } from '@/services/supabase/server';

export interface SupportEntry {
  grade: number;
  subject: string;
  units: string[];
}

export interface SupportMatrix {
  /** 프로필이 존재하는 (grade, subject) 조합 목록. UI 가 활성/준비중 구분에 사용. */
  entries: SupportEntry[];
  /** 활성 프로필 세트 코드 (예: 'KR_ELEM_2022_V1'). 표시용. */
  profileSetCode: string | null;
}

interface RawProfileRow {
  subject_code: string | null;
  unit_name: string | null;
  grade_min: number;
  grade_max: number;
  scope_type: string;
}

interface RawProfileSet {
  code: string;
}

/**
 * Load the currently active learning profiles and derive a support matrix.
 *
 * Returns entries at (grade, subject) granularity. Only grades that have at
 * least one active profile (curriculum / grade_subject / domain / unit) are
 * listed. Grades outside this set are shown as "준비 중" in the UI.
 */
export async function loadSupportMatrix(): Promise<SupportMatrix> {
  const service = createSupabaseServiceClient();

  // Active profile set (only one at a time by convention).
  const { data: setRow } = await service
    .from('learning_profile_sets')
    .select('code')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!setRow) return { entries: [], profileSetCode: null };

  const profileSetCode = (setRow as RawProfileSet).code;

  const { data: rows } = await service
    .from('learning_profiles')
    .select('subject_code, unit_name, grade_min, grade_max, scope_type')
    .eq('status', 'active');

  const list = (rows ?? []) as RawProfileRow[];

  // Aggregate: (grade, subject) -> Set<unit_name>
  const bucket = new Map<string, Set<string>>();

  for (const r of list) {
    // Skip curriculum-level rows without subject (they apply to every subject
    // but do not constitute "coverage" on their own).
    if (!r.subject_code) continue;

    for (let g = r.grade_min; g <= r.grade_max; g += 1) {
      const key = `${g}::${r.subject_code}`;
      const units = bucket.get(key) ?? new Set<string>();
      if (r.unit_name) units.add(r.unit_name);
      bucket.set(key, units);
    }
  }

  const entries: SupportEntry[] = Array.from(bucket.entries())
    .map(([key, units]) => {
      const [gradeStr, subject] = key.split('::');
      return {
        grade: Number(gradeStr),
        subject: subject!,
        units: Array.from(units).sort(),
      };
    })
    .sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));

  return { entries, profileSetCode };
}

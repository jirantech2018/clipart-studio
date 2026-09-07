// Learning-Helper subject metadata (M1: 국어·수학 2종만).
// DB `learning_subjects` 테이블과 미러링. 서버 렌더링 시 fallback 으로 사용.

export const LEARNING_SUBJECTS = [
  { code: 'KOR', nameKo: '국어', displayOrder: 1 },
  { code: 'MATH', nameKo: '수학', displayOrder: 2 },
] as const;

export type SubjectCode = (typeof LEARNING_SUBJECTS)[number]['code'];

export const SUBJECT_LABEL: Record<SubjectCode, string> = {
  KOR: '국어',
  MATH: '수학',
};

export function isSubjectCode(v: unknown): v is SubjectCode {
  return typeof v === 'string' && LEARNING_SUBJECTS.some((s) => s.code === v);
}

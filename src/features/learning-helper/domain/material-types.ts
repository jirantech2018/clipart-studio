// Learning-Helper material type metadata (M1: 5종).
// DB `learning_material_types` 테이블과 미러링.

export const LEARNING_MATERIAL_TYPES = [
  {
    code: 'multiple_choice',
    nameKo: '객관식',
    description: '4지선다 객관식 문제. 낱말·개념 확인에 적합',
    defaultFormat: 'pdf',
    displayOrder: 1,
    // M1 UI 는 이 2종을 우선 강조 (사용자 지시)
    m1Featured: true,
  },
  {
    code: 'individual_activity',
    nameKo: '개별 활동지',
    description: '학생 개별 활동 워크시트. 활동 절차 안내',
    defaultFormat: 'pdf',
    displayOrder: 2,
    m1Featured: true,
  },
  {
    code: 'ox_quiz',
    nameKo: 'OX 퀴즈',
    description: '참/거짓 판단 문제. 개념 빠른 확인',
    defaultFormat: 'pdf',
    displayOrder: 3,
    m1Featured: false,
  },
  {
    code: 'concept_summary',
    nameKo: '개념 정리',
    description: '학습 내용 핵심 정리 자료',
    defaultFormat: 'pdf',
    displayOrder: 4,
    m1Featured: false,
  },
  {
    code: 'reading_material',
    nameKo: '읽기 자료',
    description: '학년 수준에 맞춘 짧은 읽기 자료',
    defaultFormat: 'pdf',
    displayOrder: 5,
    m1Featured: false,
  },
] as const;

export type MaterialTypeCode = (typeof LEARNING_MATERIAL_TYPES)[number]['code'];

export function isMaterialTypeCode(v: unknown): v is MaterialTypeCode {
  return typeof v === 'string' && LEARNING_MATERIAL_TYPES.some((m) => m.code === v);
}

export function materialTypeLabel(code: MaterialTypeCode): string {
  return LEARNING_MATERIAL_TYPES.find((m) => m.code === code)?.nameKo ?? code;
}

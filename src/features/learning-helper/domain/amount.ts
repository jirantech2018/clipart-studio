// 자료유형별 amount 필드의 의미 · 라벨 · 선택 옵션 매핑.
//
// M2-1.1 사용자 지시 (2026-09-08):
//   자료유형에 따라 "수량" 필드가 문항 수 / 활동 수 / 구성 분량 / 읽기 분량 등
//   다른 의미를 가진다. UI 라벨과 선택 가능 값을 자료유형별로 다르게 표시하고,
//   서버 프롬프트도 이 semantic 대로 해석해야 한다.
//
// 저장 형태: schemas.ts 의 `questionCount` 컬럼을 자료유형-agnostic 정수로 유지.
// 프롬프트 (services/learning-orchestrator/prompts.ts) 가 이 값을 자료유형별로
// 해석 (예: individual_activity 면 "활동 N개", concept_summary 면 "간단히/보통/자세히" 등).

import type { MaterialTypeCode } from './material-types';

export interface AmountOption {
  value: number;
  label: string;
}

export interface AmountSpec {
  fieldLabel: string;
  helperText: string;
  options: AmountOption[];
  defaultValue: number;
}

const QUESTION_OPTIONS: AmountOption[] = [
  { value: 5, label: '5문항' },
  { value: 10, label: '10문항' },
  { value: 15, label: '15문항' },
];

const ACTIVITY_OPTIONS: AmountOption[] = [
  { value: 1, label: '1개' },
  { value: 2, label: '2개' },
  { value: 3, label: '3개' },
];

const DETAIL_OPTIONS: AmountOption[] = [
  { value: 1, label: '간단히' },
  { value: 2, label: '보통' },
  { value: 3, label: '자세히' },
];

const LENGTH_OPTIONS: AmountOption[] = [
  { value: 1, label: '짧게' },
  { value: 2, label: '보통' },
  { value: 3, label: '길게' },
];

const SPEC_MAP: Record<MaterialTypeCode, AmountSpec> = {
  multiple_choice: {
    fieldLabel: '문항 수',
    helperText: '몇 개의 객관식 문항을 만들까요?',
    options: QUESTION_OPTIONS,
    defaultValue: 5,
  },
  ox_quiz: {
    fieldLabel: '문항 수',
    helperText: '몇 개의 OX 문항을 만들까요?',
    options: QUESTION_OPTIONS,
    defaultValue: 5,
  },
  individual_activity: {
    fieldLabel: '활동 수',
    helperText: '몇 개의 활동으로 구성할까요?',
    options: ACTIVITY_OPTIONS,
    defaultValue: 2,
  },
  concept_summary: {
    fieldLabel: '구성 분량',
    helperText: '내용의 자세한 정도를 골라주세요',
    options: DETAIL_OPTIONS,
    defaultValue: 2,
  },
  reading_material: {
    fieldLabel: '읽기 분량',
    helperText: '읽기 자료의 길이를 골라주세요',
    options: LENGTH_OPTIONS,
    defaultValue: 2,
  },
};

export function amountSpecFor(code: MaterialTypeCode): AmountSpec {
  return SPEC_MAP[code];
}

/** 서버 프롬프트에 사용자 노출용 문구 (예: "활동 2개", "구성 분량: 보통"). */
export function amountLabelForPrompt(code: MaterialTypeCode, value: number): string {
  const spec = SPEC_MAP[code];
  const opt = spec.options.find((o) => o.value === value);
  const label = opt?.label ?? `${value}`;
  return `${spec.fieldLabel} ${label}`;
}

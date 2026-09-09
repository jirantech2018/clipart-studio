// L1 Structural validator — Zod 파싱 및 필수 필드 존재 확인.
//
// 이 계층은 프로필 무관. 오직 스키마 형태만 본다.
// 실패 시 SCHEMA_ERROR 코드로 caller 가 즉시 중단 (재생성 무의미).

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type { EvaluationResult } from '@/services/learning-profile';

export interface StructuralInput {
  document: unknown;
  requestedMaterialType: string;
  requestedGrade: number;
  requestedSubject: string;
}

export function runStructural(input: StructuralInput): EvaluationResult {
  const started = Date.now();

  const doc = input.document as LearningDocument | null;
  if (!doc || typeof doc !== 'object') {
    return fail('document 가 객체가 아님', started);
  }
  if (!doc.meta || typeof doc.meta !== 'object') {
    return fail('meta 누락', started);
  }
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    return fail('sections 배열이 비어 있음', started);
  }

  // 필수 meta 필드
  const required: Array<keyof LearningDocument['meta']> = [
    'title',
    'grade',
    'subject',
    'materialType',
    'difficulty',
    'teacherReviewRequired',
    'generatedAt',
  ];
  for (const k of required) {
    if (doc.meta[k] === undefined || doc.meta[k] === null) {
      return fail(`meta.${String(k)} 누락`, started);
    }
  }

  // meta.grade / subject 가 요청과 일치
  if (doc.meta.grade !== input.requestedGrade) {
    return fail(
      `meta.grade (${doc.meta.grade}) 이 요청 grade (${input.requestedGrade}) 와 불일치`,
      started,
    );
  }
  if (doc.meta.subject !== input.requestedSubject) {
    return fail(
      `meta.subject (${doc.meta.subject}) 이 요청 subject (${input.requestedSubject}) 와 불일치`,
      started,
    );
  }

  // 재생성 가능 kind 는 itemId 필수
  const idRequired: ReadonlyArray<Section['kind']> = [
    'question',
    'activity',
    'worksheet-table',
    'blank-space',
  ];
  const missingId = doc.sections
    .filter((s) => idRequired.includes(s.kind))
    .filter((s) => !(s as { itemId?: string }).itemId);
  if (missingId.length > 0) {
    return fail(`${missingId.length}개 재생성 가능 섹션에 itemId 없음`, started);
  }

  return {
    stage: 'structure',
    passed: true,
    summary: `${doc.sections.length}개 섹션 구조 검증 통과`,
    evaluatorType: 'code',
    items: [],
    failedItemIds: [],
    durationMs: Date.now() - started,
  };
}

function fail(reason: string, started: number): EvaluationResult {
  return {
    stage: 'structure',
    passed: false,
    summary: reason,
    evaluatorType: 'code',
    items: [
      {
        itemId: '(document)',
        itemIndex: 0,
        itemType: 'other',
        criterionKey: 'structural',
        passed: false,
        reason,
        severity: 'error',
        repairAction: 'manual_review',
      },
    ],
    failedItemIds: [],
    durationMs: Date.now() - started,
  };
}

// Stage 4.2 §8: 콘텐츠 불변성 스냅샷.
//
// Current 방식과 Hybrid 방식 사이에서 GenerationContext / ContentPlan /
// WorksheetPlan / PageCompositionPlan / LearningDocument / blockToImages /
// 문항 / 선택지 / 정답 / 이미지 URL 이 완전히 동일한지 판정. 하나라도
// falseible 이면 시각 A/B 비교로 인정하지 않는다.

import type { ContentPlan } from '@/services/learning-generation/types';
import type { PageCompositionPlan } from '@/services/learning-composition';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type { WorksheetPlan } from '@/services/learning-worksheet';

export interface ContentSnapshot {
  contentPlan: ContentPlan;
  worksheetPlan: WorksheetPlan;
  compositionPlan: PageCompositionPlan;
  document: LearningDocument;
  blockToImages: Record<string, string[]>;
}

export interface ContentEqualityReport {
  contentPlanEqual: boolean;
  worksheetPlanEqual: boolean;
  compositionPlanEqual: boolean;
  documentEqual: boolean;
  blockToImagesEqual: boolean;
  questionTextEqual: boolean;
  answersEqual: boolean;
  allEqual: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 학생용 노출 텍스트 (stem / instruction / label / template / problem 등) 추출. */
function collectQuestionTexts(doc: LearningDocument): string[] {
  const out: string[] = [];
  for (const sec of doc.sections) {
    const s = sec as Record<string, unknown>;
    if (typeof s.stem === 'string') out.push(s.stem);
    if (typeof s.instruction === 'string') out.push(s.instruction);
    for (const key of ['choices', 'leftColumn', 'rightColumn', 'items', 'sentences', 'practiceProblems', 'problems']) {
      const arr = s[key];
      if (Array.isArray(arr)) {
        for (const el of arr) {
          if (el && typeof el === 'object') {
            const eo = el as Record<string, unknown>;
            if (typeof eo.label === 'string') out.push(eo.label);
            if (typeof eo.text === 'string') out.push(eo.text);
            if (typeof eo.template === 'string') out.push(eo.template);
            if (typeof eo.problem === 'string') out.push(eo.problem);
          }
        }
      }
    }
  }
  return out;
}

function collectAnswers(doc: LearningDocument): string[] {
  const out: string[] = [];
  for (const sec of doc.sections) {
    const s = sec as Record<string, unknown> & { kind?: string };
    if (typeof s.answer === 'string') out.push(s.answer);
    if (Array.isArray(s.correctOrder)) out.push(...s.correctOrder.filter((x): x is string => typeof x === 'string'));
    if (Array.isArray(s.correctPairs)) {
      for (const pair of s.correctPairs) {
        if (Array.isArray(pair)) out.push(pair.filter((x): x is string => typeof x === 'string').join('~'));
      }
    }
    for (const key of ['items', 'sentences', 'practiceProblems', 'problems']) {
      const arr = s[key];
      if (Array.isArray(arr)) {
        for (const el of arr) {
          if (el && typeof el === 'object') {
            const eo = el as Record<string, unknown>;
            if (typeof eo.answer === 'string') out.push(eo.answer);
            if (typeof eo.correctCategory === 'string') out.push(eo.correctCategory);
            if (Array.isArray(eo.answers)) out.push(...eo.answers.filter((x): x is string => typeof x === 'string'));
          }
        }
      }
    }
  }
  return out;
}

export function compareContentSnapshots(a: ContentSnapshot, b: ContentSnapshot): ContentEqualityReport {
  const contentPlanEqual = deepEqual(a.contentPlan, b.contentPlan);
  const worksheetPlanEqual = deepEqual(a.worksheetPlan, b.worksheetPlan);
  const compositionPlanEqual = deepEqual(a.compositionPlan, b.compositionPlan);
  const documentEqual = deepEqual(a.document, b.document);
  const blockToImagesEqual = deepEqual(a.blockToImages, b.blockToImages);
  const questionTextEqual = deepEqual(collectQuestionTexts(a.document), collectQuestionTexts(b.document));
  const answersEqual = deepEqual(collectAnswers(a.document), collectAnswers(b.document));
  const allEqual =
    contentPlanEqual &&
    worksheetPlanEqual &&
    compositionPlanEqual &&
    documentEqual &&
    blockToImagesEqual &&
    questionTextEqual &&
    answersEqual;
  return {
    contentPlanEqual,
    worksheetPlanEqual,
    compositionPlanEqual,
    documentEqual,
    blockToImagesEqual,
    questionTextEqual,
    answersEqual,
    allEqual,
  };
}

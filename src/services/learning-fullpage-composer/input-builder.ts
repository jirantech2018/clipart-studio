// LearningDocument + CompositionPlan + 이미지 URL → FullPageWorksheetInput.
//
// 지시서 §6: 학생에게 보여야 하는 모든 문구를 exactVisibleTexts 에 정확한
// 문자열로 실어 전달. 정답·힌트·교사용 정보는 exactVisibleTexts 에 넣지
// 않는다 (studentAnswerVisible=false 원칙).

import type { PageCompositionPlan } from '@/services/learning-composition';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type {
  AnswerMode,
  ExactVisibleText,
  FullPageWorksheetInput,
  StudentAction,
  VisualAsset,
  WorksheetBlockBrief,
  WorksheetPageBrief,
} from './types';

interface BuildInput {
  documentId: string;
  variant: 'student' | 'teacher';
  document: LearningDocument;
  compositionPlan: PageCompositionPlan;
  blockToImages: Map<string, string[]>;
  goldenReferences: FullPageWorksheetInput['goldenReferences'];
}

export async function buildFullPageInput(input: BuildInput): Promise<FullPageWorksheetInput> {
  const doc = input.document;
  const pages: WorksheetPageBrief[] = [];
  const visualAssetMap = new Map<string, VisualAsset>();

  // 이미지 URL 을 실제 바이트로 다운로드.
  for (const [blockId, urls] of input.blockToImages.entries()) {
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i]!;
      const assetId = `${blockId}::img_${i}`;
      if (visualAssetMap.has(assetId)) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        visualAssetMap.set(assetId, {
          assetId,
          filename: `${assetId}.png`,
          bytes: buf,
          contentType: 'image/png',
          intendedRole: 'clipart',
        });
      } catch {
        // skip
      }
    }
  }

  const blockToSectionMap = buildBlockToSectionMap(input.compositionPlan, doc);

  for (const page of input.compositionPlan.pages) {
    const blocks: WorksheetBlockBrief[] = [];
    const exactTexts: ExactVisibleText[] = [];
    const requiredActions: StudentAction[] = [];

    // 첫 페이지에만 title 을 exactVisibleTexts 에 넣는다.
    if (page.pageNumber === 1) {
      exactTexts.push({ id: 'title', text: doc.meta.title, role: 'title' });
    }

    for (const block of page.blocks) {
      const section = blockToSectionMap.get(block.blockId);
      const blockBrief: WorksheetBlockBrief = {
        blockId: block.blockId,
        learningPurpose: block.instruction || page.purpose,
        activityType: section?.kind ?? block.primitive,
        instruction: block.instruction,
        items: extractItems(section),
        answerMode: mapAnswerMode(block.primitive),
        requiredResponseSpace: describeResponseSpace(block.responseSpace),
        imageAssetIds: (input.blockToImages.get(block.blockId) ?? []).map((_, i) => `${block.blockId}::img_${i}`),
        studentAnswerVisible: false,
      };
      blocks.push(blockBrief);

      // exactVisibleTexts — 학생이 실제로 볼 문구만.
      const blockTexts = collectVisibleTexts(block.blockId, block.instruction, section, input.variant);
      exactTexts.push(...blockTexts);

      requiredActions.push({ blockId: block.blockId, action: describeStudentAction(block.primitive) });
    }

    pages.push({
      pageNumber: page.pageNumber,
      pagePurpose: page.purpose,
      activityFlow: page.blocks.map((b) => `${b.blockId}: ${describeStudentAction(b.primitive)}`),
      blocks,
      exactVisibleTexts: exactTexts,
      prohibitedVisibleTexts: input.variant === 'student' ? collectAnswerTexts(page.blocks.map((b) => blockToSectionMap.get(b.blockId)).filter(Boolean) as Section[]) : [],
      requiredStudentActions: requiredActions,
      selfCheck: undefined,
    });
  }

  return {
    documentId: input.documentId,
    variant: input.variant,
    grade: doc.meta.grade as number,
    subject: doc.meta.subject as string,
    title: doc.meta.title,
    learningGoal: doc.meta.topic ?? doc.meta.title,
    pageTarget: input.compositionPlan.pages.length,
    pages,
    visualAssets: Array.from(visualAssetMap.values()),
    goldenReferences: input.goldenReferences,
  };
}

function buildBlockToSectionMap(plan: PageCompositionPlan, doc: LearningDocument): Map<string, Section> {
  const map = new Map<string, Section>();
  const sectionsById = new Map<string, Section>();
  for (const s of doc.sections) {
    const sid = (s as { itemId?: string }).itemId;
    if (sid) sectionsById.set(sid, s);
  }
  for (const page of plan.pages) {
    for (const block of page.blocks) {
      let sec = sectionsById.get(block.blockId);
      if (!sec) {
        for (const id of block.sourceItemIds) {
          const s = sectionsById.get(id);
          if (s) {
            sec = s;
            break;
          }
        }
      }
      if (sec) map.set(block.blockId, sec);
    }
  }
  return map;
}

function extractItems(section: Section | undefined): unknown[] {
  if (!section) return [];
  const s = section as Record<string, unknown>;
  if (Array.isArray(s.choices)) return s.choices as unknown[];
  if (Array.isArray(s.leftColumn) || Array.isArray(s.rightColumn)) {
    return [
      { column: 'left', items: (s.leftColumn as unknown[]) ?? [] },
      { column: 'right', items: (s.rightColumn as unknown[]) ?? [] },
    ];
  }
  if (Array.isArray(s.items)) return s.items as unknown[];
  if (Array.isArray(s.problems)) return s.problems as unknown[];
  if (Array.isArray(s.practiceProblems)) return s.practiceProblems as unknown[];
  return [];
}

function mapAnswerMode(primitive: string): AnswerMode {
  switch (primitive) {
    case 'matching-board':
      return 'connect';
    case 'choice-grid':
      return 'choose';
    case 'writing-practice':
      return 'write';
    case 'calculation-practice':
      return 'calculate';
    case 'open-response':
    case 'compare-panel':
      return 'explain';
    case 'image-observation':
      return 'observe';
    case 'visual-canvas':
      return 'draw';
    default:
      return 'explain';
  }
}

function describeResponseSpace(rs: { type: string; size?: string; cells?: number; lines?: number }): string {
  if (rs.type === 'none') return '응답 공간 없음';
  const size = rs.size ?? 'medium';
  const extras = [rs.cells ? `${rs.cells}칸` : null, rs.lines ? `${rs.lines}줄` : null].filter(Boolean).join(', ');
  return `${rs.type} (${size})${extras ? ` · ${extras}` : ''}`;
}

function describeStudentAction(primitive: string): string {
  switch (primitive) {
    case 'matching-board': return '좌우 항목을 선으로 연결';
    case 'choice-grid': return '보기 중 하나 선택';
    case 'writing-practice': return '격자·줄에 손으로 쓰기';
    case 'calculation-practice': return '계산 후 답 쓰기';
    case 'open-response': return '자유 응답 쓰기';
    case 'image-observation': return '이미지 관찰 후 서술';
    case 'compare-panel': return '두 대상 비교 설명';
    case 'sequence-steps': return '올바른 순서 판단';
    case 'reflection-strip': return '자기 점검 표시';
    case 'example-panel': return '예시 관찰 후 유사 문제 풀이';
    default: return '활동 수행';
  }
}

function collectVisibleTexts(
  blockId: string,
  instruction: string,
  section: Section | undefined,
  variant: 'student' | 'teacher',
): ExactVisibleText[] {
  const out: ExactVisibleText[] = [];
  if (instruction) out.push({ id: `${blockId}::instruction`, text: instruction, role: 'instruction' });
  if (!section) return out;
  const s = section as Record<string, unknown> & { kind: string };

  const push = (id: string, text: unknown, role: ExactVisibleText['role']) => {
    if (typeof text === 'string' && text.trim().length > 0) {
      out.push({ id, text: text.trim(), role });
    }
  };

  // Section stem (if different from instruction).
  if (typeof s.stem === 'string' && s.stem.trim() && s.stem.trim() !== instruction.trim()) {
    push(`${blockId}::stem`, s.stem, 'instruction');
  }

  switch (s.kind) {
    case 'picture-choice': {
      const choices = (s.choices ?? []) as Array<{ label?: string }>;
      choices.forEach((c, i) => push(`${blockId}::choice_${i + 1}`, c.label, 'choice'));
      break;
    }
    case 'matching': {
      const left = (s.leftColumn ?? []) as Array<{ text?: string; id?: string }>;
      const right = (s.rightColumn ?? []) as Array<{ text?: string; id?: string }>;
      left.forEach((l, i) => push(`${blockId}::left_${l.id ?? i + 1}`, l.text, 'label'));
      right.forEach((r, i) => push(`${blockId}::right_${r.id ?? i + 1}`, r.text, 'label'));
      break;
    }
    case 'classification': {
      const cats = (s.categories ?? []) as string[];
      cats.forEach((c, i) => push(`${blockId}::cat_${i + 1}`, c, 'label'));
      const items = (s.items ?? []) as Array<{ text?: string; id?: string }>;
      items.forEach((it, i) => push(`${blockId}::item_${it.id ?? i + 1}`, it.text, 'label'));
      break;
    }
    case 'fill-blank': {
      const sentences = (s.sentences ?? []) as Array<{ template?: string }>;
      sentences.forEach((sn, i) => push(`${blockId}::sentence_${i + 1}`, sn.template, 'example'));
      break;
    }
    case 'guided-practice': {
      const example = (s.workedExample ?? {}) as { problem?: string; solutionSteps?: string[] };
      push(`${blockId}::example_problem`, example.problem, 'example');
      (example.solutionSteps ?? []).forEach((st, i) => push(`${blockId}::example_step_${i + 1}`, st, 'example'));
      const practice = (s.practiceProblems ?? []) as Array<{ problem?: string }>;
      practice.forEach((p, i) => push(`${blockId}::practice_${i + 1}`, p.problem, 'label'));
      break;
    }
    case 'independent-practice': {
      const problems = (s.problems ?? []) as Array<{ problem?: string }>;
      problems.forEach((p, i) => push(`${blockId}::problem_${i + 1}`, p.problem, 'label'));
      break;
    }
    case 'sequence': {
      const items = (s.items ?? []) as Array<{ text?: string; id?: string }>;
      items.forEach((it, i) => push(`${blockId}::seq_${it.id ?? i + 1}`, it.text, 'label'));
      break;
    }
    case 'writing-grid': {
      const tracing = (s.tracingText ?? '') as string;
      push(`${blockId}::tracing`, tracing, 'example');
      break;
    }
    case 'observation': {
      const prompts = (s.observationPrompts ?? []) as Array<{ prompt?: string }>;
      prompts.forEach((p, i) => push(`${blockId}::obs_${i + 1}`, p.prompt, 'instruction'));
      break;
    }
  }

  // Teacher variant 은 이 함수에서는 정답을 넣지 않는다 (교사용 overlay 에서 별도 처리).
  void variant;
  return out;
}

function collectAnswerTexts(sections: Section[]): string[] {
  const out: string[] = [];
  for (const sec of sections) {
    const s = sec as Record<string, unknown>;
    if (typeof s.answer === 'string') out.push(s.answer);
    if (Array.isArray(s.correctOrder)) out.push(...(s.correctOrder as unknown[]).filter((x): x is string => typeof x === 'string'));
    const items = (s.items ?? []) as Array<{ answer?: string; correctCategory?: string }>;
    for (const it of items) {
      if (typeof it.answer === 'string') out.push(it.answer);
      if (typeof it.correctCategory === 'string') out.push(it.correctCategory);
    }
    const problems = (s.problems ?? []) as Array<{ answer?: string }>;
    for (const p of problems) if (typeof p.answer === 'string') out.push(p.answer);
    const practice = (s.practiceProblems ?? []) as Array<{ answer?: string }>;
    for (const p of practice) if (typeof p.answer === 'string') out.push(p.answer);
  }
  return out.filter((x) => x.trim().length > 0);
}

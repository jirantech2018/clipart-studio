// Stage 4.1 composition-driven 4-case 통제 실행.
//
// 4 조합 (활성 프로필 범위 안에서):
//   A. 1학년 국어 · 그림-낱말 연결 중심 · 활동형
//   B. 1학년 국어 · 따라 쓰기 · 활동형
//   C. 2학년 수학 · 개념 관찰 + 단계 계산 · 활동형
//   D. 2학년 수학 · 비교/분류/설명 · 활동형
//
// 관리자 무과금 (BYPASS_CREDITS=true) 로 pool 미소비.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { renderCompositionPdf } from '../src/services/learning-renderer/pdf-composition';
import { buildBlockToSection } from '../src/services/learning-renderer/composition-render';
import { reviewLayout } from '../src/services/learning-validators/layout-review';
import { createSupabaseServiceClient } from '../src/services/supabase/server';

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'stage4-composition');
const USER_ID = '6743b98b-9f19-46cc-bdf0-d43d03ae78c6';
const ORG_ID = 'b83a2b0f-162c-4dad-88b4-65343e299ab6';
const ORG_SLUG = 'personal-6743b98b9f1946ccbdf0d43d03ae78c6';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

interface Case {
  code: 'A' | 'B' | 'C' | 'D';
  label: string;
  fname: string;
  input: {
    grade: 1 | 2 | 3 | 4 | 5 | 6;
    subject: 'KOR' | 'MATH';
    materialType: 'multiple_choice' | 'individual_activity' | 'reading_material' | 'concept_summary' | 'ox_quiz';
    unit: string;
    topic: string;
    questionCount: number;
    difficulty: 'easy' | 'normal' | 'hard';
    clipartMode: 'auto' | 'none';
    additionalRequest?: string;
  };
}

const CASES: Case[] = [
  {
    code: 'A',
    label: 'A. 1학년 국어 · 그림-낱말 연결 중심',
    fname: 'a-jamo-matching',
    input: {
      grade: 1, subject: 'KOR',
      materialType: 'multiple_choice',
      unit: '한글의 자음과 모음',
      topic: '그림과 첫 자음 연결하기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '학생이 그림을 관찰하고 낱말과 첫 자음을 연결하는 활동을 중심으로 구성',
    },
  },
  {
    code: 'B',
    label: 'B. 1학년 국어 · 따라 쓰기와 독립 쓰기',
    fname: 'b-jamo-writing',
    input: {
      grade: 1, subject: 'KOR',
      materialType: 'individual_activity',
      unit: '한글의 자음과 모음',
      topic: '자음자 따라 쓰기와 스스로 써 보기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '견본을 따라 격자에 쓰기와 자기 낱말을 떠올려 쓰는 확장 활동을 중심으로',
    },
  },
  {
    code: 'C',
    label: 'C. 2학년 수학 · 개념 관찰과 단계 계산',
    fname: 'c-math-observe',
    input: {
      grade: 2, subject: 'MATH',
      materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈',
      topic: '받아올림이 있는 덧셈의 원리 관찰과 단계별 계산',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '수 모형을 관찰하며 받아올림 개념을 이해하고 단계별로 계산',
    },
  },
  {
    code: 'D',
    label: 'D. 2학년 수학 · 비교/분류/설명',
    fname: 'd-math-compare',
    input: {
      grade: 2, subject: 'MATH',
      materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈',
      topic: '받아올림 여부에 따른 문제 비교와 스스로 설명하기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '받아올림 발생 여부에 따라 문제를 비교하고 학생이 자기 말로 이유를 설명',
    },
  },
];

async function runOne(c: Case): Promise<{
  documentId: string;
  result: Awaited<ReturnType<typeof dispatchLearningDoc>>;
}> {
  const service = createSupabaseServiceClient();
  await service
    .from('generation_jobs')
    .update({ status: 'failed', error: 'stage4-composition cleanup' })
    .eq('user_id', USER_ID)
    .eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);

  const jobId = randomUUID();
  const { error: jErr } = await service.from('generation_jobs').insert({
    id: jobId, user_id: USER_ID,
    prompt: `[stage4-composition] ${c.label}`,
    batch_size: 1, diversity_level: 0, reference_image_id: null,
    school_profile_applied: false,
    reserved_credits: 0, // BYPASS
    status: 'queued', org_id: ORG_ID, kind: 'learning_doc',
  });
  if (jErr) throw new Error(`job insert 실패: ${jErr.message}`);

  console.log(`\n=== ${c.label} · job=${jobId.slice(0, 8)} ===`);
  const t0 = Date.now();
  const result = await dispatchLearningDoc({
    jobId, userId: USER_ID, organizationId: ORG_ID, orgSlug: ORG_SLUG,
    enableV2Override: true,
    ...c.input,
  });
  console.log(
    `  ${Math.round((Date.now() - t0) / 1000)}s · doc=${result.documentId.slice(0, 8)} · pages(plan)=${result.compositionPlan?.pages.length ?? '?'} · clipart=${result.clipartInsertedCount ?? 0}`,
  );
  return { documentId: result.documentId, result };
}

async function renderAndReview(
  c: Case,
  documentId: string,
  document: Awaited<ReturnType<typeof dispatchLearningDoc>>['document'],
  compositionPlan: NonNullable<Awaited<ReturnType<typeof dispatchLearningDoc>>['compositionPlan']>,
  applied: NonNullable<Awaited<ReturnType<typeof dispatchLearningDoc>>['appliedComposition']>,
  variant: 'student' | 'teacher',
) {
  const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
  const blockToSection = buildBlockToSection(compositionPlan, document);
  const blockToImages = new Map<string, string[]>();
  for (const [k, v] of Object.entries(applied.blockToImageUrls)) blockToImages.set(k, v as string[]);

  const pdfBuf = await renderCompositionPdf(
    { document, compositionPlan, blockToSection, blockToImages },
    {
      useLocalChrome: Boolean(chrome),
      localChromePath: chrome,
      answerVariant: variant,
    },
  );
  await writeFile(path.join(OUT_DIR, `${c.fname}-${variant}.pdf`), pdfBuf);
  const review = reviewLayout({ applied, document, pdfBytes: pdfBuf, variant });
  return { pdfBuf, review };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const report: Array<Record<string, unknown>> = [];

  for (const c of CASES) {
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const { documentId, result } = await runOne(c);
        if (!result.compositionPlan || !result.appliedComposition) {
          throw new Error('compositionPlan or applied snapshot missing');
        }
        console.log('  rendering student...');
        const st = await renderAndReview(
          c, documentId, result.document, result.compositionPlan, result.appliedComposition, 'student',
        );
        console.log(
          `    PDF ${st.pdfBuf.length}b · Layout Review ${st.review.pass ? 'PASS' : 'FAIL'} (${st.review.issues.length} issues) · pages=${st.review.metrics.pageCount}`,
        );
        console.log('  rendering teacher...');
        const te = await renderAndReview(
          c, documentId, result.document, result.compositionPlan, result.appliedComposition, 'teacher',
        );
        console.log(
          `    PDF ${te.pdfBuf.length}b · Layout Review ${te.review.pass ? 'PASS' : 'FAIL'} (${te.review.issues.length} issues) · pages=${te.review.metrics.pageCount}`,
        );

        const cp = result.compositionPlan;
        const primitives: string[] = [];
        const layoutKeys: string[] = [];
        for (const p of cp.pages) {
          layoutKeys.push(p.layout);
          for (const b of p.blocks) primitives.push(b.primitive);
        }
        report.push({
          case: c.label,
          documentId,
          strategy: {
            learningFlow: cp.documentStrategy.learningFlow,
            visualHierarchy: cp.documentStrategy.visualHierarchy,
            density: cp.documentStrategy.density,
            pageTarget: cp.documentStrategy.pageTarget,
            designDirection: cp.documentStrategy.designDirection,
            designRationale: cp.documentStrategy.designRationale,
          },
          pages: cp.pages.length,
          layouts: layoutKeys,
          primitives,
          predictedPageFillRatio: result.appliedComposition.predictedPageFillRatio,
          blockCount: primitives.length,
          linkedBlocks: Object.keys(result.appliedComposition.blockToSectionId).length,
          imageBlocks: Object.keys(result.appliedComposition.blockToImageUrls).length,
          student: {
            pdfBytes: st.pdfBuf.length,
            pageCount: st.review.metrics.pageCount,
            imageObjects: st.review.metrics.imageObjectCount,
            standaloneImages: st.review.metrics.standaloneImageCount,
            firstPageEmpty: st.review.metrics.firstPageEmpty,
            layoutReviewPass: st.review.pass,
            layoutIssues: st.review.issues.map((x) => `${x.code}@${x.where}: ${x.detail}`),
          },
          teacher: {
            pdfBytes: te.pdfBuf.length,
            pageCount: te.review.metrics.pageCount,
            imageObjects: te.review.metrics.imageObjectCount,
            layoutReviewPass: te.review.pass,
          },
        });
        ok = true;
      } catch (err) {
        console.error(`  attempt ${attempt} failed:`, (err as Error).message);
        if (attempt === 2) {
          report.push({ case: c.label, error: (err as Error).message });
          ok = true; // don't retry more
        }
      }
    }
  }

  console.log('\n=== STAGE 4.1 COMPOSITION SUMMARY ===');
  console.log(JSON.stringify(report, null, 2));
  await writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

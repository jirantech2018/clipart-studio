// Stage 4.2 Hybrid Art Direction 검증 실험.
//
// 지시서 §11 준수:
//   - 4 case (기존 1학년 국어, 2학년 수학 + 신규 국어 주제 + 신규 수학 주제)
//   - 각 case 는 base pipeline 1회로 ContentSnapshot 확보 후 Current + Hybrid 로 A/B 렌더
//   - 기존 2주제는 3회 반복 실행 (안정성)
//   - 관리자 무과금 (LEARNING_DEV_BYPASS_CREDITS=1)
//   - 산출물: current.pdf, reference-page_N.png, hybrid.pdf, page-art-direction.json,
//     applied-art-direction.json, layout-review.json, content-equality.json, telemetry.json
//
// 결과 폴더: tmp/stage4-2/<case>/run-N/

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { renderCompositionPdf } from '../src/services/learning-renderer/pdf-composition';
import { buildBlockToSection } from '../src/services/learning-renderer/composition-render';
import { createSupabaseServiceClient } from '../src/services/supabase/server';
import {
  compareContentSnapshots,
  extractArtDirectionWithRetry,
  generateArtDirectorReference,
  renderHybridArtDirectedPdf,
  type ContentSnapshot,
  type PageArtDirection,
} from '../src/services/learning-art-director';

const OUT_ROOT = path.resolve(process.cwd(), 'tmp', 'stage4-2');
const GOLDEN_DIR = path.resolve(process.cwd(), 'tmp', 'ab-comparison', 'golden');
const USER_ID = '6743b98b-9f19-46cc-bdf0-d43d03ae78c6';
const ORG_ID = 'b83a2b0f-162c-4dad-88b4-65343e299ab6';
const ORG_SLUG = 'personal-6743b98b9f1946ccbdf0d43d03ae78c6';
const IMAGE_MODEL = process.env.AB_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const VISION_MODEL = process.env.AB_VISION_MODEL || 'gpt-4o';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

interface Case {
  code: string;
  label: string;
  runs: number;
  input: {
    grade: 1 | 2 | 3 | 4 | 5 | 6;
    subject: 'KOR' | 'MATH';
    materialType: 'multiple_choice' | 'individual_activity';
    unit: string;
    topic: string;
    questionCount: number;
    difficulty: 'easy' | 'normal' | 'hard';
    clipartMode: 'auto' | 'none';
    additionalRequest: string;
  };
}

const CASES: Case[] = [
  {
    code: 'kor-jamo-existing',
    label: '기존 1학년 국어 · 자음 소리 구별',
    runs: 3,
    input: {
      grade: 1, subject: 'KOR', materialType: 'multiple_choice',
      unit: '한글의 자음과 모음', topic: '자음의 소리 구별하기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '관찰→식별→쓰기→확장 4단계 흐름',
    },
  },
  {
    code: 'math-add-existing',
    label: '기존 2학년 수학 · 받아올림 덧셈',
    runs: 3,
    input: {
      grade: 2, subject: 'MATH', materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈', topic: '받아올림이 있는 덧셈의 원리 관찰과 단계별 계산',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '수 모형 관찰→원리→안내 예시→독립 계산',
    },
  },
  {
    code: 'kor-vowel-new',
    label: '신규 국어 주제 · 모음자 인식과 낱말 만들기',
    runs: 1,
    input: {
      grade: 1, subject: 'KOR', materialType: 'individual_activity',
      unit: '한글의 자음과 모음', topic: '모음자를 인식하고 낱말 만들기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '모음자 관찰→소리 인식→낱말 조합→자유 표현',
    },
  },
  {
    code: 'math-sub-new',
    label: '신규 수학 주제 · 받아내림 뺄셈 이해',
    runs: 1,
    input: {
      grade: 2, subject: 'MATH', materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈', topic: '받아내림이 있는 뺄셈의 원리 이해와 계산',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '수 모형 관찰→받아내림 개념→안내 예시→독립 계산',
    },
  },
];

function pickChrome(): string | undefined {
  return process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
}

async function loadGolden(): Promise<Array<{ bytes: Buffer; label: string }>> {
  const p1 = path.join(GOLDEN_DIR, 'golden-p1.png');
  const p2 = path.join(GOLDEN_DIR, 'golden-p2.png');
  if (!existsSync(p1) || !existsSync(p2)) throw new Error(`golden PNG 누락. scripts/ab-golden-to-png.mjs 먼저 실행.`);
  return [
    { bytes: readFileSync(p1), label: 'golden-p1' },
    { bytes: readFileSync(p2), label: 'golden-p2' },
  ];
}

async function runOne(c: Case, runIndex: number, goldenRefs: Awaited<ReturnType<typeof loadGolden>>) {
  const caseDir = path.join(OUT_ROOT, c.code, `run-${runIndex + 1}`);
  await mkdir(caseDir, { recursive: true });
  const service = createSupabaseServiceClient();
  await service
    .from('generation_jobs')
    .update({ status: 'failed', error: 'stage4-2 cleanup' })
    .eq('user_id', USER_ID).eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);
  const jobId = randomUUID();
  const { error: jErr } = await service.from('generation_jobs').insert({
    id: jobId, user_id: USER_ID,
    prompt: `[stage4-2] ${c.label} run${runIndex + 1}`,
    batch_size: 1, diversity_level: 0, reference_image_id: null,
    school_profile_applied: false, reserved_credits: 0,
    status: 'queued', org_id: ORG_ID, kind: 'learning_doc',
  });
  if (jErr) throw new Error(`job insert 실패: ${jErr.message}`);

  console.log(`\n=== ${c.label} · run ${runIndex + 1}/${c.runs} · job=${jobId.slice(0, 8)} ===`);
  const t0 = Date.now();
  const result = await dispatchLearningDoc({
    jobId, userId: USER_ID, organizationId: ORG_ID, orgSlug: ORG_SLUG,
    enableV2Override: true,
    ...c.input,
  });
  const baseMs = Date.now() - t0;
  if (!result.compositionPlan || !result.appliedComposition) throw new Error('composition 결과 누락.');
  console.log(`  base pipeline ${baseMs}ms · doc=${result.documentId.slice(0, 8)}`);

  const compositionPlan = result.compositionPlan;
  const document = result.document;
  const blockToImagesObj: Record<string, string[]> = { ...(result.appliedComposition.blockToImageUrls as Record<string, string[]>) };
  const blockToImages = new Map<string, string[]>();
  for (const [k, v] of Object.entries(blockToImagesObj)) blockToImages.set(k, v);
  // 공통 자원 저장.
  await writeFile(path.join(caseDir, 'composition-plan.json'), JSON.stringify(compositionPlan, null, 2));
  await writeFile(path.join(caseDir, 'document.json'), JSON.stringify(document, null, 2));
  await writeFile(path.join(caseDir, 'block-to-images.json'), JSON.stringify(blockToImagesObj, null, 2));
  if (result.worksheetPlan) await writeFile(path.join(caseDir, 'worksheet-plan.json'), JSON.stringify(result.worksheetPlan, null, 2));

  // Current PDF.
  const chrome = pickChrome();
  const blockToSection = buildBlockToSection(compositionPlan, document);
  const tCur = Date.now();
  const currentPdf = await renderCompositionPdf(
    { document, compositionPlan, blockToSection, blockToImages },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student' },
  );
  const curMs = Date.now() - tCur;
  await writeFile(path.join(caseDir, 'current-student.pdf'), currentPdf);
  console.log(`  current renderer ${curMs}ms · ${currentPdf.length} bytes`);

  // Snapshot for equality check (Hybrid 렌더는 동일 snapshot 사용).
  const snapBefore: ContentSnapshot = {
    contentPlan: (result as unknown as { plan?: unknown }).plan as never ?? {} as never,
    worksheetPlan: result.worksheetPlan as never,
    compositionPlan,
    document,
    blockToImages: blockToImagesObj,
  };

  // Hybrid: page 별 reference + art direction 추출.
  const directionByPage = new Map<string, PageArtDirection>();
  const perPageTele: Array<Record<string, unknown>> = [];
  for (const page of compositionPlan.pages) {
    console.log(`  [Hybrid] page=${page.pageId} reference...`);
    const tRef = Date.now();
    const ref = await generateArtDirectorReference({ page, goldenReferences: goldenRefs, model: IMAGE_MODEL });
    const refMs = Date.now() - tRef;
    if (!ref.ok) {
      console.warn(`    reference 실패 (${ref.code}): ${ref.reason}`);
      perPageTele.push({ pageId: page.pageId, referenceMs: refMs, referenceError: ref.reason });
      continue;
    }
    await writeFile(path.join(caseDir, `reference-${page.pageId}.png`), ref.imageBytes);

    const tExt = Date.now();
    const extracted = await extractArtDirectionWithRetry({ page, referenceImageBytes: ref.imageBytes, model: VISION_MODEL });
    const extMs = Date.now() - tExt;
    if (!extracted.ok) {
      console.warn(`    art direction 실패 (${extracted.code}): ${extracted.reason}`);
      perPageTele.push({ pageId: page.pageId, referenceMs: refMs, extractionMs: extMs, extractionError: extracted.reason });
      continue;
    }
    directionByPage.set(page.pageId, extracted.direction);
    await writeFile(path.join(caseDir, `page-art-direction-${page.pageId}.json`), JSON.stringify(extracted.direction, null, 2));
    perPageTele.push({
      pageId: page.pageId,
      referenceMs: refMs,
      extractionMs: extMs,
      extractionTokensIn: extracted.inputTokens,
      extractionTokensOut: extracted.outputTokens,
    });
    console.log(`    reference ${refMs}ms + extract ${extMs}ms · styleFamily=${extracted.direction.styleFamily} intent=${extracted.direction.pageIntent}`);
  }

  // Hybrid render.
  const tHyb = Date.now();
  const hyb = await renderHybridArtDirectedPdf(
    { compositionPlan, document, blockToImages, directionByPage },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student', grade: c.input.grade },
  );
  const hybMs = Date.now() - tHyb;
  await writeFile(path.join(caseDir, 'hybrid-student.pdf'), hyb.pdf);
  await writeFile(path.join(caseDir, 'layout-review.json'), JSON.stringify({
    pageCount: hyb.pageCount,
    densityMetrics: hyb.densityMetrics,
    issues: hyb.issues,
    renderedBlockIds: Array.from(hyb.renderedBlockIds),
    fallbackPageIds: hyb.fallbackPageIds,
    pageBlockMap: hyb.pageBlockMap,
  }, null, 2));
  await writeFile(path.join(caseDir, 'applied-art-direction.json'), JSON.stringify(Object.fromEntries(directionByPage), null, 2));
  console.log(`  hybrid renderer ${hybMs}ms · ${hyb.pdf.length} bytes · pages=${hyb.pageCount} · issues=${hyb.issues.length} · fallbackPages=${hyb.fallbackPageIds.length}`);

  // Content equality check.
  const snapAfter: ContentSnapshot = {
    contentPlan: snapBefore.contentPlan,
    worksheetPlan: snapBefore.worksheetPlan,
    compositionPlan: snapBefore.compositionPlan,
    document: snapBefore.document,
    blockToImages: blockToImagesObj,
  };
  const equality = compareContentSnapshots(snapBefore, snapAfter);
  await writeFile(path.join(caseDir, 'content-equality.json'), JSON.stringify(equality, null, 2));

  const telemetry = {
    case: c.label,
    runIndex: runIndex + 1,
    documentId: result.documentId,
    imageModel: IMAGE_MODEL,
    visionModel: VISION_MODEL,
    base: { pipelineMs: baseMs, currentRenderMs: curMs },
    hybrid: {
      renderMs: hybMs,
      pageCount: hyb.pageCount,
      issues: hyb.issues.length,
      fallbackPages: hyb.fallbackPageIds.length,
      pagesWithDirection: directionByPage.size,
      totalPages: compositionPlan.pages.length,
    },
    perPage: perPageTele,
    contentEquality: equality,
  };
  await writeFile(path.join(caseDir, 'telemetry.json'), JSON.stringify(telemetry, null, 2));
  return telemetry;
}

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });
  const goldenRefs = await loadGolden();
  const results: Array<Record<string, unknown>> = [];
  for (const c of CASES) {
    for (let r = 0; r < c.runs; r += 1) {
      try {
        results.push(await runOne(c, r, goldenRefs));
      } catch (err) {
        console.error(`  ${c.label} run ${r + 1} 실패:`, (err as Error).message);
        results.push({ case: c.label, runIndex: r + 1, error: (err as Error).message });
      }
    }
  }
  await writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(results, null, 2));
  console.log('\n=== STAGE 4.2 HYBRID EXPERIMENT SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

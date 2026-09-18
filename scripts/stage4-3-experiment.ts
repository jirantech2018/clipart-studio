// Stage 4.3 실험 — 3 case × 3 방식 (Stage 4.1 / Stage 4.2 / Stage 4.3).
// 방식별 학생용 PDF + 페이지 PNG + verification + telemetry 저장.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { renderCompositionPdf } from '../src/services/learning-renderer/pdf-composition';
import { buildBlockToSection } from '../src/services/learning-renderer/composition-render';
import { createSupabaseServiceClient } from '../src/services/supabase/server';
import {
  extractArtDirectionWithRetry,
  generateArtDirectorReference,
  renderHybridArtDirectedPdf,
  type PageArtDirection,
} from '../src/services/learning-art-director';
import {
  buildFullPageInput,
  orchestrateFullPage,
  packagePngsAsPdf,
} from '../src/services/learning-fullpage-composer';

const OUT_ROOT = path.resolve(process.cwd(), 'tmp', 'stage4-3');
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
    code: '1-kor-jamo',
    label: '1학년 국어 · 자음 소리 구별 (골든과 같은 주제)',
    input: {
      grade: 1, subject: 'KOR', materialType: 'multiple_choice',
      unit: '한글의 자음과 모음', topic: '자음의 소리 구별하기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '관찰→식별→쓰기→확장',
    },
  },
  {
    code: '2-kor-vowel',
    label: '1학년 국어 · 모음자 인식 (골든에 없는 국어 주제)',
    input: {
      grade: 1, subject: 'KOR', materialType: 'individual_activity',
      unit: '한글의 자음과 모음', topic: '모음자를 인식하고 낱말 만들기',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '모음자 관찰→소리 인식→낱말 조합→자유 표현',
    },
  },
  {
    code: '3-math-sub',
    label: '2학년 수학 · 받아내림 뺄셈 (골든에 없는 수학 주제)',
    input: {
      grade: 2, subject: 'MATH', materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈', topic: '받아내림이 있는 뺄셈의 원리 이해',
      questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
      additionalRequest: '수 모형 관찰→받아내림 개념→안내 예시→독립 계산',
    },
  },
];

function pickChrome(): string | undefined {
  return process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
}

async function loadGolden() {
  return [
    { filename: 'golden-p1.png', bytes: readFileSync(path.join(GOLDEN_DIR, 'golden-p1.png')), contentType: 'image/png' as const },
    { filename: 'golden-p2.png', bytes: readFileSync(path.join(GOLDEN_DIR, 'golden-p2.png')), contentType: 'image/png' as const },
  ];
}

async function runCase(c: Case, goldenRefs: Awaited<ReturnType<typeof loadGolden>>) {
  const caseDir = path.join(OUT_ROOT, c.code);
  await mkdir(caseDir, { recursive: true });
  const service = createSupabaseServiceClient();
  await service.from('generation_jobs').update({ status: 'failed', error: 'stage4-3 cleanup' })
    .eq('user_id', USER_ID).eq('kind', 'learning_doc').in('status', ['queued', 'running']);

  // ============================================================
  // Base pipeline — 최대 2회 시도 (Stage 4.1 게이트 통과할 때까지)
  // ============================================================
  let result: Awaited<ReturnType<typeof dispatchLearningDoc>> | null = null;
  let baseMs = 0;
  for (let att = 1; att <= 3 && !result; att += 1) {
    const jobId = randomUUID();
    await service.from('generation_jobs').insert({
      id: jobId, user_id: USER_ID,
      prompt: `[stage4-3] ${c.label} att${att}`,
      batch_size: 1, diversity_level: 0, reference_image_id: null,
      school_profile_applied: false, reserved_credits: 0,
      status: 'queued', org_id: ORG_ID, kind: 'learning_doc',
    });
    const t0 = Date.now();
    try {
      const r = await dispatchLearningDoc({
        jobId, userId: USER_ID, organizationId: ORG_ID, orgSlug: ORG_SLUG,
        enableV2Override: true,
        ...c.input,
      });
      baseMs += Date.now() - t0;
      result = r;
    } catch (err) {
      baseMs += Date.now() - t0;
      console.warn(`  base attempt ${att} 실패: ${(err as Error).message}`);
    }
  }
  if (!result || !result.compositionPlan) {
    return { case: c.label, error: 'base pipeline 3회 모두 실패' };
  }
  console.log(`  ${c.label} · base pipeline ${baseMs}ms · doc=${result.documentId.slice(0, 8)}`);
  const compositionPlan = result.compositionPlan;
  const document = result.document;
  const bimObj = { ...(result.appliedComposition?.blockToImageUrls as Record<string, string[]>) };
  const blockToImages = new Map<string, string[]>();
  for (const [k, v] of Object.entries(bimObj)) blockToImages.set(k, v);

  await writeFile(path.join(caseDir, 'composition-plan.json'), JSON.stringify(compositionPlan, null, 2));
  await writeFile(path.join(caseDir, 'document.json'), JSON.stringify(document, null, 2));
  await writeFile(path.join(caseDir, 'block-to-images.json'), JSON.stringify(bimObj, null, 2));

  const chrome = pickChrome();

  // ============================================================
  // Stage 4.1 renderer
  // ============================================================
  console.log(`  [4.1] render...`);
  const t41 = Date.now();
  const blockToSection = buildBlockToSection(compositionPlan, document);
  const pdf41 = await renderCompositionPdf(
    { document, compositionPlan, blockToSection, blockToImages },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student' },
  );
  const ms41 = Date.now() - t41;
  await writeFile(path.join(caseDir, 'stage4.1-student.pdf'), pdf41);
  console.log(`    ${ms41}ms ${pdf41.length}b`);

  // ============================================================
  // Stage 4.2 Hybrid renderer
  // ============================================================
  console.log(`  [4.2] direction per page...`);
  const directionByPage = new Map<string, PageArtDirection>();
  for (const page of compositionPlan.pages) {
    const goldenBytesRefs = goldenRefs.map((g) => ({ bytes: g.bytes, label: g.filename }));
    const ref = await generateArtDirectorReference({ page, goldenReferences: goldenBytesRefs, model: IMAGE_MODEL });
    if (!ref.ok) { console.warn(`    p${page.pageNumber} reference 실패: ${ref.reason}`); continue; }
    const ext = await extractArtDirectionWithRetry({ page, referenceImageBytes: ref.imageBytes, model: VISION_MODEL });
    if (!ext.ok) { console.warn(`    p${page.pageNumber} extraction 실패: ${ext.reason}`); continue; }
    directionByPage.set(page.pageId, ext.direction);
  }
  console.log(`  [4.2] render...`);
  const t42 = Date.now();
  const hyb = await renderHybridArtDirectedPdf(
    { compositionPlan, document, blockToImages, directionByPage },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student', grade: c.input.grade },
  );
  const ms42 = Date.now() - t42;
  await writeFile(path.join(caseDir, 'stage4.2-student.pdf'), hyb.pdf);
  console.log(`    ${ms42}ms ${hyb.pdf.length}b · pages=${hyb.pageCount} · issues=${hyb.issues.length}`);

  // ============================================================
  // Stage 4.3 Full-Page Composer
  // ============================================================
  console.log(`  [4.3] build input...`);
  const fpInput = await buildFullPageInput({
    documentId: result.documentId,
    variant: 'student',
    document,
    compositionPlan,
    blockToImages,
    goldenReferences: goldenRefs,
  });
  await writeFile(path.join(caseDir, 'stage4.3-input.json'), JSON.stringify({
    ...fpInput,
    visualAssets: fpInput.visualAssets.map((a) => ({ assetId: a.assetId, filename: a.filename, size: a.bytes.length })),
    goldenReferences: fpInput.goldenReferences.map((g) => ({ filename: g.filename, size: g.bytes.length })),
  }, null, 2));

  const pageImages: Buffer[] = [];
  const pageVerifications: Array<Record<string, unknown>> = [];
  const pageTele: Array<Record<string, unknown>> = [];
  let previousPageImage: Buffer | undefined;
  const t43 = Date.now();
  let compose43Issues = 0;
  for (const page of fpInput.pages) {
    console.log(`  [4.3] page ${page.pageNumber} compose...`);
    const composed = await orchestrateFullPage({
      input: fpInput, page, previousPageImage,
      imageModel: IMAGE_MODEL, visionModel: VISION_MODEL,
      onEvent: (m) => console.log('    ' + m),
    });
    const original = composed.editHistory[0]?.imageBytesBefore ?? composed.imageBytes;
    await writeFile(path.join(caseDir, `stage4.3-original-p${page.pageNumber}.png`), original);
    await writeFile(path.join(caseDir, `stage4.3-final-p${page.pageNumber}.png`), composed.imageBytes);
    await writeFile(path.join(caseDir, `stage4.3-verification-p${page.pageNumber}.json`), JSON.stringify(composed.verification, null, 2));
    await writeFile(path.join(caseDir, `stage4.3-prompt-p${page.pageNumber}.txt`), composed.promptUsed);
    for (const [i, e] of composed.editHistory.entries()) {
      await writeFile(path.join(caseDir, `stage4.3-edit-p${page.pageNumber}-${i + 1}-before.png`), e.imageBytesBefore);
      await writeFile(path.join(caseDir, `stage4.3-edit-p${page.pageNumber}-${i + 1}-after.png`), e.imageBytesAfter);
      await writeFile(path.join(caseDir, `stage4.3-edit-p${page.pageNumber}-${i + 1}-instruction.txt`), e.editInstruction);
    }
    if (composed.imageBytes.length > 0) {
      pageImages.push(composed.imageBytes);
      previousPageImage = composed.imageBytes;
    }
    if (!composed.finalPass) compose43Issues += 1;
    pageVerifications.push({ page: page.pageNumber, pass: composed.finalPass, missing: composed.verification.missingTexts.length, edits: composed.editHistory.length });
    pageTele.push({ page: page.pageNumber, durationMs: composed.durationMs, editCalls: composed.editHistory.length });
  }
  let pdf43Bytes = 0;
  if (pageImages.length > 0) {
    const pdf43 = await packagePngsAsPdf({
      pageImages, useLocalChrome: Boolean(chrome), localChromePath: chrome,
    });
    await writeFile(path.join(caseDir, 'stage4.3-student.pdf'), pdf43);
    pdf43Bytes = pdf43.length;
  }
  const ms43 = Date.now() - t43;
  console.log(`  [4.3] total ${ms43}ms · pages=${pageImages.length} · pageIssues=${compose43Issues} · pdf=${pdf43Bytes}b`);

  const telemetry = {
    case: c.label,
    code: c.code,
    documentId: result.documentId,
    imageModel: IMAGE_MODEL,
    visionModel: VISION_MODEL,
    stage41: { renderMs: ms41, pdfBytes: pdf41.length },
    stage42: { renderMs: ms42, pdfBytes: hyb.pdf.length, pageCount: hyb.pageCount, issues: hyb.issues.length, fallbackPages: hyb.fallbackPageIds.length },
    stage43: {
      totalMs: ms43, pdfBytes: pdf43Bytes, pageCount: pageImages.length,
      failedPages: compose43Issues,
      perPage: pageTele,
      verifications: pageVerifications,
    },
    baseMs,
  };
  await writeFile(path.join(caseDir, 'telemetry.json'), JSON.stringify(telemetry, null, 2));
  return telemetry;
}

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });
  const goldenRefs = await loadGolden();
  const results: Array<Record<string, unknown>> = [];
  for (const c of CASES) {
    try {
      results.push(await runCase(c, goldenRefs));
    } catch (err) {
      console.error(`  ${c.label} 실패:`, (err as Error).message);
      results.push({ case: c.label, error: (err as Error).message });
    }
  }
  await writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(results, null, 2));
  console.log('\n=== STAGE 4.3 EXPERIMENT SUMMARY ===');
  console.log(JSON.stringify(results.map((r) => ({
    case: r.case, code: (r as { code?: string }).code,
    stage41: (r as { stage41?: { pdfBytes?: number } }).stage41?.pdfBytes,
    stage42: (r as { stage42?: { pdfBytes?: number; issues?: number } }).stage42,
    stage43: {
      pdfBytes: (r as { stage43?: { pdfBytes?: number } }).stage43?.pdfBytes,
      pages: (r as { stage43?: { pageCount?: number } }).stage43?.pageCount,
      failed: (r as { stage43?: { failedPages?: number } }).stage43?.failedPages,
    },
  })), null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

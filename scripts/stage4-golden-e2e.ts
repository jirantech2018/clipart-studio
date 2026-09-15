// Stage 4 골든 패스 통제 실행 스크립트.
//
// 4개 결과물 생성:
//   A. 1학년 국어 · 한글 자음/모음 · 자음 소리 구별
//      → jamo-student.pdf, jamo-teacher.pdf
//   B. 2학년 수학 · 두 자리 수 덧셈뺄셈 · 받아올림이 있는 덧셈
//      → math-student.pdf, math-teacher.pdf
// 각각 학생용/교사용 PDF + Word + PPT 산출물.
//
// 관리자 무과금 (BYPASS_CREDITS=true): pool 미소비.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { renderPdf } from '../src/services/learning-renderer/pdf';
import { renderDocx } from '../src/services/learning-renderer/docx';
import { renderPptx } from '../src/services/learning-renderer/pptx';
import { createSupabaseServiceClient } from '../src/services/supabase/server';
import type { LearningDocument, Section } from '../src/services/learning-renderer/schema';

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'stage4-golden');
const USER_ID = '6743b98b-9f19-46cc-bdf0-d43d03ae78c6';
const ORG_ID = 'b83a2b0f-162c-4dad-88b4-65343e299ab6';
const ORG_SLUG = 'personal-6743b98b9f1946ccbdf0d43d03ae78c6';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

interface GoldenCase {
  label: string;
  filenameBase: string;
  input: {
    grade: 1 | 2 | 3 | 4 | 5 | 6;
    subject: 'KOR' | 'MATH';
    materialType: 'multiple_choice' | 'individual_activity' | 'ox_quiz' | 'concept_summary' | 'reading_material';
    unit: string;
    topic: string;
    questionCount: number;
    difficulty: 'easy' | 'normal' | 'hard';
    clipartMode: 'auto' | 'none';
  };
}

const CASES: GoldenCase[] = [
  {
    label: 'A. 1학년 국어 자음/모음',
    filenameBase: 'jamo',
    input: {
      grade: 1,
      subject: 'KOR',
      materialType: 'multiple_choice',
      unit: '한글의 자음과 모음',
      topic: '자음의 소리 구별하기',
      questionCount: 5,
      difficulty: 'normal',
      clipartMode: 'auto',
    },
  },
  {
    label: 'B. 2학년 수학 덧셈뺄셈',
    filenameBase: 'math',
    input: {
      grade: 2,
      subject: 'MATH',
      materialType: 'multiple_choice',
      unit: '두 자리 수의 덧셈과 뺄셈',
      topic: '받아올림이 있는 덧셈',
      questionCount: 5,
      difficulty: 'normal',
      clipartMode: 'auto',
    },
  },
];

async function runOne(c: GoldenCase): Promise<{
  documentId: string;
  document: LearningDocument;
  clipartCount: number;
}> {
  const service = createSupabaseServiceClient();

  // 사전 정리 — 이전 queued 있으면 실패로.
  await service
    .from('generation_jobs')
    .update({ status: 'failed', error: 'stage4-golden cleanup' })
    .eq('user_id', USER_ID)
    .eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);

  const jobId = randomUUID();
  const { error: jobErr } = await service.from('generation_jobs').insert({
    id: jobId,
    user_id: USER_ID,
    prompt: `[stage4-golden] ${c.label}`,
    batch_size: 1,
    diversity_level: 0,
    reference_image_id: null,
    school_profile_applied: false,
    reserved_credits: 0, // BYPASS
    status: 'queued',
    org_id: ORG_ID,
    kind: 'learning_doc',
  });
  if (jobErr) throw new Error(`job insert 실패: ${jobErr.message}`);

  console.log(`\n=== ${c.label} — job=${jobId.slice(0, 8)} ===`);
  const t0 = Date.now();
  const result = await dispatchLearningDoc({
    jobId,
    userId: USER_ID,
    organizationId: ORG_ID,
    orgSlug: ORG_SLUG,
    enableV2Override: true,
    ...c.input,
  });
  console.log(
    `  pipeline done in ${Math.round((Date.now() - t0) / 1000)}s · documentId=${result.documentId} · clipart=${result.clipartInsertedCount ?? 0}`,
  );
  return {
    documentId: result.documentId,
    document: result.document,
    clipartCount: result.clipartInsertedCount ?? 0,
  };
}

interface RenderChecks {
  pdfBytes: number;
  pdfImageObjects: number;
  pdfPages: number;
  pdfFirstPageEmpty: boolean;
  docxBytes: number;
  pptxBytes: number;
  activityKinds: string[];
}

async function renderAll(
  document: LearningDocument,
  variant: 'student' | 'teacher',
  filenameBase: string,
): Promise<RenderChecks> {
  const chrome =
    process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));

  const pdfBuf = await renderPdf(document, {
    useLocalChrome: Boolean(chrome),
    localChromePath: chrome,
    answerVariant: variant,
  });
  await writeFile(path.join(OUT_DIR, `${filenameBase}-${variant}.pdf`), pdfBuf);
  const pdfLatin1 = pdfBuf.toString('latin1');
  const pdfImageObjects = (pdfLatin1.match(/\/Subtype\s*\/Image/g) ?? []).length;
  const pdfPages = (pdfLatin1.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  const pdfFirstPageEmpty = /\/Contents\s*<<\s*\/Length\s+0/.test(pdfLatin1);

  const docxBuf = await renderDocx(document, { answerVariant: variant });
  await writeFile(path.join(OUT_DIR, `${filenameBase}-${variant}.docx`), docxBuf);

  const pptxBuf = await renderPptx(document, { answerVariant: variant });
  await writeFile(path.join(OUT_DIR, `${filenameBase}-${variant}.pptx`), pptxBuf);

  const kinds = new Set<string>();
  for (const s of document.sections) kinds.add((s as { kind: string }).kind);

  return {
    pdfBytes: pdfBuf.length,
    pdfImageObjects,
    pdfPages,
    pdfFirstPageEmpty,
    docxBytes: docxBuf.length,
    pptxBytes: pptxBuf.length,
    activityKinds: Array.from(kinds),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const report: Array<{
    case: string;
    documentId: string;
    clipart: number;
    student: RenderChecks;
    teacher: RenderChecks;
  }> = [];

  for (const c of CASES) {
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const { documentId, document, clipartCount } = await runOne(c);
        console.log(`  rendering (student)...`);
        const student = await renderAll(document, 'student', c.filenameBase);
        console.log(`    PDF ${student.pdfBytes}b / ${student.pdfPages}p / imgs=${student.pdfImageObjects}`);
        console.log(`  rendering (teacher)...`);
        const teacher = await renderAll(document, 'teacher', c.filenameBase);
        console.log(`    PDF ${teacher.pdfBytes}b / ${teacher.pdfPages}p / imgs=${teacher.pdfImageObjects}`);
        report.push({
          case: c.label,
          documentId,
          clipart: clipartCount,
          student,
          teacher,
        });
        ok = true;
      } catch (err) {
        console.error(`  attempt ${attempt} failed:`, (err as Error).message);
        if (attempt === 2) throw err;
      }
    }
  }

  console.log('\n=== STAGE 4 GOLDEN SUMMARY ===');
  console.log(JSON.stringify(report, null, 2));

  await writeFile(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(report, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

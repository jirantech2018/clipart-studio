// Phase 0.6/0.7 sample 실행 스크립트.
//
// 실행 (Windows PowerShell 또는 Git Bash):
//   pnpm tsx scripts/learning-render-sample.ts           # 전체 10개
//   pnpm tsx scripts/learning-render-sample.ts --phase07 # 5개만 (재실증)
//
// 산출물 (전체 10개):
//   ./tmp/phase-0/
//     workbook-student.pdf         workbook-student.docx         workbook-student.pptx
//     workbook-teacher.pdf         workbook-teacher.docx         workbook-teacher.pptx
//     lessonPlan.pdf               lessonPlan.docx               lessonPlan.pptx
//     openingSlides.pptx
//
// Phase 0.7 재실증 5개 (--phase07):
//   lessonPlan.pdf, workbook-student.pdf,
//   workbook-teacher.{pdf,docx,pptx}
//
// - student  : 문항·활동만 (정답 X)
// - teacher  : 전체 문항·활동 + 인라인 정답 + 뒤 정답·해설
// - combined : 학생용 문제지 뒤에 정답·해설 페이지 (인라인 X, 페이지 브레이크)
//
// 로컬 크롬 경로가 필요합니다. Windows 기본 위치를 자동 감지하며 없으면 환경변수:
//   PPTR_LOCAL_CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { renderDocx, type AnswerVariant } from '../src/services/learning-renderer/docx';
import { renderPdf } from '../src/services/learning-renderer/pdf';
import { renderPptx, splitIntoSlides } from '../src/services/learning-renderer/pptx';
import {
  sampleLessonPlan,
  sampleOpeningSlides,
  sampleWorkbook,
} from '../src/services/learning-renderer/sample';
import type { LearningDocument } from '../src/services/learning-renderer/schema';

// EBUSY 대응: 파일이 다른 프로세스(예: Word/PowerPoint 미리보기)에 잠긴 경우
// 잠깐 대기 후 재시도.
async function writeFileWithRetry(p: string, buf: Buffer, retries = 5): Promise<void> {
  for (let i = 0; i < retries; i += 1) {
    try {
      await writeFile(p, buf);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM') throw err;
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'phase-0');

// Windows 기본 Chrome 위치 자동 감지 (필요 시 env 로 override).
const DEFAULT_WINDOWS_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const LOCAL_CHROME =
  process.env.PPTR_LOCAL_CHROME_PATH ??
  DEFAULT_WINDOWS_CHROME_PATHS.find((p) => existsSync(p));

type Format = 'pdf' | 'docx' | 'pptx';

interface Job {
  fileBase: string;      // 예: workbook-student
  doc: LearningDocument;
  variant: AnswerVariant;
  formats: Format[];
}

// Phase 0.6 산출물 스펙 — 사용자 지정 10개.
const JOBS: Job[] = [
  {
    fileBase: 'workbook-student',
    doc: sampleWorkbook,
    variant: 'student',
    formats: ['pdf', 'docx', 'pptx'],
  },
  {
    fileBase: 'workbook-teacher',
    doc: sampleWorkbook,
    variant: 'teacher',
    formats: ['pdf', 'docx', 'pptx'],
  },
  {
    fileBase: 'lessonPlan',
    doc: sampleLessonPlan,
    variant: 'combined',
    formats: ['pdf', 'docx', 'pptx'],
  },
  {
    fileBase: 'openingSlides',
    doc: sampleOpeningSlides,
    variant: 'combined',
    formats: ['pptx'],
  },
];

interface Result {
  file: string;
  format: Format;
  variant: AnswerVariant;
  ms: number;
  bytes: number;
  pages?: number;
}

// PDF 페이지 수 대략 카운트 (pdfinfo 미의존).
// PDF 표준: /Type /Page (Pages 아님) 오브젝트 개수 = 페이지 수.
// PDF 는 latin1 안전.
function countPdfPages(buf: Buffer): number {
  const text = buf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

async function renderJob(
  job: Job,
  format: Format,
): Promise<{ buf: Buffer; ms: number }> {
  const t0 = performance.now();
  let buf: Buffer;
  if (format === 'pdf') {
    buf = await renderPdf(job.doc, {
      useLocalChrome: Boolean(LOCAL_CHROME),
      localChromePath: LOCAL_CHROME,
      answerVariant: job.variant,
    });
  } else if (format === 'docx') {
    buf = await renderDocx(job.doc, { answerVariant: job.variant });
  } else {
    buf = await renderPptx(job.doc, { answerVariant: job.variant });
  }
  return { buf, ms: Math.round(performance.now() - t0) };
}

// Phase 0.7 재실증 필터 — 사용자가 요청한 5개 파일만.
const PHASE07_FILES = new Set([
  'lessonPlan.pdf',
  'workbook-student.pdf',
  'workbook-teacher.pdf',
  'workbook-teacher.docx',
  'workbook-teacher.pptx',
]);

function selectJobs(phase07: boolean): Job[] {
  if (!phase07) return JOBS;
  return JOBS.map((job) => ({
    ...job,
    formats: job.formats.filter((f) => PHASE07_FILES.has(`${job.fileBase}.${f}`)),
  })).filter((j) => j.formats.length > 0);
}

async function main() {
  const phase07 = process.argv.includes('--phase07');
  const jobs = selectJobs(phase07);
  const totalPlanned = jobs.reduce((a, j) => a + j.formats.length, 0);

  await mkdir(OUT_DIR, { recursive: true });
  const results: Result[] = [];

  if (phase07) {
    console.log(`\n[Phase 0.7] 재실증 모드 — 5개만 재생성`);
  } else {
    console.log(`\n[Phase 0.6] 전체 모드 — ${totalPlanned}개 산출물 생성`);
  }

  for (const job of jobs) {
    console.log(
      `\n=== ${job.fileBase}  (variant=${job.variant}) — ${job.doc.meta.title} ===`,
    );
    console.log(`  splitIntoSlides preview: ${splitIntoSlides(job.doc).length} slides`);

    for (const format of job.formats) {
      try {
        const { buf, ms } = await renderJob(job, format);
        const filename = `${job.fileBase}.${format}`;
        const p = path.join(OUT_DIR, filename);
        await writeFileWithRetry(p, buf);
        const pages = format === 'pdf' ? countPdfPages(buf) : undefined;
        results.push({
          file: filename,
          format,
          variant: job.variant,
          ms,
          bytes: buf.length,
          pages,
        });
        const pagesSuffix = pages !== undefined ? ` / ${pages}p` : '';
        console.log(
          `  ✓ ${format.padEnd(4)} ${buf.length.toString().padStart(7)} bytes / ${ms
            .toString()
            .padStart(5)} ms${pagesSuffix} → ${p}`,
        );
      } catch (err) {
        console.error(
          `  ✗ ${format} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  console.log(`\n=== Summary (총 ${results.length}개 산출물) ===`);
  console.table(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

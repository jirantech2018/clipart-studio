// Phase 0 sample 실행 스크립트.
//
// 실행 (Windows PowerShell 또는 Git Bash):
//   pnpm tsx scripts/learning-render-sample.ts
//
// 산출물:
//   ./tmp/phase-0/{workbook,lessonPlan,openingSlides}.{pdf,docx,pptx}
//
// 로컬 크롬 경로가 필요합니다. Windows 기본 위치를 자동 감지하며 없으면 환경변수:
//   PPTR_LOCAL_CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { renderDocx } from '../src/services/learning-renderer/docx';
import { renderPdf } from '../src/services/learning-renderer/pdf';
import { renderPptx, splitIntoSlides } from '../src/services/learning-renderer/pptx';
import { PHASE_0_SAMPLES } from '../src/services/learning-renderer/sample';

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'phase-0');

// Windows 기본 Chrome 위치 자동 감지 (필요 시 env 로 override).
const DEFAULT_WINDOWS_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const LOCAL_CHROME =
  process.env.PPTR_LOCAL_CHROME_PATH ??
  DEFAULT_WINDOWS_CHROME_PATHS.find((p) => existsSync(p));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results: Array<{ name: string; format: 'pdf' | 'docx' | 'pptx'; ms: number; bytes: number }> = [];

  for (const [name, doc] of Object.entries(PHASE_0_SAMPLES)) {
    console.log(`\n=== ${name} — ${doc.meta.title} ===`);
    console.log(`  slides preview: ${splitIntoSlides(doc).length} slides`);

    // PDF
    try {
      const t0 = performance.now();
      const buf = await renderPdf(doc, {
        useLocalChrome: Boolean(LOCAL_CHROME),
        localChromePath: LOCAL_CHROME,
      });
      const ms = Math.round(performance.now() - t0);
      const p = path.join(OUT_DIR, `${name}.pdf`);
      await writeFile(p, buf);
      results.push({ name, format: 'pdf', ms, bytes: buf.length });
      console.log(`  ✓ pdf  ${buf.length} bytes / ${ms} ms → ${p}`);
    } catch (err) {
      console.error(`  ✗ pdf failed:`, err instanceof Error ? err.message : err);
    }

    // DOCX
    try {
      const t0 = performance.now();
      const buf = await renderDocx(doc);
      const ms = Math.round(performance.now() - t0);
      const p = path.join(OUT_DIR, `${name}.docx`);
      await writeFile(p, buf);
      results.push({ name, format: 'docx', ms, bytes: buf.length });
      console.log(`  ✓ docx ${buf.length} bytes / ${ms} ms → ${p}`);
    } catch (err) {
      console.error(`  ✗ docx failed:`, err instanceof Error ? err.message : err);
    }

    // PPTX
    try {
      const t0 = performance.now();
      const buf = await renderPptx(doc);
      const ms = Math.round(performance.now() - t0);
      const p = path.join(OUT_DIR, `${name}.pptx`);
      await writeFile(p, buf);
      results.push({ name, format: 'pptx', ms, bytes: buf.length });
      console.log(`  ✓ pptx ${buf.length} bytes / ${ms} ms → ${p}`);
    } catch (err) {
      console.error(`  ✗ pptx failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\n=== Summary ===');
  console.table(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

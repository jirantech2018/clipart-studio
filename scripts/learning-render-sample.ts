// @ts-nocheck — Phase 0 실행 스크립트. 라이브러리 설치 후 제거.
//
// Phase 0 sample 실행 스크립트.
//
// 사용법:
//   1) 라이브러리 설치
//      pnpm add -D puppeteer-core @sparticuz/chromium docx pptxgenjs
//   2) 실행 (Windows PowerShell 예시)
//      pnpm tsx scripts/learning-render-sample.ts
//   3) 산출물 확인
//      ./tmp/phase-0/*.pdf, *.docx, *.pptx
//
// 로컬 개발 시 puppeteer 는 시스템 크롬 경로가 필요 — 환경변수로 전달:
//   PPTR_LOCAL_CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { renderDocx } from '@/services/learning-renderer/docx';
import { renderPdf } from '@/services/learning-renderer/pdf';
import { renderPptx, splitIntoSlides } from '@/services/learning-renderer/pptx';
import { PHASE_0_SAMPLES } from '@/services/learning-renderer/sample';

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'phase-0');
const LOCAL_CHROME = process.env.PPTR_LOCAL_CHROME_PATH;

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

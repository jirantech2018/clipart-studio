// 골든 PDF 를 페이지별 PNG 로 렌더 (art director reference input 용).
// 결과: tmp/ab-comparison/golden/golden-p1.png, golden-p2.png
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) throw new Error('chrome not found');

const pdfPath = path.resolve('tmp/ab-comparison/golden/golden.pdf');
if (!fs.existsSync(pdfPath)) throw new Error(`missing: ${pdfPath}`);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const abs = pdfPath.replace(/\\/g, '/');
const url = 'file:///' + abs;
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1414 }); // A4 approx at ~120dpi
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

// Chrome's PDF viewer exposes the total page count via the internal viewer.
// Simpler: try page-by-page by scrolling / URL fragment.
// Chrome PDF viewer supports #page=N.
const pageCount = 2; // Golden PDF is 2 pages
for (let i = 1; i <= pageCount; i++) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1000, height: 1414 });
  await p.goto(`${url}#page=${i}&zoom=100`, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const out = `tmp/ab-comparison/golden/golden-p${i}.png`;
  await p.screenshot({ path: out, fullPage: false });
  console.log(`  page ${i} -> ${out}`);
  await p.close();
}
await page.close();
await browser.close();

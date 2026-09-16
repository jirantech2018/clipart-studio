import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) throw new Error('chrome not found');

const dir = 'tmp/stage4-composition';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
for (const f of files) {
  const abs = path.resolve(dir, f);
  const url = 'file:///' + abs.replace(/\\/g, '/');
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1273 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const out = path.join(dir, f.replace(/\.pdf$/, '-p1.png'));
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  ${f} -> ${path.basename(out)}`);
  await page.close();
}
await browser.close();

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const CH = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CH.find((p)=>fs.existsSync(p));
const targets = process.argv.slice(2);
if (targets.length === 0) { console.error('usage: node stage4-2-shot.mjs <pdf1> [pdf2] ...'); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
for (const t of targets) {
  const abs = path.resolve(t).replace(/\\/g,'/');
  for (let i=1; i<=4; i++) {
    const p = await browser.newPage();
    await p.setViewport({ width: 900, height: 1273 });
    await p.goto(`file:///${abs}#page=${i}&zoom=90`, { waitUntil: 'networkidle0', timeout: 30000 }).catch(()=>{});
    await new Promise((r)=>setTimeout(r,1000));
    const out = t.replace(/\.pdf$/, `-p${i}.png`);
    await p.screenshot({ path: out, fullPage: false });
    console.log(`  ${t} p${i} -> ${out}`);
    await p.close();
  }
}
await browser.close();

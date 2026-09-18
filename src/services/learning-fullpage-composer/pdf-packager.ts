// 여러 페이지 PNG 를 하나의 A4 세로 PDF 로 패키징.
// puppeteer 로 HTML → PDF 를 사용해 인쇄 품질을 확보한다.
// 배경 이미지 위에 텍스트를 다시 그리지 않는다 (지시서 §8).

import puppeteer, { type Browser } from 'puppeteer-core';

export interface PackagePdfInput {
  pageImages: Buffer[]; // PNG bytes, 순서대로
  useLocalChrome?: boolean;
  localChromePath?: string;
}

async function launch(o: PackagePdfInput): Promise<Browser> {
  if (o.useLocalChrome) {
    if (!o.localChromePath) throw new Error('useLocalChrome=true 인데 localChromePath 없음');
    return puppeteer.launch({ executablePath: o.localChromePath, headless: true });
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function packagePngsAsPdf(input: PackagePdfInput): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; }
  .pg { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; }
  .pg:last-child { page-break-after: auto; }
  .pg img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style></head><body>
${input.pageImages
  .map((buf) => `<section class="pg"><img src="data:image/png;base64,${buf.toString('base64')}"/></section>`)
  .join('\n')}
</body></html>`;
  const browser = await launch(input);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }, printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** 최종 PDF 검증: 다시 PNG 로 렌더해 이미지 손상/왜곡 여부를 육안 대조할 수 있게 한다. */
export async function renderPdfPagesToPng(
  pdfBytes: Buffer,
  pageCount: number,
  o: PackagePdfInput,
): Promise<Buffer[]> {
  const browser = await launch(o);
  try {
    const out: Buffer[] = [];
    // 임시 파일 없이 data URL 은 PDF viewer 가 지원하지 않으므로 파일로 저장.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-pkg-'));
    const tmpPath = path.join(tmpDir, 'x.pdf');
    await fs.writeFile(tmpPath, pdfBytes);
    const abs = tmpPath.replace(/\\/g, '/');
    for (let i = 1; i <= pageCount; i += 1) {
      const p = await browser.newPage();
      await p.setViewport({ width: 1000, height: 1414 });
      await p.goto(`file:///${abs}#page=${i}&zoom=100`, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const shot = await p.screenshot({ type: 'png', fullPage: false });
      out.push(Buffer.from(shot));
      await p.close();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
    return out;
  } finally {
    await browser.close();
  }
}

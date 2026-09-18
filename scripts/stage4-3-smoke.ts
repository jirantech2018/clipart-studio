// Stage 4.3 스모크 — 자음 케이스 1 페이지만.
// GPT-Image-2.5 가 A4 페이지 전체를 그리고 gpt-4o vision OCR 로 텍스트 정확도
// 검증. 실패 시 최대 2회 edit. 결과 PDF 패키징까지.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { createSupabaseServiceClient } from '../src/services/supabase/server';
import {
  buildFullPageInput,
  orchestrateFullPage,
  packagePngsAsPdf,
} from '../src/services/learning-fullpage-composer';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

async function main() {
  const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
  const OUT = path.resolve(process.cwd(), 'tmp', 'stage4-3-smoke');
  await mkdir(OUT, { recursive: true });
  const GOLDEN_DIR = path.resolve(process.cwd(), 'tmp/ab-comparison/golden');
  if (!existsSync(path.join(GOLDEN_DIR, 'golden-p1.png'))) {
    // 기존 골든 PNG 가 없으면 스크립트가 필요함을 안내.
    throw new Error('golden PNG 누락. tmp/ab-comparison/golden/golden-p1.png 필요');
  }
  const goldenRefs = [
    { filename: 'golden-p1.png', bytes: readFileSync(path.join(GOLDEN_DIR, 'golden-p1.png')), contentType: 'image/png' as const },
    { filename: 'golden-p2.png', bytes: readFileSync(path.join(GOLDEN_DIR, 'golden-p2.png')), contentType: 'image/png' as const },
  ];

  // Base pipeline (Stage 4.1) 로 문서 확정.
  const service = createSupabaseServiceClient();
  await service.from('generation_jobs').update({ status: 'failed', error: 'stage4-3 smoke cleanup' })
    .eq('user_id', '6743b98b-9f19-46cc-bdf0-d43d03ae78c6').eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);
  const jobId = randomUUID();
  await service.from('generation_jobs').insert({
    id: jobId, user_id: '6743b98b-9f19-46cc-bdf0-d43d03ae78c6',
    prompt: '[stage4-3 smoke]', batch_size: 1, diversity_level: 0, reference_image_id: null,
    school_profile_applied: false, reserved_credits: 0,
    status: 'queued', org_id: 'b83a2b0f-162c-4dad-88b4-65343e299ab6', kind: 'learning_doc',
  });
  const t0 = Date.now();
  const result = await dispatchLearningDoc({
    jobId, userId: '6743b98b-9f19-46cc-bdf0-d43d03ae78c6',
    organizationId: 'b83a2b0f-162c-4dad-88b4-65343e299ab6',
    orgSlug: 'personal-6743b98b9f1946ccbdf0d43d03ae78c6',
    enableV2Override: true,
    grade: 1, subject: 'KOR', materialType: 'multiple_choice',
    unit: '한글의 자음과 모음', topic: '자음의 소리 구별하기',
    questionCount: 5, difficulty: 'normal', clipartMode: 'auto',
    additionalRequest: '관찰→식별→쓰기→확장',
  });
  console.log(`base pipeline ${Date.now() - t0}ms doc=${result.documentId.slice(0, 8)}`);
  if (!result.compositionPlan) throw new Error('composition missing');

  const blockToImages = new Map<string, string[]>();
  for (const [k, v] of Object.entries(result.appliedComposition?.blockToImageUrls ?? {})) {
    blockToImages.set(k, v as string[]);
  }

  console.log('building FullPageWorksheetInput...');
  const fpInput = await buildFullPageInput({
    documentId: result.documentId,
    variant: 'student',
    document: result.document,
    compositionPlan: result.compositionPlan,
    blockToImages,
    goldenReferences: goldenRefs,
  });
  console.log(`  pages=${fpInput.pages.length} assets=${fpInput.visualAssets.length} exactTexts(p1)=${fpInput.pages[0]?.exactVisibleTexts.length}`);
  await writeFile(path.join(OUT, 'full-page-input.json'), JSON.stringify({
    ...fpInput,
    visualAssets: fpInput.visualAssets.map((a) => ({ assetId: a.assetId, filename: a.filename, size: a.bytes.length })),
    goldenReferences: fpInput.goldenReferences.map((g) => ({ filename: g.filename, size: g.bytes.length })),
  }, null, 2));

  // 스모크: 첫 페이지만.
  const firstPage = fpInput.pages[0]!;
  console.log(`\ncompose page 1...`);
  const composed = await orchestrateFullPage({
    input: fpInput, page: firstPage,
    onEvent: (m) => console.log('  ' + m),
  });
  console.log(`  finalPass=${composed.finalPass} · editHistory=${composed.editHistory.length} · missing=${composed.verification.missingTexts.length}`);
  await writeFile(path.join(OUT, `original-p1.png`), composed.editHistory[0]?.imageBytesBefore ?? composed.imageBytes);
  await writeFile(path.join(OUT, `final-p1.png`), composed.imageBytes);
  await writeFile(path.join(OUT, `verification-p1.json`), JSON.stringify(composed.verification, null, 2));
  await writeFile(path.join(OUT, `prompt-p1.txt`), composed.promptUsed);
  for (const [i, e] of composed.editHistory.entries()) {
    await writeFile(path.join(OUT, `edit-${i + 1}-before.png`), e.imageBytesBefore);
    await writeFile(path.join(OUT, `edit-${i + 1}-after.png`), e.imageBytesAfter);
    await writeFile(path.join(OUT, `edit-${i + 1}-instruction.txt`), e.editInstruction);
  }

  if (composed.imageBytes.length > 0) {
    const pdf = await packagePngsAsPdf({
      pageImages: [composed.imageBytes],
      useLocalChrome: Boolean(chrome), localChromePath: chrome,
    });
    await writeFile(path.join(OUT, 'stage4-3-student-p1.pdf'), pdf);
    console.log(`  PDF ${pdf.length}b`);
  }
  console.log('SMOKE DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });

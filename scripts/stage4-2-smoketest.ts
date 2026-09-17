// 1 case × 1 run 스모크 (jamo 만) — 파이프라인 end-to-end 검증.
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
} from '../src/services/learning-art-director';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

async function main() {
  const chrome = process.env.PPTR_LOCAL_CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
  const OUT = path.resolve(process.cwd(), 'tmp', 'stage4-2-smoke');
  await mkdir(OUT, { recursive: true });

  const GOLDEN = path.resolve(process.cwd(), 'tmp/ab-comparison/golden');
  const goldenRefs = [
    { bytes: readFileSync(path.join(GOLDEN, 'golden-p1.png')), label: 'g1' },
    { bytes: readFileSync(path.join(GOLDEN, 'golden-p2.png')), label: 'g2' },
  ];

  const jobId = randomUUID();
  const service = createSupabaseServiceClient();
  await service.from('generation_jobs').update({ status: 'failed', error: 'smoke' })
    .eq('user_id', '6743b98b-9f19-46cc-bdf0-d43d03ae78c6').eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);
  await service.from('generation_jobs').insert({
    id: jobId, user_id: '6743b98b-9f19-46cc-bdf0-d43d03ae78c6',
    prompt: '[smoke]', batch_size: 1, diversity_level: 0, reference_image_id: null,
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
  console.log(`base ${Date.now() - t0}ms doc=${result.documentId.slice(0, 8)}`);
  if (!result.compositionPlan) throw new Error('composition 없음');
  const composition = result.compositionPlan;
  const doc = result.document;
  const bimObj = result.appliedComposition?.blockToImageUrls as Record<string, string[]>;
  const blockToImages = new Map(Object.entries(bimObj));
  const blockToSection = buildBlockToSection(composition, doc);

  const cur = await renderCompositionPdf(
    { document: doc, compositionPlan: composition, blockToSection, blockToImages },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student' },
  );
  await writeFile(path.join(OUT, 'current.pdf'), cur);
  console.log(`current ${cur.length}b`);

  const firstPage = composition.pages[0]!;
  const ref = await generateArtDirectorReference({ page: firstPage, goldenReferences: goldenRefs });
  if (!ref.ok) { console.error('ref fail', ref.reason); process.exit(2); }
  await writeFile(path.join(OUT, `reference-${firstPage.pageId}.png`), ref.imageBytes);
  const extracted = await extractArtDirectionWithRetry({ page: firstPage, referenceImageBytes: ref.imageBytes });
  if (!extracted.ok) { console.error('ext fail', extracted.reason); process.exit(3); }
  await writeFile(path.join(OUT, `direction-${firstPage.pageId}.json`), JSON.stringify(extracted.direction, null, 2));
  const directionByPage = new Map([[firstPage.pageId, extracted.direction]]);
  const hyb = await renderHybridArtDirectedPdf(
    { compositionPlan: composition, document: doc, blockToImages, directionByPage },
    { useLocalChrome: Boolean(chrome), localChromePath: chrome, answerVariant: 'student', grade: 1 },
  );
  await writeFile(path.join(OUT, 'hybrid.pdf'), hyb.pdf);
  await writeFile(path.join(OUT, 'layout-review.json'), JSON.stringify({ pages: hyb.pageCount, density: hyb.densityMetrics, issues: hyb.issues, fallback: hyb.fallbackPageIds }, null, 2));
  console.log(`hybrid ${hyb.pdf.length}b pages=${hyb.pageCount} issues=${hyb.issues.length}`);
  console.log('SMOKE PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });

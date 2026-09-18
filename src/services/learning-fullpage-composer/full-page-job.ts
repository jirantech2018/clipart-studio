// Stage 4.3 Full-Page Composer 을 job handler 에서 호출하기 위한 top-level 함수.
//
// 입력: 이미 생성된 LearningDocument + CompositionPlan + blockToImages
// 출력: 학생용 PDF (+ 선택적 교사용) + R2 저장된 asset 참조 + 검증 요약
//
// 이 함수는 base pipeline (Stage 4.1 orchestrator) 이후 호출된다.
// LearningDocument 는 이미 저장돼 있어야 하고, documentId 를 받는다.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { PageCompositionPlan } from '@/services/learning-composition';
import type { LearningDocument } from '@/services/learning-renderer/schema';

import { buildFullPageInput } from './input-builder';
import { orchestrateFullPage } from './orchestrator';
import { packagePngsAsPdf } from './pdf-packager';
import { persistFullPageAssets } from './persist-assets';
import type { ComposedPage, GoldenReference } from './types';

export const FULL_PAGE_PIPELINE_VERSION = 'v1.0-stage4.3';
export const FULL_PAGE_MODEL = process.env.AB_IMAGE_MODEL || 'gpt-image-2.5-sunburst';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function pickChrome(): string | undefined {
  const env = process.env.PPTR_LOCAL_CHROME_PATH;
  if (env) return env;
  if (process.platform === 'win32') {
    for (const p of CHROME_CANDIDATES) {
      try {
        if (existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

export interface FullPageJobInput {
  documentId: string;
  organizationId: string;
  document: LearningDocument;
  compositionPlan: PageCompositionPlan;
  blockToImages: Map<string, string[]>;
  includeTeacher?: boolean; // 이번 릴리스에서는 teacher 미지원 → 향후 확장
  goldenReferences?: GoldenReference[]; // 미제공 시 서버 기본 골든 로드
  onEvent?: (msg: string) => void;
}

export interface FullPageJobResult {
  ok: boolean;
  documentId: string;
  pageCount: number;
  failedPages: number;
  totalMs: number;
  totalImageCalls: number;
  totalVisionCalls: number;
  studentPdfBytes: number;
  assetKeys: Awaited<ReturnType<typeof persistFullPageAssets>>;
  pageVerifications: Array<{ pageNumber: number; pass: boolean; missingCount: number; editAttempts: number }>;
  fallbackReason?: string;
}

/** 기본 골든 참조 로드 (서버 배포 asset). */
function loadDefaultGoldenReferences(): GoldenReference[] {
  const candidateDirs = [
    path.resolve(process.cwd(), 'public', 'golden-references'),
    path.resolve(process.cwd(), 'tmp', 'ab-comparison', 'golden'),
  ];
  for (const dir of candidateDirs) {
    const p1 = path.join(dir, 'golden-p1.png');
    const p2 = path.join(dir, 'golden-p2.png');
    if (existsSync(p1) && existsSync(p2)) {
      return [
        { filename: 'golden-p1.png', bytes: readFileSync(p1), contentType: 'image/png' },
        { filename: 'golden-p2.png', bytes: readFileSync(p2), contentType: 'image/png' },
      ];
    }
  }
  // 골든 없이 진행 — reference 없으면 art director 는 자체 판단.
  return [];
}

export async function runFullPageJob(input: FullPageJobInput): Promise<FullPageJobResult> {
  const started = Date.now();
  const log = (m: string) => input.onEvent?.(m);
  const chrome = pickChrome();

  const goldenReferences = input.goldenReferences ?? loadDefaultGoldenReferences();

  log('build input...');
  const fpInput = await buildFullPageInput({
    documentId: input.documentId,
    variant: 'student',
    document: input.document,
    compositionPlan: input.compositionPlan,
    blockToImages: input.blockToImages,
    goldenReferences,
  });

  const pageImages: Buffer[] = [];
  const pageVerifications: FullPageJobResult['pageVerifications'] = [];
  let totalImageCalls = 0;
  let totalVisionCalls = 0;
  let failedPages = 0;
  let previousPageImage: Buffer | undefined;

  for (const page of fpInput.pages) {
    log(`compose page ${page.pageNumber} / ${fpInput.pages.length}`);
    const composed: ComposedPage = await orchestrateFullPage({
      input: fpInput,
      page,
      previousPageImage,
      imageModel: FULL_PAGE_MODEL,
      onEvent: log,
    });
    // image + vision call 집계: compose 1 + edit N + verify (edit N + 1).
    totalImageCalls += 1 + composed.editHistory.length;
    totalVisionCalls += 1 + composed.editHistory.length;
    pageVerifications.push({
      pageNumber: page.pageNumber,
      pass: composed.finalPass,
      missingCount: composed.verification.missingTexts.length,
      editAttempts: composed.editHistory.length,
    });
    if (!composed.finalPass) failedPages += 1;
    if (composed.imageBytes.length > 0) {
      pageImages.push(composed.imageBytes);
      previousPageImage = composed.imageBytes;
    }
  }

  if (pageImages.length === 0) {
    return {
      ok: false,
      documentId: input.documentId,
      pageCount: 0,
      failedPages,
      totalMs: Date.now() - started,
      totalImageCalls,
      totalVisionCalls,
      studentPdfBytes: 0,
      assetKeys: {
        studentPdfKey: '',
        studentPdfUrl: '',
        studentPageKeys: [],
        verificationReportKey: '',
      },
      pageVerifications,
      fallbackReason: 'no pages composed',
    };
  }

  log(`package PDF (${pageImages.length} pages)...`);
  const studentPdf = await packagePngsAsPdf({
    pageImages,
    useLocalChrome: Boolean(chrome),
    localChromePath: chrome,
  });

  log('persist to R2...');
  const assetKeys = await persistFullPageAssets({
    documentId: input.documentId,
    organizationId: input.organizationId,
    studentPdf,
    studentPagePngs: pageImages,
    verificationReport: {
      pipelineVersion: FULL_PAGE_PIPELINE_VERSION,
      model: FULL_PAGE_MODEL,
      pageVerifications,
      totalImageCalls,
      totalVisionCalls,
    },
    pipelineVersion: FULL_PAGE_PIPELINE_VERSION,
    model: FULL_PAGE_MODEL,
  });

  return {
    ok: failedPages === 0,
    documentId: input.documentId,
    pageCount: pageImages.length,
    failedPages,
    totalMs: Date.now() - started,
    totalImageCalls,
    totalVisionCalls,
    studentPdfBytes: studentPdf.length,
    assetKeys,
    pageVerifications,
  };
}

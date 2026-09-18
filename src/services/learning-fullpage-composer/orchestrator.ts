// Full-page 학습지 생성 오케스트레이터.
//
// per page: compose → verify → 실패면 최대 2회 edit → 최종 verify.
// 최종 pass 여부와 편집 이력을 ComposedPage 로 반환.

import { buildEditInstruction, verifyPageContent } from './content-verifier';
import { composeFullPageWorksheet, editComposedPage } from './page-composer';
import type { ComposedPage, EditHistoryEntry, FullPageWorksheetInput, WorksheetPageBrief } from './types';

const MAX_EDITS_PER_PAGE = 2;

export interface OrchestratePageInput {
  input: FullPageWorksheetInput;
  page: WorksheetPageBrief;
  previousPageImage?: Buffer;
  imageModel?: string;
  visionModel?: string;
  onEvent?: (msg: string) => void;
}

export async function orchestrateFullPage(x: OrchestratePageInput): Promise<ComposedPage> {
  const log = (m: string) => x.onEvent?.(`[p${x.page.pageNumber}] ${m}`);
  const started = Date.now();

  log(`compose...`);
  let compose = await composeFullPageWorksheet({
    input: x.input, page: x.page, previousPageImage: x.previousPageImage, model: x.imageModel,
  });
  let currentImage: Buffer;
  let promptUsed: string;
  if (!compose.ok) {
    log(`initial compose fail: ${compose.reason} — retry once`);
    compose = await composeFullPageWorksheet({
      input: x.input, page: x.page, previousPageImage: x.previousPageImage, model: x.imageModel,
    });
  }
  if (!compose.ok) {
    log(`compose fail after retry: ${compose.reason}`);
    return {
      pageNumber: x.page.pageNumber,
      imageBytes: Buffer.alloc(0),
      contentType: 'image/png',
      model: compose.model,
      durationMs: Date.now() - started,
      promptUsed: compose.promptUsed,
      editHistory: [],
      verification: {
        pageNumber: x.page.pageNumber,
        pass: false,
        ocrText: '',
        exactTextMatches: x.page.exactVisibleTexts.map((t) => ({ id: t.id, expected: t.text, found: false })),
        missingTexts: x.page.exactVisibleTexts.map((t) => t.text),
        unexpectedTexts: [],
        incorrectCharacters: [],
        incorrectNumbers: [],
        incorrectImageMappings: [],
        answerLeakage: [{ detail: 'compose 실패', leakedText: compose.reason }],
        missingResponseSpaces: [],
      },
      finalPass: false,
    };
  }
  currentImage = compose.imageBytes;
  promptUsed = compose.promptUsed;
  log(`compose ok ${compose.durationMs}ms · ${currentImage.length}b`);

  log(`verify...`);
  let verify = await verifyPageContent({ input: x.input, page: x.page, imageBytes: currentImage, model: x.visionModel });
  log(`verify ${verify.verification.pass ? 'PASS' : 'FAIL'} · missing=${verify.verification.missingTexts.length} charIssues=${verify.verification.incorrectCharacters.length} numIssues=${verify.verification.incorrectNumbers.length} leaks=${verify.verification.answerLeakage.length}`);

  const editHistory: EditHistoryEntry[] = [];
  for (let attempt = 1; attempt <= MAX_EDITS_PER_PAGE && !verify.verification.pass; attempt += 1) {
    const editInstruction = buildEditInstruction(verify.verification);
    if (!editInstruction) break;
    log(`edit attempt ${attempt}...`);
    const before = currentImage;
    const editStarted = Date.now();
    const edit = await editComposedPage({ imageBytes: currentImage, editInstruction, model: x.imageModel });
    const editMs = Date.now() - editStarted;
    if (!edit.ok) {
      log(`edit fail: ${edit.reason}`);
      break;
    }
    editHistory.push({
      attempt,
      reason: 'content verification failed',
      editInstruction,
      imageBytesBefore: before,
      imageBytesAfter: edit.imageBytes,
      durationMs: editMs,
    });
    currentImage = edit.imageBytes;
    log(`re-verify after edit ${attempt}...`);
    verify = await verifyPageContent({ input: x.input, page: x.page, imageBytes: currentImage, model: x.visionModel });
    log(`re-verify ${verify.verification.pass ? 'PASS' : 'FAIL'} · missing=${verify.verification.missingTexts.length}`);
  }

  return {
    pageNumber: x.page.pageNumber,
    imageBytes: currentImage,
    contentType: 'image/png',
    model: compose.model,
    durationMs: Date.now() - started,
    promptUsed,
    editHistory,
    verification: verify.verification,
    finalPass: verify.verification.pass,
  };
}

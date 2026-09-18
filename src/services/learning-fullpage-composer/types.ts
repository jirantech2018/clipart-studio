// Stage 4.3 Full-Page Worksheet Composer — 지시서 §6 계약.
//
// GPT-Image-2.5 가 페이지 전체를 직접 설계. 우리 시스템은 콘텐츠 확정, OCR
// 정확성 검증, 오류 영역 부분 수정, 학생용/교사용 변환, PDF 패키징 담당.

export type AnswerMode =
  | 'connect'
  | 'choose'
  | 'write'
  | 'draw'
  | 'explain'
  | 'calculate'
  | 'observe';

export interface FullPageWorksheetInput {
  documentId: string;
  variant: 'student' | 'teacher';
  grade: number;
  subject: string;
  title: string;
  learningGoal: string;
  pageTarget: number;
  pages: WorksheetPageBrief[];
  visualAssets: VisualAsset[];
  goldenReferences: GoldenReference[];
}

export interface WorksheetPageBrief {
  pageNumber: number;
  pagePurpose: string;
  activityFlow: string[];
  blocks: WorksheetBlockBrief[];
  exactVisibleTexts: ExactVisibleText[];
  prohibitedVisibleTexts: string[];
  requiredStudentActions: StudentAction[];
  selfCheck?: SelfCheckBrief;
}

export interface WorksheetBlockBrief {
  blockId: string;
  learningPurpose: string;
  activityType: string;
  instruction: string;
  items: unknown[];
  answerMode: AnswerMode;
  requiredResponseSpace: string;
  imageAssetIds: string[];
  studentAnswerVisible: false;
}

export interface ExactVisibleText {
  id: string;
  text: string;
  role: 'title' | 'instruction' | 'label' | 'choice' | 'example' | 'footer' | 'self-check';
}

export interface StudentAction {
  blockId: string;
  action: string;
}

export interface SelfCheckBrief {
  prompt: string;
  optionsPositive: string;
  optionsNegative: string;
}

export interface VisualAsset {
  assetId: string;
  filename: string;
  bytes: Buffer;
  contentType: 'image/png' | 'image/webp';
  intendedRole?: string;
}

export interface GoldenReference {
  filename: string;
  bytes: Buffer;
  contentType: 'image/png';
}

// ============================================================
// Content verification (지시서 §9.2)
// ============================================================
export interface PageContentVerification {
  pageNumber: number;
  pass: boolean;
  ocrText: string;
  exactTextMatches: TextMatchResult[];
  missingTexts: string[];
  unexpectedTexts: string[];
  incorrectCharacters: CharacterIssue[];
  incorrectNumbers: NumberIssue[];
  incorrectImageMappings: MappingIssue[];
  answerLeakage: AnswerLeakageIssue[];
  missingResponseSpaces: ResponseSpaceIssue[];
}

export interface TextMatchResult {
  id: string;
  expected: string;
  found: boolean;
  approxLocation?: string;
}

export interface CharacterIssue {
  expected: string;
  observed: string;
  contextExpectedTextId?: string;
}

export interface NumberIssue {
  expected: string;
  observed: string;
  contextExpectedTextId?: string;
}

export interface MappingIssue {
  imageAssetId: string;
  expectedLabel: string;
  observedLabel?: string;
  detail: string;
}

export interface AnswerLeakageIssue {
  detail: string;
  leakedText: string;
}

export interface ResponseSpaceIssue {
  blockId: string;
  detail: string;
}

// ============================================================
// Page composer output
// ============================================================
export interface ComposedPage {
  pageNumber: number;
  imageBytes: Buffer;
  contentType: 'image/png';
  model: string;
  seed?: string;
  durationMs: number;
  promptUsed: string;
  editHistory: EditHistoryEntry[];
  verification: PageContentVerification;
  finalPass: boolean;
}

export interface EditHistoryEntry {
  attempt: number;
  reason: string;
  editInstruction: string;
  imageBytesBefore: Buffer;
  imageBytesAfter: Buffer;
  durationMs: number;
}

// ============================================================
// Telemetry
// ============================================================
export interface Stage43Telemetry {
  documentId: string;
  variant: 'student' | 'teacher';
  imageModel: string;
  visionModel: string;
  pages: Array<{
    pageNumber: number;
    initialGenerationMs: number;
    editCalls: number;
    verificationCalls: number;
    initialPassed: boolean;
    finalPassed: boolean;
    finalIssues: number;
  }>;
  totalMs: number;
  totalImageCalls: number;
  totalVisionCalls: number;
  estimatedCostUsd: number;
}

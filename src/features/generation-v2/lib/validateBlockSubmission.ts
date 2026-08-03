// Conversation Block 의 "생성 요청 가능 여부" 를 사용자에게 보여줄 대표적인
// 사유 하나로 압축하는 얇은 Adapter.
//
// 이 파일은 새로운 정책을 정의하지 않는다. 기존 자산을 조합해 UI 안내를
// 만들 뿐이며, 실제 서버 요청 가능 여부와 어긋나면 안 된다.
//   - Prompt / batchSize / referenceImageId / orgReferenceId 등 필드 검증은
//     createJobSchema (SoT) 를 그대로 사용
//   - 개인/조직 참조 상호배제도 createJobSchema 의 부수 규칙과 일치
//   - 크레딧 부족 판정은 authStore 가 이미 seed 한 서버 실측값 사용
//   - 활성 Job 존재 여부는 conversationStore 파생값
//
// 우선순위 (지시 §Validation):
//   1) active-job
//   2) empty-prompt
//   3) reference-conflict
//   4) insufficient-credits
//   5) invalid-options

import { createJobSchema } from '@/types/schemas';

import type { BlockOptions } from '@/lib/store/conversationStore';

export type BlockSubmissionIssue =
  | 'active-job'
  | 'empty-prompt'
  | 'reference-conflict'
  | 'insufficient-credits'
  | 'invalid-options'
  | null;

export interface ValidateInput {
  prompt: string;
  options: BlockOptions;
  credits: number;
  activeJobExists: boolean;
  /** 이미 잠긴(요청 시작된) Block 은 검사 대상 아님. */
  isDraftBlock: boolean;
}

export function validateBlockSubmission(input: ValidateInput): BlockSubmissionIssue {
  const { prompt, options, credits, activeJobExists, isDraftBlock } = input;

  if (!isDraftBlock) return null;

  if (activeJobExists) return 'active-job';

  const trimmed = prompt.trim();
  if (trimmed.length < 2) return 'empty-prompt';

  const personalRef = options.personalReferenceIds[0] ?? null;
  const orgRef = options.orgReferenceIds[0] ?? null;

  if (personalRef && orgRef) return 'reference-conflict';

  if (credits < options.batchSize) return 'insufficient-credits';

  const parsed = createJobSchema.safeParse({
    prompt: trimmed,
    batchSize: options.batchSize,
    diversityLevel: 0,
    referenceImageId: personalRef,
    customReferenceId: null,
    schoolProfileApplied: options.schoolProfileApplied,
    generationMode: 'text2img',
    aspectRatio: options.aspectRatio,
    orgSlug: options.orgSlug,
    orgReferenceId: orgRef,
    slotPrompts: options.diversityCustomOn ? options.slotPrompts : null,
  });
  if (!parsed.success) return 'invalid-options';

  return null;
}

export function messageForIssue(
  issue: BlockSubmissionIssue,
  args?: { creditDeficit?: number },
): string | null {
  switch (issue) {
    case 'active-job':
      return '현재 이미지 생성이 진행 중입니다.';
    case 'empty-prompt':
      return '만들고 싶은 이미지를 먼저 입력해주세요.';
    case 'reference-conflict':
      return '개인 참조 이미지와 학교 참조 이미지는 동시에 사용할 수 없어요.';
    case 'insufficient-credits':
      return args?.creditDeficit && args.creditDeficit > 0
        ? `크레딧이 ${args.creditDeficit}개 부족합니다.`
        : '크레딧이 부족합니다.';
    case 'invalid-options':
      return '옵션을 다시 확인해주세요.';
    case null:
      return null;
  }
}

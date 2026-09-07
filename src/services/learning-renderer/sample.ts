// Phase 0 sample — 세 렌더러 실증용 하드코딩 문서.
// 학년/과목/자료유형이 서로 다른 3종을 준비해 세 포맷의 표현력을 비교한다.

import type { LearningDocument } from './schema';

// 1) 학생 배포용 문제집 (PDF 기본) — 3학년 국어 객관식
export const sampleWorkbook: LearningDocument = {
  meta: {
    title: '3학년 국어 · 낱말의 뜻 익히기',
    grade: 3,
    subject: 'KOR',
    materialType: 'multiple_choice',
    difficulty: 'normal',
    estimatedMinutes: 20,
    topic: '낱말의 뜻과 문장 표현',
    teacherReviewRequired: true,
    generatedAt: new Date().toISOString(),
  },
  sections: [
    { kind: 'heading', level: 1, text: '낱말의 뜻 익히기' },
    {
      kind: 'callout',
      tone: 'info',
      text: '아래 문장을 잘 읽고 알맞은 낱말을 골라 보세요.',
    },
    {
      kind: 'question',
      qtype: 'mc',
      number: 1,
      stem: '“소나기가 갑자기 쏟아졌어요.” 여기서 ‘쏟아지다’ 와 뜻이 가장 비슷한 낱말은?',
      choices: ['맞다', '내리다', '흐르다', '떠오르다'],
      answer: '2',
    },
    {
      kind: 'question',
      qtype: 'mc',
      number: 2,
      stem: '다음 중 낱말의 짜임이 다른 하나는 무엇인가요?',
      choices: ['하늘색', '봄바람', '나무', '책가방'],
      answer: '3',
      hint: '두 낱말이 합쳐진 낱말과 하나의 낱말을 구별해 보세요.',
    },
    {
      kind: 'question',
      qtype: 'short',
      number: 3,
      stem: '“새싹이 파릇파릇 돋아났어요.” 밑줄 친 부분을 흉내 내는 다른 낱말로 바꾸어 써 보세요.',
      answer: '(예시) 방긋방긋 / 소복소복',
    },
    { kind: 'heading', level: 2, text: '한 번 더 생각해 봐요' },
    {
      kind: 'activity',
      title: '내가 만드는 짧은 글',
      steps: [
        '오늘 배운 낱말 중 두 개를 골라요.',
        '두 낱말을 넣어 두 문장 이상의 짧은 글을 써 보세요.',
        '짝과 서로 바꿔 읽어 주세요.',
      ],
      estimatedMinutes: 10,
    },
    {
      kind: 'answer-key',
      entries: [
        { ref: '1', answer: '2번', rationale: '‘쏟아지다’ 는 물이 세게 흘러내리는 뜻으로 ‘내리다’ 와 뜻이 통해요.' },
        { ref: '2', answer: '3번', rationale: '‘나무’ 는 한 낱말, 나머지는 두 낱말이 합쳐졌어요.' },
        { ref: '3', answer: '예시 답안 확인', rationale: '흉내 내는 말이면 정답으로 인정합니다.' },
      ],
    },
  ],
};

// 2) 교사 편집용 수업안 (Word 기본) — 5학년 수학
export const sampleLessonPlan: LearningDocument = {
  meta: {
    title: '5학년 수학 · 분수의 덧셈 (40분 수업안)',
    grade: 5,
    subject: 'MATH',
    materialType: 'lesson_plan',
    difficulty: 'normal',
    estimatedMinutes: 40,
    topic: '분수의 덧셈과 뺄셈',
    teacherReviewRequired: true,
    generatedAt: new Date().toISOString(),
  },
  sections: [
    { kind: 'heading', level: 1, text: '분수의 덧셈 수업안' },
    { kind: 'paragraph', text: '학년: 5학년 · 과목: 수학 · 소요 시간: 40분' },
    {
      kind: 'callout',
      tone: 'tip',
      text: 'AI 초안입니다. 학급 상황에 맞게 자유롭게 수정하세요.',
    },
    { kind: 'heading', level: 2, text: '학습 목표' },
    {
      kind: 'paragraph',
      text: '분모가 다른 두 분수의 덧셈을 통분을 이용하여 계산할 수 있다.',
    },
    { kind: 'heading', level: 2, text: '수업 흐름' },
    {
      kind: 'table',
      headers: ['단계', '시간', '교사 활동', '학생 활동'],
      rows: [
        ['도입', '5분', '지난 시간 통분 복습 발문', '자유롭게 대답하며 개념 상기'],
        ['전개1', '10분', '분모가 다른 분수의 덧셈 예시 시범', '노트에 함께 계산'],
        ['전개2', '15분', '개별·모둠 활동 순회 지도', '개별 문제 풀이 후 모둠 확인'],
        ['정리', '10분', '핵심 정리 발문 · 오늘의 어려움 나누기', '학습 되돌아보기 카드 작성'],
      ],
    },
    { kind: 'heading', level: 2, text: '평가 계획' },
    {
      kind: 'rubric',
      criteria: [
        {
          criterion: '통분 이해',
          levels: [
            '두 분모의 최소공배수를 정확히 구해 통분한다.',
            '통분 개념은 이해하나 계산 오류가 있다.',
            '통분 개념을 이해하지 못한다.',
          ],
        },
        {
          criterion: '덧셈 계산',
          levels: [
            '통분한 분수를 정확히 더하고 기약분수로 나타낸다.',
            '덧셈 결과를 구하나 약분에서 실수한다.',
            '덧셈을 완성하지 못한다.',
          ],
        },
      ],
    },
    { kind: 'heading', level: 2, text: '준비물' },
    {
      kind: 'paragraph',
      text: '분수 카드, 화이트보드, 개별 활동지 (별도 첨부)',
    },
  ],
};

// 3) 화면 제시용 수업 도입 슬라이드 (PPT 기본) — 2학년 통합교과
export const sampleOpeningSlides: LearningDocument = {
  meta: {
    title: '2학년 · 우리 마을을 소개해요 (수업 도입)',
    grade: 2,
    subject: 'INT',
    materialType: 'opening_question',
    difficulty: 'easy',
    estimatedMinutes: 10,
    topic: '우리 마을과 이웃',
    teacherReviewRequired: true,
    generatedAt: new Date().toISOString(),
  },
  sections: [
    { kind: 'heading', level: 1, text: '우리 마을을 소개해요' },
    { kind: 'paragraph', text: '오늘 함께 살펴볼 주제입니다.' },
    { kind: 'slide-break', reason: '표지 → 첫 발문' },

    { kind: 'heading', level: 1, text: '💬 오늘의 이야기' },
    { kind: 'paragraph', text: '학교 오는 길에 무엇을 보았나요?' },
    { kind: 'callout', tone: 'tip', text: '떠오르는 대로 자유롭게 말해 봐요.' },
    { kind: 'slide-break' },

    { kind: 'heading', level: 1, text: '🏠 우리 마을에는 무엇이 있을까요?' },
    {
      kind: 'table',
      headers: ['장소', '누가 있어요?'],
      rows: [
        ['학교', '선생님, 친구들'],
        ['시장', '가게 사장님, 손님'],
        ['공원', '이웃, 산책하는 사람'],
      ],
    },
    { kind: 'slide-break' },

    { kind: 'heading', level: 1, text: '✏️ 다음 시간 활동 안내' },
    {
      kind: 'activity',
      title: '우리 마을 그림 지도 그리기',
      steps: [
        '내가 좋아하는 장소 세 곳을 정해요.',
        '장소를 큰 그림으로 그려요.',
        '친구들에게 소개해요.',
      ],
    },
  ],
};

export const PHASE_0_SAMPLES = {
  workbook: sampleWorkbook,
  lessonPlan: sampleLessonPlan,
  openingSlides: sampleOpeningSlides,
} as const;

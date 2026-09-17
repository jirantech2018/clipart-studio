// PageCompositionPlan 생성 프롬프트.
//
// 입력: GenerationContext + ContentPlan + WorksheetPlan
// 출력: PageCompositionPlan (JSON v1)
//
// 원칙:
//   - 과목/단원/학년별 조건문 없음.
//   - 학생 행동, 자료 유형, 시각자료 역할, 답안 공간을 근거로 primitive 를 동적 선택.
//   - primitive 는 정보 배치·컬럼·이미지 위치·답안 공간·시선 흐름·학생 행동이
//     실제로 달라야 하는 13종 중에서 골라 사용.

import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type { ContentPlan } from '@/services/learning-generation/types';
import type { WorksheetPlan } from '@/services/learning-worksheet';

export function compositionSystemPrompt(): string {
  return [
    `너는 초등 학습지 지면 조판 설계자다.`,
    `주어진 GenerationContext, ContentPlan, WorksheetPlan 을 종합해 학생이 실제로 종이 위에서 수행할 수 있는`,
    `페이지 구성 (PageCompositionPlan) 을 JSON 으로 응답한다.`,
    ``,
    `핵심 원칙:`,
    `- 특정 과목·단원·주제 문자열에 조건 분기하지 마라. 학생 행동·시각 역할·답안 유형·정보 위계만 근거로 primitive 를 고른다.`,
    `- 같은 활동을 매번 같은 카드로 나열하지 마라. 활동의 학습 행동이 다르면 primitive 도 다르게 배치한다.`,
    `- 페이지 목표 수 (pageTarget) 를 넘기지 마라. 대신 컬럼·병합·밀도를 조정한다.`,
    `- 첫 페이지가 제목만 남는 구성을 만들지 마라.`,
    `- 이미지가 카드 아래에 따로 떨어지는 구조를 만들지 마라 — 이미지는 반드시 활동 블록의 visualSlot 안에 있다.`,
    ``,
    `학습 행동 발전 (Scaffolding) — 블록 순서는 학생의 인지 부담이 낮은 것에서 높은 것으로 진행해야 한다:`,
    `- 인식/관찰 (recognition/observation) → 식별/선택 (discrimination) → 생산/쓰기 (production) → 창의 확장/설명 (extension)`,
    `- 5개 블록을 같은 primitive 로 5회 반복하지 마라. 블록 사이에 학생의 수행 행동이 실제로 발전해야 한다.`,
    `- 예: 국어 쓰기 활동 = matching(그림-낱말 인식) → choice-grid(첫소리 식별) → writing-practice(격자 따라 쓰기) → open-response(자기 낱말 확장).`,
    `  예: 수학 개념 활동 = image-observation(수 모형 관찰) → example-panel(원리 설명) → calculation-practice(안내 연습) → open-response(스스로 설명).`,
    ``,
    `콘텐츠 완전성 (Content Completeness):`,
    `- 각 블록의 instruction 은 반드시 학생이 무엇을 해야 하는지 구체적으로 서술 (10자 이상). "정리하세요" 같은 단독 지시 금지.`,
    `- open-response 블록만 반복해 페이지를 채우지 마라 — 학생이 실제 수행 없이 빈 박스만 마주하게 된다.`,
    ``,
    `visualSlot.needed 판정 규칙 (엄격) — 이미지가 활동의 학생 행동에 실제로 필요할 때만 true:`,
    `- **반드시 true**: image-observation, choice-grid (그림 중 선택하는 경우), matching-board (그림-낱말 연결), sequence-steps (그림 순서), visual-canvas.`,
    `- **선택적**: compare-panel (두 그림 비교인 경우), example-panel (수 모형·도해가 개념 이해에 필수인 경우), concept-panel.`,
    `- **반드시 false**: writing-practice (격자 쓰기는 tracingText 로 충분), calculation-practice (수식 자체가 콘텐츠), open-response (자유 응답), reflection-strip, instruction-strip.`,
    `- choice-grid 지만 선택지가 낱말/수식이면 needed=false. 선택지가 그림이면 needed=true.`,
    `- 판단 기준: "이미지가 없으면 학생이 이 활동을 수행할 수 없는가?" → 예이면 true, 아니면 false. 장식용 이미지는 절대 요청 금지.`,
    `- visualSlot.needed=true 로 지정한 블록은 이미지 생성 실패 시 문서가 완전히 리젝트된다. 이미지가 꼭 필요하지 않으면 false 로 두는 것이 안전.`,
    ``,
    `응답은 반드시 순수 JSON. 마크다운·설명 금지.`,
  ].join('\n');
}

export function compositionUserPrompt(
  context: GenerationContext,
  contentPlan: ContentPlan,
  worksheetPlan: WorksheetPlan,
): string {
  return [
    `아래 세 입력을 바탕으로 PageCompositionPlan(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `<ContentPlan>`,
    JSON.stringify(contentPlan, null, 2),
    `</ContentPlan>`,
    ``,
    `<WorksheetPlan>`,
    JSON.stringify(worksheetPlan, null, 2),
    `</WorksheetPlan>`,
    ``,
    compositionSchemaSpec(),
    ``,
    primitiveGuideline(),
    ``,
    layoutHeuristics(),
    ``,
    `순수 JSON 만. 마크다운·설명 금지.`,
  ].join('\n');
}

function compositionSchemaSpec(): string {
  return [
    `스키마:`,
    `{`,
    `  "version": "v1",`,
    `  "documentStrategy": {`,
    `    "learningFlow": "이 자료의 학습 흐름 요약",`,
    `    "visualHierarchy": "제목/이미지/답안 순 시선 흐름 서술",`,
    `    "density": "low" | "medium" | "high",`,
    `    "pageTarget": 1~4,`,
    `    "designDirection": "구성 방향 (색상 팔레트가 아니라 배치·밀도 방향)",`,
    `    "designRationale": "왜 이 조합이 이 학습 목표·행동에 맞는지 근거"`,
    `  },`,
    `  "pages": [`,
    `    {`,
    `      "pageId": "page_01",`,
    `      "pageNumber": 1,`,
    `      "purpose": "이 페이지가 담당할 학습 목적",`,
    `      "layout": "single" | "split" | "grid" | "sequence" | "canvas",`,
    `      "columns": 1~3,`,
    `      "blocks": [`,
    `        {`,
    `          "blockId": "블록 고유 id (WorksheetBlock.blockId 와 매칭)",`,
    `          "sourceItemIds": ["ContentPlan.itemBlueprints[].itemId 목록"],`,
    `          "primitive": "13종 중 하나",`,
    `          "instruction": "학생에게 보일 지시문 (짧고 명확)",`,
    `          "placement": { "column": 1, "widthFraction": 1.0, "order": 1, "columnSpan": 1 },`,
    `          "estimatedHeightMm": 60~180,`,
    `          "visualSlot": {`,
    `            "needed": true | false,`,
    `            "role": "observation" | "choice" | "illustration" | "reference" | "process",`,
    `            "placement": "inline" | "side" | "background" | "choice-grid" | "top" | "bottom",`,
    `            "widthFraction": 0.15~1.0,`,
    `            "count": 1~6,`,
    `            "hint": "이미지가 담을 시각 소재 (정답 단어·기호 노출 금지)"`,
    `          },`,
    `          "responseSpace": {`,
    `            "type": "none" | "line" | "box" | "grid" | "manuscript" | "drawing",`,
    `            "size": "small" | "medium" | "large",`,
    `            "cells": (grid/manuscript 일 때 셀 수),`,
    `            "lines": (line 일 때 줄 수)`,
    `          },`,
    `          "teacherOverlay": {`,
    `            "answerNote": "교사용 오버레이 정답·힌트 (선택)",`,
    `            "guidanceNote": "지도 유의점 (선택)"`,
    `          }`,
    `        }`,
    `      ]`,
    `    }`,
    `  ]`,
    `}`,
  ].join('\n');
}

function primitiveGuideline(): string {
  return [
    `Layout Primitive 13종 — 학생 행동과 정보 배치 관점에서 서로 다르다:`,
    ``,
    `- instruction-strip : 페이지 상단 짧은 지시 밴드. 학생이 읽고 다음 활동으로 넘어감. 이미지는 top 또는 없음.`,
    `- concept-panel    : 개념 요약 카드 (제목 + 짧은 설명 + 시각 참고). 학생은 읽고 이해.`,
    `- example-panel    : 워크드 예시 (문제 + 단계별 풀이 + 유사 문제). 학생은 예시를 관찰 후 유사 문제를 풂.`,
    `- matching-board   : 좌우 컬럼 항목을 선으로 연결. 학생은 좌우를 비교하고 관계를 판단.`,
    `- choice-grid      : 여러 선택지 (그림 또는 텍스트) 그리드. 학생은 하나를 표시.`,
    `- image-observation: 큰 이미지 하나 + 관찰 유도 질문 여러 개. 학생은 이미지를 관찰하고 답을 서술.`,
    `- compare-panel    : 두 대상을 좌우 나란히 놓고 비교. 학생은 공통점·차이점을 파악.`,
    `- sequence-steps   : 항목을 왼→오 (또는 상→하) 순서로 배열. 학생은 올바른 순서를 판단.`,
    `- writing-practice : 격자·원고지·라인 위 쓰기 반복. 학생은 손으로 씀.`,
    `- calculation-practice: 세로 계산식 + 답 칸. 학생은 계산 후 값을 씀.`,
    `- open-response    : 자유 응답 (박스·라인). 학생은 문장·그림으로 자기 표현.`,
    `- reflection-strip : 페이지 하단 자기 점검 스트립 (체크 항목). 학생은 이해도를 스스로 표시.`,
    `- visual-canvas    : 전체 폭 큰 그림 캔버스. 학생은 그림 안 요소를 찾거나 그림에 표시.`,
    ``,
    `사용 규칙:`,
    `- WorksheetBlock.activityType 을 그대로 primitive 로 매핑하지 마라. 학생 행동과 시각 역할을 우선 판단.`,
    `- 한 페이지 안에 서로 다른 primitive 를 조합하는 것이 기본. 같은 primitive 반복은 학습 흐름상 명확한 이유가 있을 때만.`,
    `- 페이지에 정보성 primitive (instruction-strip / concept-panel) 는 상단, 수행 primitive 는 본문, reflection-strip 은 하단.`,
  ].join('\n');
}

function layoutHeuristics(): string {
  return [
    `Layout 선택 힌트:`,
    `- 단일 큰 이미지 + 여러 질문 → image-observation, layout=single`,
    `- 그림 여러 개 중 하나 고르기 → choice-grid, layout=grid, columns=2~3`,
    `- 좌우 두 대상 관계 판단 → matching-board 또는 compare-panel, layout=split, columns=2`,
    `- 예시 풀이 + 유사 문제 → example-panel, layout=single or split`,
    `- 순서 나열 → sequence-steps, layout=sequence, columns=1`,
    `- 세로 계산 반복 → calculation-practice, layout=grid, columns=2~3`,
    `- 격자 쓰기 반복 → writing-practice, layout=grid, columns=2 (예시 카드 + 학생 쓰기)`,
    `- 자유 그림/서술 → open-response 또는 visual-canvas, layout=canvas`,
    ``,
    `sourceItemIds 커버리지:`,
    `- ContentPlan.itemBlueprints[].itemId 는 어떤 블록의 sourceItemIds 에 반드시 하나 이상 등장해야 한다.`,
    `- 여러 blueprint 를 하나의 블록으로 묶어도 좋다 (matching / classification / sequence 등).`,
    ``,
    `estimatedHeightMm 힌트:`,
    `- instruction-strip: 20~35mm`,
    `- concept-panel:    50~90mm`,
    `- example-panel:    70~130mm`,
    `- matching-board:   90~150mm`,
    `- choice-grid:      70~120mm (선택지 4개 기준)`,
    `- image-observation:110~180mm`,
    `- compare-panel:    90~140mm`,
    `- sequence-steps:   60~110mm`,
    `- writing-practice: 60~100mm`,
    `- calculation-practice: 50~90mm`,
    `- open-response:    60~120mm`,
    `- reflection-strip: 20~35mm`,
    `- visual-canvas:    120~200mm`,
    ``,
    `A4 세로 사용 가능 높이 ≈ 250mm (여백 제외). 페이지 합 estimatedHeightMm 이 이를 크게 넘으면 pageTarget 을 늘리거나 밀도 조정.`,
  ].join('\n');
}

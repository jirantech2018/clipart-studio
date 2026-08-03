// generation-v2 (Conversation UI) 전용 상수.
// Reuse First 원칙에 따라 기존 /generate 페이지가 이미 정의한 상수
// (types/domain.ts 의 BATCH_SIZE_PRESETS, MIN_BATCH_SIZE, MAX_BATCH_SIZE,
// REFERENCE_IMAGE_SLOT_LIMIT 등) 는 그대로 재사용한다.
// 여기에는 Conversation UI 에서만 필요한 신규 상수만 남긴다.

/** 최근 사용 Prompt Dropdown 노출 최대 개수. */
export const RECENT_PROMPT_MAX = 5;

// generation-v2 (Conversation UI) 전역 상수. 신규 페이지 전용이라 기존
// /generate 페이지 상수와 격리해 관리한다.

/**
 * 사용자가 한 Block 에서 개인 참조 이미지로 선택 가능한 최대 수.
 */
export const PERSONAL_REFERENCE_MAX_SELECTION = 5;

/**
 * 사용자가 한 Block 에서 조직(학교) 참조 이미지로 선택 가능한 최대 수.
 */
export const ORG_REFERENCE_MAX_SELECTION = 5;

/**
 * 실제 이미지 생성 API 에 함께 전달할 수 있는 참조 이미지 총합 상한.
 * 개인 + 조직 합계가 이 값을 넘으면 사용자에게 조정 요청 (임의 누락 금지).
 */
export const API_REFERENCE_TOTAL_MAX = 5;

/** batch 크기 프리셋 (버튼 노출). */
export const CONVERSATION_BATCH_PRESETS = [1, 5, 10] as const;

/** batch 최소·최대. */
export const CONVERSATION_MIN_BATCH = 1;
export const CONVERSATION_MAX_BATCH = 50;

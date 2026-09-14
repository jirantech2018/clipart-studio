// DEPRECATED — Stage 3 방향 정정 (2026-09-14).
//
// 이 모듈은 라이브러리를 이미지 선택의 입력원으로 사용하던 흐름 (findClipartByHint) 을
// 제공했으나, 사용자 지침에 따라 그 방식은 폐기되었다.
//
// 새 정책:
//   - 라이브러리는 이미지 선택의 입력원이 아니라, 이번 학습자료에 맞춰 새로 생성한 최종
//     클립아트를 저장·축적하는 곳이다.
//   - 클립아트는 매 요청마다 VisualPlan 을 기반으로 신규 생성된다
//     (@/services/learning-clipart-gen 참조).
//   - 학습자료 사용 이력은 learning_document_clipart_usage 에 기록된다.
//
// 이 파일은 원칙 "Legacy 삭제 금지" 하에 빈 export 형태로 남긴다 — 어떤 코드에서도
// 참조하지 않아야 한다.

export {};

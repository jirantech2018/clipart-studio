// Job dispatcher — kind 별 handler 라우팅.
//
// Phase 1 M1: 최소 확장. 기존 image-gen job (kind='single'|'package') 은 이 dispatcher
// 를 거치지 않고 기존 라우트가 그대로 처리한다 (회귀 방지, 사용자 지시).
// 여기서는 kind='learning_doc' job 만 라우팅한다.
//
// M2 이후 SSE·상태 폴링 등이 필요해지면 image handler 도 여기로 흡수 검토.

import { runLearningDocJob, type LearningDocJobInput, type LearningDocJobResult } from './handlers/learning-doc';

export type JobKind = 'single' | 'package' | 'learning_doc';

/**
 * kind='learning_doc' job 실행. 내부에서 orchestrator 를 호출하고 결과를
 * learning_documents 에 저장한다. 실패 시 예외를 던지며, 크레딧 환불은
 * 호출자(API route) 가 책임진다.
 */
export function dispatchLearningDoc(input: LearningDocJobInput): Promise<LearningDocJobResult> {
  return runLearningDocJob(input);
}

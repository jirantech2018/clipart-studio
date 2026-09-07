// kind='learning_doc' job handler.
//
// 흐름:
//   1) orchestrator 호출 → LearningDocument JSON 생성
//   2) learning_documents INSERT (service role)
//   3) generation_jobs.learning_document_id 업데이트 + status='done'
//   4) LearningDocument + documentId 반환
//
// 실패 시 예외를 던진다. 크레딧 환불·job 정리는 호출자(API route) 책임.

import {
  generateLearningDocument,
  type GenerateResult,
} from '@/services/learning-orchestrator';
import type { OrchestratorInput } from '@/services/learning-orchestrator/prompts';
import type { LearningDocument } from '@/services/learning-renderer/schema';
import { createSupabaseServiceClient } from '@/services/supabase/server';

export interface LearningDocJobInput extends OrchestratorInput {
  jobId: string;
  userId: string;
  organizationId: string;
}

export interface LearningDocJobResult {
  documentId: string;
  document: LearningDocument;
  usage?: GenerateResult['rawUsage'];
}

export async function runLearningDocJob(
  input: LearningDocJobInput,
): Promise<LearningDocJobResult> {
  const service = createSupabaseServiceClient();

  // 1) job 상태 running 으로 전환.
  await service
    .from('generation_jobs')
    .update({ status: 'running' })
    .eq('id', input.jobId);

  // 2) AI 호출.
  const result = await generateLearningDocument(input);
  const doc = result.document;

  // 3) learning_documents INSERT (service role 로 RLS 우회, user_id/organization_id
  //    는 이미 API route 에서 인증됨).
  const { data: docRow, error: docErr } = await service
    .from('learning_documents')
    .insert({
      user_id: input.userId,
      organization_id: input.organizationId,
      title: doc.meta.title,
      grade: input.grade,
      subject_code: input.subject,
      material_type_code: input.materialType,
      topic: input.topic,
      difficulty: input.difficulty,
      question_count: input.questionCount,
      document_json: doc,
    })
    .select('id')
    .single();

  if (docErr || !docRow) {
    throw new Error(`learning_documents insert 실패: ${docErr?.message ?? 'unknown'}`);
  }

  const documentId = (docRow as { id: string }).id;

  // 4) job 완료 표시 + FK 링크.
  await service
    .from('generation_jobs')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      learning_document_id: documentId,
    })
    .eq('id', input.jobId);

  return {
    documentId,
    document: doc,
    usage: result.rawUsage,
  };
}

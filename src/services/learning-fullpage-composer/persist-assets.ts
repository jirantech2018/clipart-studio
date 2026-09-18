// Stage 4.3 산출물 R2 업로드 · learning_documents 저장.
//
// 저장 대상:
//   - 학생용 PDF
//   - 학생용 페이지 PNG (선택)
//   - 교사용 PDF (있으면)
//   - 교사용 페이지 PNG (있으면)
//   - 콘텐츠 검증 보고서 JSON

import { putObject, publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

export interface PersistFullPageAssetsInput {
  documentId: string;
  organizationId: string;
  studentPdf: Buffer;
  teacherPdf?: Buffer;
  studentPagePngs: Buffer[];
  teacherPagePngs?: Buffer[];
  verificationReport: unknown;
  pipelineVersion: string;
  model: string;
}

export interface PersistFullPageAssetsResult {
  studentPdfKey: string;
  studentPdfUrl: string;
  teacherPdfKey?: string;
  teacherPdfUrl?: string;
  studentPageKeys: string[];
  teacherPageKeys?: string[];
  verificationReportKey: string;
}

function keyFor(documentId: string, name: string): string {
  return `learning-documents/${documentId}/${name}`;
}

export async function persistFullPageAssets(input: PersistFullPageAssetsInput): Promise<PersistFullPageAssetsResult> {
  const studentPdfKey = keyFor(input.documentId, 'student.pdf');
  await putObject({ key: studentPdfKey, body: input.studentPdf, contentType: 'application/pdf' });

  let teacherPdfKey: string | undefined;
  if (input.teacherPdf) {
    teacherPdfKey = keyFor(input.documentId, 'teacher.pdf');
    await putObject({ key: teacherPdfKey, body: input.teacherPdf, contentType: 'application/pdf' });
  }

  const studentPageKeys: string[] = [];
  for (let i = 0; i < input.studentPagePngs.length; i += 1) {
    const key = keyFor(input.documentId, `student-p${i + 1}.png`);
    await putObject({ key, body: input.studentPagePngs[i]!, contentType: 'image/png' });
    studentPageKeys.push(key);
  }

  let teacherPageKeys: string[] | undefined;
  if (input.teacherPagePngs && input.teacherPagePngs.length > 0) {
    teacherPageKeys = [];
    for (let i = 0; i < input.teacherPagePngs.length; i += 1) {
      const key = keyFor(input.documentId, `teacher-p${i + 1}.png`);
      await putObject({ key, body: input.teacherPagePngs[i]!, contentType: 'image/png' });
      teacherPageKeys.push(key);
    }
  }

  const verificationReportKey = keyFor(input.documentId, 'verification.json');
  const reportBuf = Buffer.from(JSON.stringify(input.verificationReport, null, 2), 'utf-8');
  await putObject({ key: verificationReportKey, body: reportBuf, contentType: 'application/json' });

  // learning_documents.metadata 갱신 (별도 컬럼이 있으면 그쪽으로).
  const service = createSupabaseServiceClient();
  const aiMetadata = {
    renderMode: 'ai_designed',
    pipelineVersion: input.pipelineVersion,
    model: input.model,
    pageCount: input.studentPagePngs.length,
    studentPdfKey,
    teacherPdfKey: teacherPdfKey ?? null,
    studentPageKeys,
    teacherPageKeys: teacherPageKeys ?? null,
    verificationReportKey,
    generatedAt: new Date().toISOString(),
  };
  // 이 프로젝트의 learning_documents 는 document_json 을 사용하므로 metadata 를 별도
  // 컬럼 (ai_designed_metadata JSONB) 로 저장. migration 필요.
  await service
    .from('learning_documents')
    .update({ ai_designed_metadata: aiMetadata })
    .eq('id', input.documentId);
  void input.organizationId;

  return {
    studentPdfKey,
    studentPdfUrl: publicUrl(studentPdfKey),
    teacherPdfKey,
    teacherPdfUrl: teacherPdfKey ? publicUrl(teacherPdfKey) : undefined,
    studentPageKeys,
    teacherPageKeys,
    verificationReportKey,
  };
}

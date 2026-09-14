// Stage 3 controlled admin execution — production API route 와 동일한 순서로 실행.
//
// Route 대비 유일한 차이: HTTP layer + Supabase Auth 세션 검증만 생략. 그 외 모든 것 (조직
// 확인 · job insert · useOrgTokens · dispatchLearningDoc · 실패 시 refundOrgTokens + job
// status 업데이트) 은 route 코드와 같은 순서·같은 함수를 호출한다.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dispatchLearningDoc } from '../src/services/jobs/dispatcher';
import { LearningPipelineError } from '../src/services/jobs/handlers/learning-doc';
import {
  refundOrgTokens,
  useOrgTokens,
} from '../src/services/credit';
import { renderPdf } from '../src/services/learning-renderer/pdf';
import { renderDocx } from '../src/services/learning-renderer/docx';
import { renderPptx } from '../src/services/learning-renderer/pptx';
import { createSupabaseServiceClient } from '../src/services/supabase/server';

const OUT_DIR = path.resolve(process.cwd(), 'tmp', 'stage3-visualplan');
const LEARNING_DOC_CREDITS = 3;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const userId = '6743b98b-9f19-46cc-bdf0-d43d03ae78c6';
  const orgSlug = 'personal-6743b98b9f1946ccbdf0d43d03ae78c6';

  const service = createSupabaseServiceClient();

  // 조직 확인 (route 로직 그대로).
  const { data: orgRow } = await service
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) {
    console.error('조직 없음:', orgSlug);
    process.exit(2);
  }
  const organizationId = (orgRow as { id: string }).id;
  console.log(`[stage3] org=${organizationId} slug=${orgSlug}`);

  // 활성 학습자료 job 정리.
  await service
    .from('generation_jobs')
    .update({ status: 'failed', error: 'stage3-controlled cleanup' })
    .eq('user_id', userId)
    .eq('kind', 'learning_doc')
    .in('status', ['queued', 'running']);

  // Job insert (route 와 같은 placeholder).
  const promptSummary = `1학년 국어 · 객관식 · 한글의 자음과 모음 · 자음의 소리와 모양`;
  const { data: job, error: jobError } = await service
    .from('generation_jobs')
    .insert({
      user_id: userId,
      prompt: promptSummary,
      batch_size: 1,
      diversity_level: 0,
      reference_image_id: null,
      school_profile_applied: false,
      reserved_credits: LEARNING_DOC_CREDITS,
      status: 'queued',
      org_id: organizationId,
      kind: 'learning_doc',
    })
    .select('id')
    .single();
  if (jobError || !job) {
    console.error('job insert 실패:', jobError);
    process.exit(3);
  }
  const jobId = (job as { id: string }).id;
  console.log(`[stage3] job=${jobId} status=queued`);

  // 크레딧 차감 (route 와 같은 함수).
  let poolBalanceBefore = 0;
  try {
    const use = await useOrgTokens({
      organizationId,
      amount: LEARNING_DOC_CREDITS,
      jobId,
      actorUserId: userId,
    });
    poolBalanceBefore = use.balance + LEARNING_DOC_CREDITS;
    console.log(
      `[stage3] credits: used=${LEARNING_DOC_CREDITS} balance_after_use=${use.balance}`,
    );
  } catch (err) {
    await service.from('generation_jobs').delete().eq('id', jobId);
    console.error('use_tokens 실패:', err);
    process.exit(4);
  }

  const started = Date.now();
  let result: Awaited<ReturnType<typeof dispatchLearningDoc>> | null = null;
  let pipelineErr: unknown = null;
  try {
    result = await dispatchLearningDoc({
      jobId,
      userId,
      organizationId,
      orgSlug,
      enableV2Override: true,
      grade: 1,
      subject: 'KOR',
      materialType: 'multiple_choice',
      unit: '한글의 자음과 모음',
      topic: '자음의 소리와 모양',
      questionCount: 5,
      difficulty: 'normal',
      additionalRequest: '학생이 그림 관찰과 자음자 인식을 연결해 판단하도록 구성한다.',
    });
    console.log(
      `[stage3] pipeline done in ${Date.now() - started}ms, documentId=${result.documentId}`,
    );
  } catch (err) {
    pipelineErr = err;
    console.error(`[stage3] pipeline threw after ${Date.now() - started}ms`);
    if (err instanceof LearningPipelineError) {
      console.error(`  code=${err.code} stage=${err.stage} msg=${err.message}`);
    } else {
      console.error(err);
    }
  }

  // route 실패 처리 (status=failed + refund).
  if (pipelineErr) {
    await service
      .from('generation_jobs')
      .update({
        status: 'failed',
        error:
          pipelineErr instanceof Error
            ? pipelineErr.message.slice(0, 500)
            : String(pipelineErr).slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    try {
      const refund = await refundOrgTokens({
        organizationId,
        amount: LEARNING_DOC_CREDITS,
        jobId,
        reason: 'learning-doc generation failed (stage3-controlled)',
      });
      console.log(
        `[stage3] refund: balance=${refund.balance} already_refunded=${refund.alreadyRefunded}`,
      );
    } catch (refundErr) {
      console.error('[stage3] refund 실패:', refundErr);
    }
    process.exit(5);
  }

  // 성공 경로 — HTTP 201 대신 화면·PDF·usage 확인.
  const documentId = result!.documentId;
  console.log(`\n[stage3] SUCCESS — documentId=${documentId}`);
  console.log(`  generationMode=${result!.generationMode}`);
  console.log(`  clipartInsertedCount=${result!.clipartInsertedCount}`);

  const { data: docRow } = await service
    .from('learning_documents')
    .select('title, document_json')
    .eq('id', documentId)
    .maybeSingle();
  const doc = (docRow as { title: string; document_json: unknown } | null);
  if (!doc) {
    console.error('learning_documents 조회 실패');
    process.exit(6);
  }
  const learningDoc = doc.document_json as import('../src/services/learning-renderer/schema').LearningDocument;
  const byKind: Record<string, number> = {};
  for (const s of learningDoc.sections) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  console.log(`  document_json sections=${JSON.stringify(byKind)}`);

  const { data: usageRows } = await service
    .from('learning_document_clipart_usage')
    .select('item_id, image_id, section_position, review_status, source')
    .eq('document_id', documentId)
    .order('section_position');
  console.log(`  usage rows: ${usageRows?.length ?? 0}`);
  if (usageRows) console.table(usageRows);

  // 크레딧 최종 상태 (정상 사용, refund 없음).
  const { data: poolNow } = await service
    .from('token_pools')
    .select('balance')
    .eq('organization_id', organizationId)
    .maybeSingle();
  console.log(
    `  pool_balance: before=${poolBalanceBefore} after=${(poolNow as { balance: number } | null)?.balance ?? 'N/A'}`,
  );

  // PDF / DOCX / PPTX 렌더링.
  const LOCAL_CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const chrome =
    process.env.PPTR_LOCAL_CHROME_PATH ??
    LOCAL_CHROME_CANDIDATES.find((p) => existsSync(p));

  const pdfBuf = await renderPdf(learningDoc, {
    useLocalChrome: Boolean(chrome),
    localChromePath: chrome,
    answerVariant: 'student',
  });
  await writeFile(path.join(OUT_DIR, 'jamo-student.pdf'), pdfBuf);
  const pdfLatin1 = pdfBuf.toString('latin1');
  const imageObjCount = (pdfLatin1.match(/\/Subtype\s*\/Image/g) ?? []).length;
  console.log(`  PDF ${pdfBuf.length} bytes, /Image objects=${imageObjCount}`);

  const docxBuf = await renderDocx(learningDoc, { answerVariant: 'student' });
  await writeFile(path.join(OUT_DIR, 'jamo-student.docx'), docxBuf);
  console.log(`  DOCX ${docxBuf.length} bytes`);

  const pptxBuf = await renderPptx(learningDoc, { answerVariant: 'student' });
  await writeFile(path.join(OUT_DIR, 'jamo-student.pptx'), pptxBuf);
  console.log(`  PPTX ${pptxBuf.length} bytes`);

  console.log('\n=== SUMMARY ===');
  console.log(`documentId: ${documentId}`);
  console.log(`clipartInsertedCount: ${result!.clipartInsertedCount}`);
  console.log(`output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

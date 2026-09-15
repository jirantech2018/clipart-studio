// Stage 3 프로덕션 HTTP 검증 스크립트.
//
// 흐름:
//   1) Supabase admin.generateLink → 관리자 magic-link hashed_token 획득.
//   2) POST /auth/v1/verify → access_token + refresh_token 획득.
//   3) 세션을 SSR 클라이언트가 기대하는 cookie 포맷으로 조립.
//   4) POST https://clipartstudio.schoolp.co.kr/api/learning/documents (실 프로덕션).
//   5) 응답 documentId 획득 → learning_document_json / usage / images 확인.
//   6) 크레딧 사용됐으면 adjust_tokens 로 +3 복구 (net-zero).
//
// 목적: 프로덕션 HTTP 경로가 실제로 신규 클립아트 삽입된 학습지를 생성하는지 검증.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROD_BASE = 'https://clipartstudio.schoolp.co.kr';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
const SUPABASE_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const COOKIE_NAME = `sb-${SUPABASE_REF}-auth-token`;

async function generateSession() {
  console.log('[stage3-prod] generating admin magic-link session...');
  const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL }),
  });
  if (!genRes.ok) throw new Error(`generateLink failed: ${genRes.status} ${await genRes.text()}`);
  const genJson = (await genRes.json()) as { action_link?: string };
  const actionLink = genJson.action_link;
  if (!actionLink) throw new Error('action_link missing');

  // Follow the action_link — Supabase 302s with tokens in URL fragment.
  const followRes = await fetch(actionLink, { redirect: 'manual' });
  const location = followRes.headers.get('location');
  if (!location) throw new Error(`no redirect location: ${followRes.status}`);
  const fragment = location.includes('#') ? location.split('#')[1]! : '';
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token') ?? '';
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  const expiresAt = Number(params.get('expires_at') ?? Math.floor(Date.now() / 1000) + expiresIn);
  if (!accessToken) throw new Error(`no access_token in redirect: ${location.slice(0, 200)}`);

  // Fetch user object.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const user = await userRes.json();

  console.log(`[stage3-prod] session acquired: user=${(user as { email?: string }).email}`);
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, expires_at: expiresAt, token_type: 'bearer', user };
}

function buildCookieHeader(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: Record<string, unknown>;
}): string {
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(payload)).toString('base64');
  // SSR 클라이언트는 chunked cookie (.0, .1, ...) 를 자동으로 이어붙인다.
  const CHUNK = 3000;
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK) {
    chunks.push(encoded.slice(i, i + CHUNK));
  }
  return chunks.map((c, i) => `${COOKIE_NAME}.${i}=${c}`).join('; ');
}

async function poolBalance(orgId: string): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/token_pools?organization_id=eq.${orgId}&select=balance`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = (await r.json()) as Array<{ balance: number }>;
  return rows[0]?.balance ?? 0;
}

async function refundThreeCredits(orgId: string, jobId: string): Promise<void> {
  const poolQ = await fetch(`${SUPABASE_URL}/rest/v1/token_pools?organization_id=eq.${orgId}&select=id`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [pool] = (await poolQ.json()) as Array<{ id: string }>;
  if (!pool) throw new Error('pool not found');
  const memo = `stage3 prod HTTP verification compensation (job: ${jobId})`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/adjust_tokens`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_pool: pool.id, p_delta: 3, p_memo: memo, p_actor: '6743b98b-9f19-46cc-bdf0-d43d03ae78c6' }),
  });
  console.log(`[stage3-prod] refund: HTTP ${r.status} → ${await r.text()}`);
}

async function main() {
  const orgId = 'b83a2b0f-162c-4dad-88b4-65343e299ab6';
  const orgSlug = 'personal-6743b98b9f1946ccbdf0d43d03ae78c6';

  const before = await poolBalance(orgId);
  console.log(`[stage3-prod] pool balance BEFORE: ${before}`);

  const session = await generateSession();
  const cookie = buildCookieHeader(session);

  console.log(`[stage3-prod] POST ${PROD_BASE}/api/learning/documents ...`);
  const started = Date.now();
  const res = await fetch(`${PROD_BASE}/api/learning/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      orgSlug,
      grade: 1,
      subject: 'KOR',
      materialType: 'multiple_choice',
      unit: '한글의 자음과 모음',
      topic: '자음의 소리 구별하기',
      questionCount: 5,
      difficulty: 'normal',
      clipartMode: 'auto',
    }),
  });
  const durationMs = Date.now() - started;
  console.log(`[stage3-prod] HTTP ${res.status} in ${durationMs}ms`);

  const bodyText = await res.text();
  let body: {
    data?: { jobId: string; documentId: string; clipartInsertedCount?: number; creditsUsed?: number };
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  try {
    body = JSON.parse(bodyText);
  } catch {
    console.error('[stage3-prod] non-JSON response:', bodyText.slice(0, 500));
    process.exit(2);
  }

  if (!res.ok || !body.data) {
    console.error(`[stage3-prod] FAIL: ${res.status}`, JSON.stringify(body, null, 2));
    process.exit(3);
  }

  const { jobId, documentId, clipartInsertedCount = 0, creditsUsed = 0 } = body.data;
  console.log(`[stage3-prod] SUCCESS`);
  console.log(`  jobId: ${jobId}`);
  console.log(`  documentId: ${documentId}`);
  console.log(`  clipartInsertedCount: ${clipartInsertedCount}`);
  console.log(`  creditsUsed (server-reported): ${creditsUsed}`);

  const after = await poolBalance(orgId);
  console.log(`[stage3-prod] pool balance AFTER: ${after} (delta=${after - before})`);

  if (before - after >= 3) {
    console.log(`[stage3-prod] refunding 3 credits (net-zero for verification)...`);
    await refundThreeCredits(orgId, jobId);
    const afterRefund = await poolBalance(orgId);
    console.log(`[stage3-prod] pool balance AFTER refund: ${afterRefund}`);
  } else {
    console.log(`[stage3-prod] no refund needed (bypass may have activated or job didn't charge)`);
  }

  // Verify document content + usage
  const docQ = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_documents?id=eq.${documentId}&select=title,document_json`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const [doc] = (await docQ.json()) as Array<{ title: string; document_json: { sections: unknown[] } }>;
  if (!doc) {
    console.error('[stage3-prod] document not found after success');
    process.exit(4);
  }
  const byKind: Record<string, number> = {};
  for (const s of doc.document_json.sections as Array<{ kind: string }>) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }
  console.log(`  document title: ${doc.title}`);
  console.log(`  sections: ${JSON.stringify(byKind)}`);

  const usageQ = await fetch(
    `${SUPABASE_URL}/rest/v1/learning_document_clipart_usage?document_id=eq.${documentId}&select=item_id,image_id,visual_plan_snapshot,review_status&order=section_position`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const usage = (await usageQ.json()) as Array<{
    item_id: string;
    image_id: string;
    visual_plan_snapshot: { subjectMatter: string };
    review_status: string;
  }>;
  console.log(`  usage rows: ${usage.length}`);
  for (const u of usage) {
    console.log(
      `    ${u.item_id} img=${u.image_id.slice(0, 8)} status=${u.review_status} subject=${u.visual_plan_snapshot?.subjectMatter}`,
    );
  }

  // Save the response body for the report
  await writeFile(
    path.resolve(process.cwd(), 'tmp', 'stage3-visualplan', 'prod-response.json'),
    JSON.stringify({ status: res.status, body: body.data, usage }, null, 2),
  );
  console.log('\n=== PROD VERIFICATION COMPLETE ===');
  console.log(`documentId: ${documentId}`);
  console.log(`http_status: ${res.status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

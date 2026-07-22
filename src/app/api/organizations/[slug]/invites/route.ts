// Organization invites.
//
// GET  /api/organizations/[slug]/invites  — pending 초대 목록 (admin+)
// POST /api/organizations/[slug]/invites  — 초대 생성 (admin+). 링크 URL 반환.
//
// 이메일 발송은 v1.0 스코프 밖 — 관리자가 링크를 복사해서 직접 공유.
// 같은 (조직, 이메일) 조합에 pending 이 있으면 UPSERT (기존 토큰 갱신).

import crypto from 'node:crypto';
import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { inviteMemberSchema } from '@/types/schemas';

import type { OrganizationInvite, OrganizationRole } from '@/types/domain';

const INVITE_TTL_DAYS = 7;

function siteBaseUrl(request: Request): string {
  // 우선순위:
  //   1) NEXT_PUBLIC_SITE_URL 환경변수 (프로덕션에 명시 설정하면 가장 확실)
  //   2) x-forwarded-host + x-forwarded-proto (Railway/Vercel 등 프록시 뒤)
  //   3) request.url 의 origin (fallback — 로컬 개발)
  //
  // Railway 컨테이너 내부에서 request.url 은 `http://localhost:8080/...` 로
  // 잡히므로 headers 를 반드시 참조해야 실제 외부 URL 을 얻을 수 있다.
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, '');

  const headers = request.headers;
  const forwardedHost = headers.get('x-forwarded-host') ?? headers.get('host');
  const forwardedProto = headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedHost && !forwardedHost.startsWith('localhost')) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function buildInviteUrl(base: string, token: string): string {
  return `${base}/invites/${token}`;
}

async function loadContext(slug: string, requesterId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { org: null, requesterRole: null as OrganizationRole | null };
  const orgRow = org as { id: string; name: string };

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgRow.id)
    .eq('user_id', requesterId)
    .eq('status', 'active')
    .maybeSingle();

  return {
    org: orgRow,
    requesterRole: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { org, requesterRole } = await loadContext(params.slug, user.id);
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (requesterRole !== 'owner' && requesterRole !== 'admin') {
    return apiError('FORBIDDEN', '조직 관리자만 초대 목록을 볼 수 있어요');
  }

  const { data: rows, error } = await supabase
    .from('organization_invites')
    .select('id, organization_id, email, role, invited_by, token, expires_at, created_at')
    .eq('organization_id', org.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[invites GET] query error', error);
    return apiError('INTERNAL_ERROR', '초대 목록 조회 실패');
  }

  const base = siteBaseUrl(request);
  const invites: OrganizationInvite[] = (rows ?? []).map((r) => {
    const row = r as {
      id: string;
      organization_id: string;
      email: string;
      role: OrganizationRole;
      invited_by: string;
      token: string;
      expires_at: string;
      created_at: string;
    };
    return {
      id: row.id,
      organizationId: row.organization_id,
      email: row.email,
      role: row.role,
      invitedBy: row.invited_by,
      token: row.token,
      inviteUrl: buildInviteUrl(base, row.token),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  });

  return apiOk({ invites });
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { org, requesterRole } = await loadContext(params.slug, user.id);
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  // 초대는 조직 소속 active 멤버라면 누구나 가능 (역할 변경·강퇴 등 관리 액션은
  // 여전히 admin+ 로 제한). "우리 조직에 합류할 사람을 부를" 권리는 팀 협업의
  // 자연스러운 부분이라고 판단.
  if (!requesterRole) {
    return apiError('FORBIDDEN', '조직 멤버만 초대할 수 있어요');
  }

  let body;
  try {
    body = inviteMemberSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  if (body.role === 'owner') {
    return apiError('FORBIDDEN', '소유자 초대는 지원하지 않아요 (소유권 이전 별도)');
  }
  // 권한 상향 방지: editor/viewer 는 자신보다 높은 역할(admin) 로 초대할 수 없다.
  // 그렇지 않으면 viewer 가 admin 을 부르는 방식으로 우회 승격이 가능해진다.
  if (body.role === 'admin' && requesterRole !== 'owner' && requesterRole !== 'admin') {
    return apiError('FORBIDDEN', '관리자 초대는 조직 관리자만 할 수 있어요');
  }

  // 이미 조직 멤버인지 검증 (service role — profiles 조회 후 members 확인)
  const service = createSupabaseServiceClient();
  const { data: existing } = await service
    .from('profiles')
    .select('id')
    .eq('email', body.email)
    .maybeSingle();

  if (existing) {
    const { data: alreadyMember } = await service
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id)
      .eq('user_id', (existing as { id: string }).id)
      .maybeSingle();
    if (alreadyMember) {
      return apiError('CONFLICT', '이 이메일은 이미 조직 멤버입니다');
    }
  }

  // 기존 pending 초대 확인 (UPSERT 패턴: 있으면 토큰 갱신)
  const { data: pending } = await supabase
    .from('organization_invites')
    .select('id')
    .eq('organization_id', org.id)
    .eq('email', body.email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let inviteRow;
  if (pending) {
    const pendingId = (pending as { id: string }).id;
    const { data: updated, error: updateError } = await supabase
      .from('organization_invites')
      .update({
        role: body.role,
        token,
        expires_at: expiresAt,
        invited_by: user.id,
      })
      .eq('id', pendingId)
      .select('id, organization_id, email, role, invited_by, token, expires_at, created_at')
      .single();
    if (updateError || !updated) {
      console.error('[invites POST] update error', updateError);
      return apiError('INTERNAL_ERROR', '초대 재발송 실패');
    }
    inviteRow = updated;
  } else {
    const { data: created, error: insertError } = await supabase
      .from('organization_invites')
      .insert({
        organization_id: org.id,
        email: body.email,
        role: body.role,
        invited_by: user.id,
        token,
        expires_at: expiresAt,
      })
      .select('id, organization_id, email, role, invited_by, token, expires_at, created_at')
      .single();
    if (insertError || !created) {
      console.error('[invites POST] insert error', insertError);
      return apiError('INTERNAL_ERROR', '초대 생성 실패');
    }
    inviteRow = created;
  }

  const row = inviteRow as {
    id: string;
    organization_id: string;
    email: string;
    role: OrganizationRole;
    invited_by: string;
    token: string;
    expires_at: string;
    created_at: string;
  };
  const base = siteBaseUrl(request);
  const invite: OrganizationInvite = {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    token: row.token,
    inviteUrl: buildInviteUrl(base, row.token),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };

  // 활동 로그
  await service.from('organization_activity_logs').insert({
    organization_id: org.id,
    actor_user_id: user.id,
    activity_type: 'member_invited',
    target_invite_id: invite.id,
    metadata: { email: body.email, role: body.role, reissued: !!pending },
  });

  return apiOk({ invite }, 201);
}

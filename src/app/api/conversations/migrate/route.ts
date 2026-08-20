// Conversation Server Storage — Legacy localStorage → Supabase 1회 이관
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §6
//
// 클라이언트가 localStorage 의 clipart-conversation-v2 payload 를 그대로 전달.
// 서버는 각 conversation/message 를 `ON CONFLICT (id) DO NOTHING` 로 upsert.
// 같은 client id 로 여러 번 실행돼도 중복 삽입 없음 (idempotent).
//
// 원본 localStorage 는 서버가 지우지 않는다 (지시서 §6 안전장치).

export const runtime = 'nodejs';
export const maxDuration = 30;

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const legacyBlockSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().default(''),
  options: z.unknown().optional(),
  status: z.string().optional(),
  jobId: z.string().uuid().nullable().optional(),
  createdAt: z.string().optional(),
});

const legacyConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  organizationSlug: z.string().min(1).max(64).optional(),
  blocks: z.array(legacyBlockSchema).default([]),
});

const bodySchema = z.object({
  conversations: z.array(legacyConversationSchema).max(500),
});

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function mapLegacyStatus(s: string | undefined): 'draft' | 'submitted' | 'completed' | 'failed' {
  switch (s) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'queued':
    case 'generating':
      return 'submitted';
    default:
      return 'draft';
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const service = createSupabaseServiceClient();

  // slug → organization_id 매핑 캐시.
  const slugCache = new Map<string, string | null>();
  async function resolveOrgId(slug: string | undefined): Promise<string | null> {
    if (!slug) return null;
    if (slugCache.has(slug)) return slugCache.get(slug) ?? null;
    const { data } = await service
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();
    const id = data ? (data as { id: string }).id : null;
    slugCache.set(slug, id);
    return id;
  }

  // 유저 MY organization (slug 없거나 매칭 안 되는 conversation 의 fallback).
  const { data: myOrg } = await service
    .from('organizations')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .is('deleted_at', null)
    .maybeSingle();
  const myOrgId = myOrg ? (myOrg as { id: string }).id : null;
  if (!myOrgId) {
    return apiError('INTERNAL_ERROR', 'MY 워크스페이스가 아직 준비되지 않았어요');
  }

  let importedConversations = 0;
  let importedMessages = 0;

  for (const legacy of parsed.data.conversations) {
    if (!isUuid(legacy.id)) continue; // legacy uid() 가 UUID 가 아니면 스킵 (매우 오래된 저장분)

    const targetOrgId = (await resolveOrgId(legacy.organizationSlug)) ?? myOrgId;
    const createdAt = legacy.createdAt ?? new Date().toISOString();
    const updatedAt = legacy.updatedAt ?? createdAt;

    // Conversation upsert — id 충돌 시 무시. 소유권 이관 안 함 (다른 유저 소유일 수 있음).
    const { error: convErr } = await service
      .from('conversations')
      .insert({
        id: legacy.id,
        user_id: user.id,
        organization_id: targetOrgId,
        title: legacy.title ?? null,
        status: 'active',
        created_at: createdAt,
        updated_at: updatedAt,
        last_activity_at: updatedAt,
      })
      .select('id')
      .maybeSingle();

    // 23505 = 이미 있음. 그 외 실제 오류만 로그.
    if (convErr && convErr.code !== '23505') {
      console.warn('[migrate] conversation insert skipped', legacy.id, convErr.code, convErr.message);
      continue;
    }
    if (!convErr) importedConversations += 1;

    // Messages
    let orderIndex = 0;
    for (const block of legacy.blocks) {
      if (!isUuid(block.id)) continue;
      const jobId = block.jobId && isUuid(block.jobId) ? block.jobId : null;
      const { error: msgErr } = await service
        .from('conversation_messages')
        .insert({
          id: block.id,
          conversation_id: legacy.id,
          role: 'user',
          prompt: block.prompt ?? '',
          options: block.options ?? null,
          status: mapLegacyStatus(block.status),
          job_id: jobId,
          order_index: orderIndex,
          created_at: block.createdAt ?? createdAt,
          updated_at: block.createdAt ?? createdAt,
        });
      if (msgErr && msgErr.code !== '23505') {
        console.warn('[migrate] message insert skipped', block.id, msgErr.code, msgErr.message);
      } else if (!msgErr) {
        importedMessages += 1;
      }
      orderIndex += 1;
    }
  }

  return apiOk({
    importedConversations,
    importedMessages,
  });
}

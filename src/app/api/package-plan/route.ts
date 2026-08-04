// /api/package-plan
//
// 패키지 생성 모드의 AI 추천 (핵심 키워드 + 제작 구성) 을 반환한다.
// prompt-suggestions/route.ts 와 동일한 패턴 — gpt-4o-mini, json_object 응답,
// 실패 시 template fallback.
//
// 서버가 canonical category 화이트리스트로 정규화하고, 미리 정의된 목적별
// 템플릿을 base 로 AI 응답을 보정 · 병합한다. AI 가 임의의 카테고리/id 를
// 만들지 못하도록 sanitize 단계에서 필터링.

export const runtime = 'nodejs';
export const maxDuration = 15;

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

import {
  getTemplateForPurpose,
  templateKeyForPurpose,
} from '@/features/generation-v2/lib/packagePlanTemplates';
import {
  PACKAGE_ASPECT_RATIOS,
  PACKAGE_CATEGORIES,
  USAGE_CHANNELS,
  type PackageAiItem,
  type PackageAspectRatio,
  type PackageCategory,
  type PackagePlanResponse,
  type UsageChannel,
} from '@/features/generation-v2/lib/packagePlanTypes';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o-mini';

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

interface Body {
  purpose?: unknown;
  topicOrEvent?: unknown;
  target?: unknown;
  styleTone?: unknown;
  additionalRequest?: unknown;
  usageChannels?: unknown;
  userAddedKeywords?: unknown;
  userRemovedKeywords?: unknown;
}

function asUsageChannels(v: unknown): UsageChannel[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<string>(USAGE_CHANNELS as ReadonlyArray<string>);
  const seen = new Set<string>();
  const out: UsageChannel[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    if (!allowed.has(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item as UsageChannel);
  }
  return out;
}

function asString(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function asStringArray(v: unknown, max = 20, itemMax = 32): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, itemMax);
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function systemPrompt(): string {
  return [
    'You are a Korean planning assistant for a school-focused AI clipart service.',
    'Given the user context (purpose / topic / target / style / additional request /',
    'usage channels the artwork will be placed on / user-added keywords /',
    'user-removed keywords) plus a base template of items, return a package plan',
    'the user can use to produce a set of related clipart.',
    '',
    'Rules:',
    '- Korean only for name / description / keywords / promptHint',
    '- Category MUST be one of: ' + PACKAGE_CATEGORIES.join(', '),
    '- Do NOT invent new category names',
    '- Prefer to reuse or adapt the items already provided in the base template',
    '- Adapt the item list to the selected usage channels — for example, a',
    '  "SNS" channel implies a square social card, "학교 홈페이지" implies a',
    '  landscape banner, "포스터" implies a portrait poster, "리플렛" implies',
    '  panel-style illustrations, "현수막" implies wide banners. Add channel-',
    '  specific items when clearly needed and reflect the channel in name /',
    '  aspectRatio / defaultQuantity / promptHint',
    '- You may add up to 3 additional items when the channels or request',
    '  clearly need them',
    '- Keep item name short (<= 12 characters)',
    '- Keep description short (<= 24 characters)',
    '- promptHint: short Korean phrase (<= 60 characters) describing what the',
    '  actual clipart should look like — this feeds later prompt assembly',
    '- aspectRatio MUST be one of: ' + PACKAGE_ASPECT_RATIOS.join(', '),
    '- transparentBackground: true for icons / decorations / dividers that',
    '  overlay on top of other artwork; false for posters / banners /',
    '  illustrations that stand on their own',
    '- keywords: 4~6 short Korean noun phrases (2~10 chars each)',
    '- Never include duplicate keywords, or keywords the user explicitly removed',
    '- defaultQuantity: integer 1~30 per item',
    '- Return valid JSON with shape:',
    '  {',
    '    "keywords": ["...", ...],',
    '    "items": [',
    '      {',
    '        "id": "<slug>", "category": "<category>", "name": "...",',
    '        "description": "...", "defaultQuantity": <int>,',
    '        "aspectRatio": "square|landscape|portrait",',
    '        "transparentBackground": true|false,',
    '        "promptHint": "..."',
    '      }',
    '    ]',
    '  }',
    '- Item id should stay stable — reuse the ids from the base template when the item is kept',
  ].join('\n');
}

function userPrompt(input: {
  purpose: string;
  topicOrEvent: string;
  target: string;
  styleTone: string;
  additionalRequest: string;
  usageChannels: UsageChannel[];
  userAddedKeywords: string[];
  userRemovedKeywords: string[];
  baseTemplate: { keywords: string[]; items: PackageAiItem[] };
}): string {
  return JSON.stringify(
    {
      user: {
        purpose: input.purpose,
        topicOrEvent: input.topicOrEvent,
        target: input.target,
        styleTone: input.styleTone,
        additionalRequest: input.additionalRequest,
        usageChannels: input.usageChannels,
        userAddedKeywords: input.userAddedKeywords,
        userRemovedKeywords: input.userRemovedKeywords,
      },
      baseTemplate: input.baseTemplate,
    },
    null,
    2,
  );
}

function isPackageCategory(v: unknown): v is PackageCategory {
  return (
    typeof v === 'string' &&
    (PACKAGE_CATEGORIES as ReadonlyArray<string>).includes(v)
  );
}

function coerceAspectRatio(v: unknown): PackageAspectRatio {
  if (
    typeof v === 'string' &&
    (PACKAGE_ASPECT_RATIOS as ReadonlyArray<string>).includes(v)
  ) {
    return v as PackageAspectRatio;
  }
  return 'square';
}

function slugify(v: string): string {
  return (
    v
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

function sanitizeItems(raw: unknown): PackageAiItem[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const out: PackageAiItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const category = record.category;
    if (!isPackageCategory(category)) continue;
    const name = asString(record.name, 24);
    if (!name) continue;
    const description = asString(record.description, 60);
    const promptHint = asString(record.promptHint, 120);
    const aspectRatio = coerceAspectRatio(record.aspectRatio);
    const transparentBackground = record.transparentBackground === true;
    const qtyRaw = record.defaultQuantity;
    const defaultQuantity =
      typeof qtyRaw === 'number' && Number.isFinite(qtyRaw)
        ? Math.max(1, Math.min(30, Math.floor(qtyRaw)))
        : 1;
    let id =
      typeof record.id === 'string' && record.id.trim()
        ? slugify(record.id)
        : slugify(`${category}-${name}`);
    // 중복 id 는 뒤에 -2 등을 붙여 충돌 회피.
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${slugify(record.id ? String(record.id) : `${category}-${name}`)}-${suffix++}`;
    }
    seenIds.add(id);
    out.push({
      id,
      category,
      name,
      description,
      defaultQuantity,
      aspectRatio,
      transparentBackground,
      promptHint,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function sanitizeKeywords(
  raw: unknown,
  userRemoved: ReadonlyArray<string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  const removedSet = new Set(userRemoved);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 16) continue;
    if (removedSet.has(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 8) break;
  }
  return out;
}

function templateFallback(
  purpose: string,
  userRemoved: ReadonlyArray<string>,
  source: 'template' | 'fallback',
): PackagePlanResponse {
  const template = getTemplateForPurpose(purpose);
  const removedSet = new Set(userRemoved);
  return {
    keywords: template.keywords.filter((k) => !removedSet.has(k)),
    items: template.items.map((it) => ({ ...it })),
    source,
  };
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return apiError('VALIDATION_ERROR', 'JSON 형식이 아닙니다');
  }

  const purpose = asString(body.purpose);
  const target = asString(body.target);
  const styleTone = asString(body.styleTone);
  const topicOrEvent = asString(body.topicOrEvent);
  const additionalRequest = asString(body.additionalRequest, 500);
  const usageChannels = asUsageChannels(body.usageChannels);
  const userAddedKeywords = asStringArray(body.userAddedKeywords);
  const userRemovedKeywords = asStringArray(body.userRemovedKeywords);

  // 최소 조건: 목적/대상/스타일 중 하나라도 비어 있으면 AI 호출 없이 템플릿.
  if (!purpose || !target || !styleTone) {
    return apiOk(templateFallback(purpose, userRemovedKeywords, 'template'));
  }

  const template = getTemplateForPurpose(purpose);

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          {
            role: 'user',
            content: userPrompt({
              purpose,
              topicOrEvent,
              target,
              styleTone,
              additionalRequest,
              usageChannels,
              userAddedKeywords,
              userRemovedKeywords,
              baseTemplate: {
                keywords: template.keywords,
                items: [...template.items],
              },
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error('[package-plan] upstream', res.status);
      return apiOk(
        templateFallback(purpose, userRemovedKeywords, 'fallback'),
      );
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return apiOk(templateFallback(purpose, userRemovedKeywords, 'fallback'));
    }

    const keywords = sanitizeKeywords(
      (parsed as { keywords?: unknown })?.keywords,
      userRemovedKeywords,
    );
    const items = sanitizeItems((parsed as { items?: unknown })?.items);

    if (keywords.length === 0 || items.length === 0) {
      return apiOk(templateFallback(purpose, userRemovedKeywords, 'fallback'));
    }

    const templateKey = templateKeyForPurpose(purpose);
    console.info('[package-plan] ai ok', {
      purpose: templateKey,
      itemCount: items.length,
    });

    return apiOk<PackagePlanResponse>({ keywords, items, source: 'ai' });
  } catch (err) {
    console.error('[package-plan] error', err);
    return apiOk(templateFallback(purpose, userRemovedKeywords, 'fallback'));
  }
}

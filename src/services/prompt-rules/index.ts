// 관리자 정의 prompt_rules 를 로드하고 카테고리별로 조합한다.
//
// - loadActiveRules(): enabled = TRUE 인 rule 을 category + priority 순으로 반환.
// - composeRules({ rules, userSection, maxLength }): 최종 조합 텍스트와 실제 적용된
//   rule id 목록을 함께 돌려준다. Phase 1 에서는 tags 매칭이 없으므로 모든 활성 rule
//   을 대상으로 조합한다.
//
// 조합 순서 (사용자 사양):
//   [Global] → [Context: school/location/style] → [Task] → [User] → [Negative]
//
// 안전장치:
//   - 중복 rule id 는 한 번만 append 됨 (같은 rule 을 여러 카테고리로 태깅하는 실수 방지).
//   - maxLength 를 넘기면 낮은 priority 부터 잘라낸다 (버킷 뒤에서부터 pop).
//   - loadActiveRules 실패시 빈 배열 반환 → 파이프라인은 fallback 흐름을 그대로 유지.

import { createSupabaseServiceClient } from '@/services/supabase/server';

import type { PromptRule, PromptRuleCategory } from '@/types/domain';

interface RuleRow {
  id: string;
  name: string;
  category: PromptRuleCategory;
  tags: string[] | null;
  priority: number;
  enabled: boolean;
  content: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: RuleRow): PromptRule {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    tags: row.tags ?? [],
    priority: row.priority,
    enabled: row.enabled,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadActiveRules(): Promise<PromptRule[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from('prompt_rules')
      .select('id, name, category, tags, priority, enabled, content, created_at, updated_at')
      .eq('enabled', true)
      .order('category', { ascending: true })
      .order('priority', { ascending: true });

    if (error) {
      console.error('[prompt-rules] loadActiveRules', error.message);
      return [];
    }
    return (data ?? []).map((r) => toDomain(r as unknown as RuleRow));
  } catch (err) {
    console.error('[prompt-rules] loadActiveRules exception', err);
    return [];
  }
}

interface ComposeInput {
  rules: PromptRule[];
  /** structurePrompt / mergePrompt 등 이미 조립된 사용자 섹션. */
  userSection: string;
  /** 최종 조합 텍스트 상한 (문자 수). 초과 시 낮은 priority rule 부터 잘라냄. */
  maxLength?: number;
}

export interface ComposedPrompt {
  prompt: string;
  appliedRuleIds: string[];
  droppedRuleIds: string[];
}

const DEFAULT_MAX_LENGTH = 12000;

const CATEGORY_SECTION_ORDER: {
  label: string;
  categories: PromptRuleCategory[];
}[] = [
  { label: 'Global', categories: ['global'] },
  { label: 'Context', categories: ['school', 'location', 'style', 'context'] },
  { label: 'Task', categories: ['task'] },
];

/**
 * Category+priority 로 정렬된 rule 목록과 사용자 섹션을 받아 최종 프롬프트를 조립한다.
 * `rules` 는 이미 loadActiveRules 가 category+priority 순으로 정렬한 상태를 가정한다.
 */
export function composeRules({
  rules,
  userSection,
  maxLength = DEFAULT_MAX_LENGTH,
}: ComposeInput): ComposedPrompt {
  const seen = new Set<string>();
  const appliedRuleIds: string[] = [];
  const droppedRuleIds: string[] = [];

  // 각 카테고리 버킷별로 rule 후보 나열 (중복 제거)
  const globalPool: PromptRule[] = [];
  const contextPool: PromptRule[] = [];
  const taskPool: PromptRule[] = [];
  const negativePool: PromptRule[] = [];

  for (const rule of rules) {
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    if (rule.category === 'global') globalPool.push(rule);
    else if (rule.category === 'task') taskPool.push(rule);
    else if (rule.category === 'negative') negativePool.push(rule);
    else contextPool.push(rule);
  }

  // 조합 결과를 sections 로 만들고, 길이 초과시 priority 낮은 순 (배열 뒤쪽) 부터 잘라낸다
  const sectionsToRender: { label: string; pool: PromptRule[] }[] = [
    { label: 'Global', pool: globalPool },
    { label: 'Context', pool: contextPool },
    { label: 'Task', pool: taskPool },
  ];

  const renderSection = (label: string, pool: PromptRule[]): string | null => {
    if (pool.length === 0) return null;
    const lines = pool.map((r) => `- ${r.content}`).join('\n');
    return `[${label}]\n${lines}`;
  };

  const buildPrompt = (
    globalP: PromptRule[],
    contextP: PromptRule[],
    taskP: PromptRule[],
    negativeP: PromptRule[],
  ): string => {
    const parts: string[] = [];
    const globalText = renderSection('Global', globalP);
    if (globalText) parts.push(globalText);
    const contextText = renderSection('Context', contextP);
    if (contextText) parts.push(contextText);
    const taskText = renderSection('Task', taskP);
    if (taskText) parts.push(taskText);
    parts.push(`[User]\n${userSection}`);
    const negativeText = renderSection('Negative', negativeP);
    if (negativeText) parts.push(negativeText);
    return parts.join('\n\n');
  };

  // 우선 모든 rule 로 조립 시도
  let currentGlobal = [...globalPool];
  let currentContext = [...contextPool];
  let currentTask = [...taskPool];
  let currentNegative = [...negativePool];
  let composed = buildPrompt(currentGlobal, currentContext, currentTask, currentNegative);

  // 길이 초과시 우선순위 낮은 rule 부터 순차 제거
  // 자르는 순서: Task (마지막 항목부터) → Context → Global (Negative 는 마지막까지 유지)
  const cutOrder: (() => PromptRule | undefined)[] = [
    () => currentTask.pop(),
    () => currentContext.pop(),
    () => currentGlobal.pop(),
  ];

  while (composed.length > maxLength) {
    let popped: PromptRule | undefined;
    for (const cutter of cutOrder) {
      popped = cutter();
      if (popped) break;
    }
    if (!popped) break; // 더 이상 자를 rule 이 없음
    droppedRuleIds.push(popped.id);
    composed = buildPrompt(currentGlobal, currentContext, currentTask, currentNegative);
  }

  // 최종 적용된 rule id 집계 (droppedRuleIds 는 제외)
  for (const list of [currentGlobal, currentContext, currentTask, currentNegative]) {
    for (const r of list) {
      if (!droppedRuleIds.includes(r.id)) appliedRuleIds.push(r.id);
    }
  }

  return { prompt: composed, appliedRuleIds, droppedRuleIds };
}

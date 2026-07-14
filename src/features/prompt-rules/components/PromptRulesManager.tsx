'use client';

// /admin/prompts 페이지의 최상단 위젯. rule 목록 표 + 인라인 편집/생성 폼 + 미리보기.

import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PromptRuleForm } from '@/features/prompt-rules/components/PromptRuleForm';
import { PromptRulePreview } from '@/features/prompt-rules/components/PromptRulePreview';
import {
  useDeletePromptRule,
  usePromptRules,
  useUpdatePromptRule,
} from '@/features/prompt-rules/hooks/usePromptRules';
import { cn } from '@/lib/utils';
import { PROMPT_RULE_CATEGORY_LABELS } from '@/types/domain';

import type { PromptRule } from '@/types/domain';

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; rule: PromptRule };

export function PromptRulesManager() {
  const { data, isLoading, isError, refetch } = usePromptRules();
  const update = useUpdatePromptRule();
  const remove = useDeletePromptRule();
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const rules = data?.rules ?? [];

  async function handleToggle(rule: PromptRule) {
    setPendingToggleId(rule.id);
    try {
      await update.mutateAsync({
        id: rule.id,
        patch: { enabled: !rule.enabled },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '전환 실패');
    } finally {
      setPendingToggleId(null);
    }
  }

  async function handleDelete(rule: PromptRule) {
    if (
      !window.confirm(
        `"${rule.name}" 규칙을 삭제하시겠어요? 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    setPendingDeleteId(rule.id);
    try {
      await remove.mutateAsync(rule.id);
      toast.success('규칙을 삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">규칙 목록</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              모든 이미지 생성에 자동으로 조합되어 들어가는 지시사항입니다. 카테고리와 우선순위에 따라 조합 순서가 정해져요.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setEditor((prev) => (prev.mode === 'create' ? { mode: 'closed' } : { mode: 'create' }))
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            새 규칙 추가
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isError ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              규칙 목록을 불러오지 못했어요.
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 text-primary underline-offset-4 hover:underline"
              >
                다시 시도
              </button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md bg-muted"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              아직 규칙이 없어요. 우측 상단 <span className="font-medium">새 규칙 추가</span> 로 첫 규칙을 만들어 보세요.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">이름</th>
                    <th className="px-3 py-2 text-left font-medium">카테고리</th>
                    <th className="px-3 py-2 text-left font-medium">우선순위</th>
                    <th className="px-3 py-2 text-left font-medium">상태</th>
                    <th className="px-3 py-2 text-right font-medium">동작</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rules.map((rule) => {
                    const isToggling = pendingToggleId === rule.id;
                    const isDeleting = pendingDeleteId === rule.id;
                    return (
                      <tr key={rule.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <div className="font-medium">{rule.name}</div>
                          <div className="line-clamp-1 text-[11px] text-muted-foreground">
                            {rule.content.slice(0, 80)}
                            {rule.content.length > 80 ? '…' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                            {PROMPT_RULE_CATEGORY_LABELS[rule.category]}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {rule.priority}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleToggle(rule)}
                            disabled={isToggling}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                              rule.enabled
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-input bg-background text-muted-foreground',
                              isToggling && 'cursor-wait opacity-70',
                            )}
                            aria-pressed={rule.enabled}
                          >
                            {isToggling ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <span
                                className={cn(
                                  'inline-block h-1.5 w-1.5 rounded-full',
                                  rule.enabled ? 'bg-primary' : 'bg-muted-foreground/40',
                                )}
                              />
                            )}
                            {rule.enabled ? '켜짐' : '꺼짐'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditor({ mode: 'edit', rule })}
                              disabled={isDeleting}
                              className="h-7 px-2"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(rule)}
                              disabled={isDeleting}
                              className="h-7 px-2 text-destructive hover:text-destructive"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editor.mode !== 'closed' && (
        <PromptRuleForm
          initial={editor.mode === 'edit' ? editor.rule : null}
          onDone={() => setEditor({ mode: 'closed' })}
        />
      )}

      <PromptRulePreview />
    </div>
  );
}

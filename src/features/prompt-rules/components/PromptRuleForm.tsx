'use client';

// 새 rule 생성 또는 기존 rule 편집용 폼. 팝오버가 아니라 인라인 카드로 렌더.

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  useCreatePromptRule,
  useUpdatePromptRule,
} from '@/features/prompt-rules/hooks/usePromptRules';
import {
  PROMPT_RULE_CATEGORIES,
  PROMPT_RULE_CATEGORY_LABELS,
} from '@/types/domain';

import type { PromptRule, PromptRuleCategory } from '@/types/domain';

interface Props {
  initial?: PromptRule | null;
  onDone: () => void;
}

export function PromptRuleForm({ initial, onDone }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<PromptRuleCategory>(
    initial?.category ?? 'global',
  );
  const [priority, setPriority] = useState<number>(initial?.priority ?? 100);
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
  const [content, setContent] = useState(initial?.content ?? '');
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(', '));

  const create = useCreatePromptRule();
  const update = useUpdatePromptRule();
  const busy = create.isPending || update.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) {
      toast.error('이름과 내용은 필수입니다');
      return;
    }
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (isEdit && initial) {
        await update.mutateAsync({
          id: initial.id,
          patch: { name, category, priority, enabled, content, tags },
        });
        toast.success('규칙을 수정했어요');
      } else {
        await create.mutateAsync({ name, category, priority, enabled, content, tags });
        toast.success('규칙을 만들었어요');
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {isEdit ? '규칙 편집' : '새 규칙 추가'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">이름</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 한국 학교 스타일"
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-category">카테고리</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_RULE_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={busy}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-xs font-medium transition-colors',
                      category === c
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-accent',
                      busy && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    {PROMPT_RULE_CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-priority">우선순위 (낮을수록 먼저 적용)</Label>
              <Input
                id="rule-priority"
                type="number"
                min={0}
                max={10000}
                step={10}
                value={priority}
                disabled={busy}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(v)) return;
                  setPriority(Math.min(10000, Math.max(0, v)));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-enabled">활성화</Label>
              <button
                id="rule-enabled"
                type="button"
                onClick={() => setEnabled((v) => !v)}
                disabled={busy}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors',
                  enabled
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground',
                  busy && 'cursor-not-allowed opacity-50',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full',
                    enabled ? 'bg-primary' : 'bg-muted-foreground/40',
                  )}
                />
                {enabled ? '켜짐' : '꺼짐'}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-tags">태그 (쉼표로 구분, Phase 2 매칭용)</Label>
            <Input
              id="rule-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="예: elementary, science-lab, realistic"
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Phase 2 (AI 자동 분류) 에서 이 태그로 rule 을 선택할 예정. 지금은 저장만 하고 사용되지 않음.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-content">내용</Label>
            <Textarea
              id="rule-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="예: 항상 한국인의 얼굴과 체형으로 그리세요..."
              rows={8}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              최대 20000자. 이미지 생성 시 카테고리별 섹션 안에 이 내용이 그대로 삽입됩니다.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '저장 중…' : isEdit ? '수정' : '만들기'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

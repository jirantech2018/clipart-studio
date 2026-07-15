'use client';

// Knowledge 의 메타 정보 (이름/설명/트리거/금지조건/우선순위/활성) 편집 폼.
// 이미지 관리는 별도 컴포넌트 (KnowledgeImagesEditor) 에서.
// 생성 모드 (initial 없음) 와 편집 모드 둘 다 지원.

import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateKnowledge,
  useUpdateKnowledge,
} from '@/features/knowledge/hooks/useKnowledge';
import { cn } from '@/lib/utils';

import type { Knowledge } from '@/types/domain';

interface Props {
  initial?: Knowledge | null;
  onSaved?: (k: Knowledge) => void;
  onCancel?: () => void;
}

export function KnowledgeMetaForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [negativePrompt, setNegativePrompt] = useState(initial?.negativePrompt ?? '');
  const [priority, setPriority] = useState<number>(initial?.priority ?? 100);
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
  const [triggers, setTriggers] = useState<string[]>(initial?.triggers ?? []);
  const [triggerInput, setTriggerInput] = useState('');

  const create = useCreateKnowledge();
  const update = useUpdateKnowledge();
  const busy = create.isPending || update.isPending;

  function commitTriggerInput() {
    const raw = triggerInput.trim();
    if (!raw) return;
    // 쉼표로 여러 개 한 번에 붙여넣을 수도 있어 지원.
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 100);
    if (parts.length === 0) return;
    const next = Array.from(new Set([...triggers, ...parts])).slice(0, 50);
    setTriggers(next);
    setTriggerInput('');
  }

  function removeTrigger(t: string) {
    setTriggers((prev) => prev.filter((x) => x !== t));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim()) {
      toast.error('이름과 설명은 필수입니다');
      return;
    }
    try {
      if (isEdit && initial) {
        const saved = await update.mutateAsync({
          id: initial.id,
          patch: { name, description, triggers, negativePrompt, priority, enabled },
        });
        toast.success('저장했어요');
        onSaved?.(saved);
      } else {
        const saved = await create.mutateAsync({
          name,
          description,
          triggers,
          negativePrompt,
          priority,
          enabled,
        });
        toast.success('Knowledge 를 만들었어요');
        onSaved?.(saved);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {isEdit ? 'Knowledge 편집' : '새 Knowledge 추가'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="k-name">지식 이름</Label>
            <Input
              id="k-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 한국 학교 책상 하부 수납공간"
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-description">AI 설명</Label>
            <Textarea
              id="k-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="AI가 이해해야 할 구체적인 설명을 자세히 적어주세요."
              rows={8}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              이미지 생성 요청 시 최종 프롬프트에 그대로 삽입됩니다. 최대 20000자.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-triggers">언제 적용할까요? (트리거 태그)</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2">
              {triggers.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTrigger(t)}
                    disabled={busy}
                    aria-label={`${t} 제거`}
                    className="hover:text-primary/80"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                id="k-triggers"
                type="text"
                value={triggerInput}
                onChange={(e) => setTriggerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    commitTriggerInput();
                  }
                  if (e.key === 'Backspace' && triggerInput === '' && triggers.length > 0) {
                    setTriggers((prev) => prev.slice(0, -1));
                  }
                }}
                onBlur={commitTriggerInput}
                placeholder={
                  triggers.length === 0
                    ? '예: 책상, 교과서, 책을 꺼내다  (엔터 또는 쉼표로 추가)'
                    : ''
                }
                disabled={busy}
                className="flex-1 min-w-[10rem] bg-transparent text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              사용자 프롬프트에 이 단어들 중 하나라도 나오면 이 Knowledge 가 자동 선택됩니다. (Phase C 예정) 최대 50개.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-negative">생성하지 말아야 할 것</Label>
            <Textarea
              id="k-negative"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="예: 당겨 여는 서랍, 서랍 손잡이, 미국식 목재 책상"
              rows={3}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              최대 5000자. 최종 프롬프트의 금지 조건 섹션에 추가됩니다.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="k-priority">우선순위 (낮을수록 먼저 적용)</Label>
              <Input
                id="k-priority"
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
              <Label htmlFor="k-enabled">활성화</Label>
              <button
                id="k-enabled"
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

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                취소
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? '저장 중…' : isEdit ? '수정' : '만들기'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

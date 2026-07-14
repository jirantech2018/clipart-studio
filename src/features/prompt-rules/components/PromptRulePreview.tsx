'use client';

// 임의의 사용자 프롬프트를 넣어보고 어떤 rule 이 조합되는지 미리 볼 수 있는 UI.
// 실제 이미지 생성은 하지 않고 composeRules 결과만 표시한다.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePromptRulePreview } from '@/features/prompt-rules/hooks/usePromptRules';
import { PROMPT_RULE_CATEGORY_LABELS } from '@/types/domain';

export function PromptRulePreview() {
  const [prompt, setPrompt] = useState(
    '운동장에서 뛰는 초등학생, 파스텔 톤 실사 스타일',
  );
  const preview = usePromptRulePreview();

  async function handleRun() {
    if (!prompt.trim()) {
      toast.error('테스트 프롬프트를 입력하세요');
      return;
    }
    try {
      await preview.mutateAsync(prompt);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '미리보기 실패');
    }
  }

  const result = preview.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">미리보기</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="preview-prompt">테스트할 사용자 프롬프트</Label>
          <Textarea
            id="preview-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="예: 초등학생이 과학실에서 실험하는 모습"
            disabled={preview.isPending}
          />
          <p className="text-[11px] text-muted-foreground">
            현재 활성 규칙만으로 최종 프롬프트를 조합해봅니다. 이미지 생성은 하지 않아 크레딧이 소비되지 않아요.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={handleRun} disabled={preview.isPending}>
            {preview.isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 계산 중…
              </>
            ) : (
              '조합 결과 보기'
            )}
          </Button>
        </div>

        {result && (
          <div className="space-y-4 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                적용 {result.appliedRules.length}
              </span>
              {result.droppedRules.length > 0 && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                  제외 {result.droppedRules.length}
                </span>
              )}
              <span className="text-muted-foreground">
                전체 활성 {result.totalActiveRules}개 · 최종 {result.finalLength}자
              </span>
            </div>

            {result.appliedRules.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">적용된 규칙</p>
                <ul className="space-y-0.5 text-xs">
                  {result.appliedRules.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        {PROMPT_RULE_CATEGORY_LABELS[r.category]}
                      </span>
                      <span>{r.name}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground tabular-nums">
                        우선순위 {r.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.droppedRules.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  길이 초과로 제외된 규칙
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {result.droppedRules.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px]">
                        {PROMPT_RULE_CATEGORY_LABELS[r.category]}
                      </span>
                      <span>{r.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium">최종 프롬프트 (gpt-image-2 에 전달됨)</p>
              <pre className="max-h-72 overflow-auto rounded border bg-background p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                {result.finalPrompt}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

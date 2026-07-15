'use client';

// /admin/knowledge 하단에 마운트되는 미리보기 위젯.
// - 임의 프롬프트 입력 → matchKnowledgeForPrompt + composeKnowledgePrompt 결과 표시
// - 실제 이미지 생성 X, 크레딧 소비 X

import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePreviewKnowledge } from '@/features/knowledge/hooks/usePreviewKnowledge';
import { cn } from '@/lib/utils';

export function KnowledgePreview() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(
    '학생이 책상 아래에서 교과서를 꺼내는 모습',
  );
  const preview = usePreviewKnowledge();

  async function run() {
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
      <CardHeader className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-2 px-6 py-4 text-left transition-colors hover:bg-muted/40"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Preview — 어떤 Knowledge 가 매칭될지 미리 보기
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              실제 이미지 생성은 하지 않아 크레딧이 소비되지 않아요. 파이프라인이 이 프롬프트에
              대해 어떤 Knowledge 를 선택하고, 어떤 이미지가 gpt-image-2 에 전달되는지 그대로 확인할 수 있어요.
            </p>
          </div>
        </button>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="preview-prompt">테스트 프롬프트</Label>
          <Textarea
            id="preview-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="예: 초등학생이 과학실에서 실험하는 모습"
            disabled={preview.isPending}
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={run} disabled={preview.isPending}>
            {preview.isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 매칭 중…
              </>
            ) : (
              '매칭 결과 보기'
            )}
          </Button>
        </div>

        {result && (
          <div className="space-y-4 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                매칭 {result.matches.length}개
              </span>
              <span className="text-muted-foreground">
                전달 이미지 {result.referenceImageUrls.length}장 · 최종 프롬프트 {result.finalLength}자
              </span>
              {result.matches.length === 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  · Knowledge 매칭 없음 → 사용자 프롬프트가 그대로 전달됩니다
                </span>
              )}
            </div>

            {result.matches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium">매칭된 Knowledge</p>
                <div className="space-y-2">
                  {result.matches.map((m) => (
                    <div
                      key={m.knowledgeId}
                      className="flex gap-3 rounded-md border bg-background p-2"
                    >
                      {m.primaryImageUrl ? (
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded border bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.primaryImageUrl}
                            alt={m.knowledgeName}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed bg-muted text-[10px] text-muted-foreground">
                          이미지<br />없음
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/knowledge/${m.knowledgeId}`}
                            className="text-sm font-medium hover:text-primary hover:underline"
                          >
                            {m.knowledgeName}
                          </Link>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            우선순위 {m.priority}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {m.matchedTriggers.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>트리거 {m.triggerScore}개 매칭</span>
                          {m.llmScore !== null && (
                            <>
                              <span>·</span>
                              <span
                                className={cn(
                                  'tabular-nums',
                                  m.llmScore >= 0.7 && 'text-primary',
                                  m.llmScore < 0.5 && 'text-amber-700 dark:text-amber-400',
                                )}
                              >
                                LLM 점수 {(m.llmScore * 100).toFixed(0)}%
                              </span>
                            </>
                          )}
                        </div>
                        {m.reason && (
                          <div className="text-[11px] text-muted-foreground">
                            사유: {m.reason}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.referenceImageUrls.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">
                  gpt-image-2 에 전달될 참고 이미지 ({result.referenceImageUrls.length}장)
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.referenceImageUrls.map((url, i) => (
                    <div
                      key={url}
                      className="relative h-20 w-20 overflow-hidden rounded border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`참고 이미지 ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px] tabular-nums">
                        #{i + 1}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  첫 번째 이미지가 mask 대상입니다. 최대 5장까지 전달돼요.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium">최종 프롬프트</p>
              <pre className="max-h-72 overflow-auto rounded border bg-background p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                {result.finalPrompt}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

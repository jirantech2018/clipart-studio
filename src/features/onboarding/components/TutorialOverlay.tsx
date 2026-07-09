'use client';

// Design Ref: §5.4 Onboarding — first-visit walkthrough on the home surface.
// Storage: localStorage flag (client-only) so we don't add a DB column just for
// "seen tutorial". The trade-off is a fresh tutorial on a new browser/device,
// which is acceptable for MVP.

import { ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'clipart_tutorial_completed_v1';

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: '먼저 검색해보세요',
    body: '상단 검색창에 원하는 이미지를 입력하면 내 라이브러리와 Community에 이미 있는 이미지를 함께 찾아줍니다.',
  },
  {
    title: '없으면 AI로 만듭니다',
    body: '[AI로 이미지 만들기]를 누르고 프롬프트를 적어보세요. 5장씩 배치로 만들어져 마음에 드는 걸 골라 쓸 수 있어요.',
  },
  {
    title: '만든 이미지는 자산이 됩니다',
    body: '생성된 이미지는 자동으로 라이브러리에 저장됩니다. 카드에서 [공개]로 전환하면 다른 사용자도 볼 수 있어요.',
  },
  {
    title: '이 이미지로 다시 만들기',
    body: '이미지 상세에서 [이 이미지로 생성 (i2i)]을 누르면 스타일을 유지한 채 다른 포즈·표정·의상으로 재생성할 수 있어요.',
  },
];

export function TutorialOverlay() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) setOpen(true);
  }, []);

  function complete() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
    setOpen(false);
  }

  if (!open) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              시작하기 · {step + 1}/{STEPS.length}
            </p>
            <h2 id="tutorial-title" className="text-lg font-semibold">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={complete}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="닫기"
            title="건너뛰기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{current.body}</p>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted',
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={complete}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            건너뛰기
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                이전
              </Button>
            )}
            {isLast ? (
              <Button type="button" size="sm" onClick={complete}>
                시작하기
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                다음
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

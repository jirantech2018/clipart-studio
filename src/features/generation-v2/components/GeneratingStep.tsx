'use client';

// STEP 3 — 생성 진행 (AI 응답).
//
// 시안 매칭 대상:
//   - 헤더 우측 "전체 진행률 %" (실제 완료 카운트 기반, fake 없음)
//   - 탭 [생성 중 (N)] [완료 (M)] [실패 (K)] — 슬롯 그리드 필터
//   - 슬롯 시각: 대기(점선 원) · 생성 중(spinner) · 완료(썸네일) · 실패(경고)
//
// 서버가 slot 별 progress 이벤트를 보내지 않으므로:
//   - 슬롯 60% 도넛 (fake 진행률) 미표시
//   - "예상 남은 시간" (근거 없는 초 계산) 미표시
//   지시서 §"Fake Progress / Fake Remaining Time 절대 구현 X" 준수.

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { Block } from '@/lib/store/conversationStore';

type Tab = 'progress' | 'done' | 'failed';

interface GeneratingStepProps {
  block: Block;
}

interface Slot {
  i: number;
  kind: 'progress' | 'done' | 'failed';
  success?: Block['succeeded'][number];
  fail?: Block['failed'][number];
}

export function GeneratingStep({ block }: GeneratingStepProps) {
  const total = block.options.batchSize;
  const done = block.succeeded.length;
  const failed = block.failed.length;
  const finished = done + failed;
  const inProgress = Math.max(0, total - finished);
  const percent = total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : 0;

  const dims = ASPECT_RATIO_DIMENSIONS[block.options.aspectRatio];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };

  const slots = useMemo<Slot[]>(() => {
    return Array.from({ length: Math.max(1, total) }, (_, i) => {
      const success = block.succeeded.find((s) => s.order === i);
      const fail = block.failed.find((f) => f.order === i);
      if (success) return { i, kind: 'done', success };
      if (fail) return { i, kind: 'failed', fail };
      return { i, kind: 'progress' };
    });
  }, [block.succeeded, block.failed, total]);

  const [tab, setTab] = useState<Tab>('progress');
  const visibleSlots = slots.filter((s) => s.kind === tab);

  return (
    <section className="space-y-3 rounded-xl border bg-background p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <h3 className="text-base font-semibold">클립아트를 만들고 있어요</h3>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span>전체 진행률</span>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-semibold text-primary">{percent}%</span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="생성 상태별 슬롯"
        className="flex items-center gap-1 border-b"
      >
        <TabButton
          active={tab === 'progress'}
          onClick={() => setTab('progress')}
          label="생성 중"
          count={inProgress}
          total={total}
        />
        <TabButton
          active={tab === 'done'}
          onClick={() => setTab('done')}
          label="완료"
          count={done}
        />
        <TabButton
          active={tab === 'failed'}
          onClick={() => setTab('failed')}
          label="실패"
          count={failed}
        />
      </div>

      {visibleSlots.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {tab === 'done' && '아직 완료된 클립아트가 없어요.'}
          {tab === 'failed' && '실패한 클립아트가 없어요.'}
          {tab === 'progress' && '진행 중인 클립아트가 없어요.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {visibleSlots.map((slot) => (
            <SlotCell key={slot.i} slot={slot} aspectStyle={aspectStyle} />
          ))}
        </div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  total,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  total?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        ({count}
        {total !== undefined ? `/${total}` : ''})
      </span>
    </button>
  );
}

function SlotCell({ slot, aspectStyle }: { slot: Slot; aspectStyle: React.CSSProperties }) {
  if (slot.kind === 'done' && slot.success) {
    return (
      <div
        className="relative overflow-hidden rounded-lg border bg-muted animate-fade-in"
        style={aspectStyle}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slot.success.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
        </div>
      </div>
    );
  }
  if (slot.kind === 'failed' && slot.fail) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        style={aspectStyle}
        title={slot.fail.error}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <span>실패</span>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 text-xs text-muted-foreground"
      style={aspectStyle}
    >
      <Loader2 className="h-4 w-4 animate-spin text-primary/70" aria-hidden="true" />
      <span>생성 중</span>
    </div>
  );
}

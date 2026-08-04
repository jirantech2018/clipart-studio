'use client';

// STEP 1 카드 — 패키지 모드 ON 시 렌더.
//
// 상태는 상위 ConversationBlock 이 BlockOptions.packagePlan 로 관리하고,
// 이 컴포넌트는 그 nested 객체를 통째로 받아 특정 필드만 patch 로 돌려준다.

import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PackageModeToggle } from '@/features/generation-v2/components/PackageModeToggle';
import { selectVisibleKeywords } from '@/features/generation-v2/lib/mergePackagePlan';
import {
  USAGE_CHANNELS,
  type PackagePlanState,
  type UsageChannel,
} from '@/features/generation-v2/lib/packagePlanTypes';
import { cn } from '@/lib/utils';

interface Props {
  locked: boolean;
  packageMode: boolean;
  onPackageModeChange: (next: boolean) => void;
  plan: PackagePlanState;
  onPlanChange: (patch: Partial<PackagePlanState>) => void;
  isRecommendationLoading: boolean;
}

const PURPOSE_OPTIONS = [
  '',
  '독서 행사',
  '운동회',
  '졸업식',
  '입학식',
  '학사 달력',
  '학교 축제',
  '시상식',
  '수업 자료',
  '기타',
];

const TARGET_OPTIONS = [
  '',
  '유치원',
  '초등학교',
  '중학교',
  '고등학교',
  '학부모',
  '교직원',
  '기타',
];

const STYLE_OPTIONS = [
  '',
  '따뜻한 수채화',
  '깔끔한 라인',
  '컬러풀 카툰',
  '심플 미니멀',
  '레트로 감성',
  '몽환적 파스텔',
  '기타',
];

export function PackagePromptCard({
  locked,
  packageMode,
  onPackageModeChange,
  plan,
  onPlanChange,
  isRecommendationLoading,
}: Props) {
  const [newKeyword, setNewKeyword] = useState('');
  const visibleKeywords = selectVisibleKeywords(plan);

  function removeKeyword(k: string) {
    if (locked) return;
    if (plan.userAddedKeywords.includes(k)) {
      onPlanChange({
        userAddedKeywords: plan.userAddedKeywords.filter((x) => x !== k),
      });
      return;
    }
    if (!plan.userRemovedKeywords.includes(k)) {
      onPlanChange({
        userRemovedKeywords: [...plan.userRemovedKeywords, k],
      });
    }
  }

  function toggleUsageChannel(channel: UsageChannel) {
    if (locked) return;
    const has = plan.usageChannels.includes(channel);
    const next = has
      ? plan.usageChannels.filter((c) => c !== channel)
      : [...plan.usageChannels, channel];
    onPlanChange({ usageChannels: next });
  }

  function addKeyword() {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (visibleKeywords.includes(trimmed)) {
      setNewKeyword('');
      return;
    }
    const patch: Partial<PackagePlanState> = {
      userAddedKeywords: [...plan.userAddedKeywords, trimmed],
    };
    if (plan.userRemovedKeywords.includes(trimmed)) {
      patch.userRemovedKeywords = plan.userRemovedKeywords.filter(
        (x) => x !== trimmed,
      );
    }
    onPlanChange(patch);
    setNewKeyword('');
  }

  return (
    <section className="card flex h-full flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            1
          </span>
          <h3 className="text-base font-semibold">
            어떤 패키지가 필요하세요?
          </h3>
        </div>
        <PackageModeToggle
          checked={packageMode}
          onChange={onPackageModeChange}
          disabled={locked}
        />
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldSelect
          label="목적"
          value={plan.purpose}
          onChange={(next) => onPlanChange({ purpose: next })}
          options={PURPOSE_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
        <div className="space-y-1">
          <Label className="text-primary">주제 / 행사</Label>
          <Input
            value={plan.topicOrEvent}
            onChange={(e) => onPlanChange({ topicOrEvent: e.target.value })}
            placeholder="예: 책과 함께 자라는 우리"
            maxLength={80}
            readOnly={locked}
            className={cn(locked && 'cursor-not-allowed bg-muted/40')}
          />
        </div>
        <FieldSelect
          label="대상"
          value={plan.target}
          onChange={(next) => onPlanChange({ target: next })}
          options={TARGET_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
        <FieldSelect
          label="스타일 / 톤"
          value={plan.styleTone}
          onChange={(next) => onPlanChange({ styleTone: next })}
          options={STYLE_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-primary">
          활용 목적
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (복수 선택)
          </span>
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {USAGE_CHANNELS.map((channel) => {
            const active = plan.usageChannels.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                onClick={() => toggleUsageChannel(channel)}
                disabled={locked}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  locked && 'cursor-not-allowed opacity-50',
                )}
              >
                {channel}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-primary">핵심 키워드</Label>
          {isRecommendationLoading && (
            <span className="text-[11px] text-muted-foreground">
              AI 추천 갱신 중…
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleKeywords.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-primary/5 px-2.5 py-1 text-xs text-primary"
            >
              <span>{k}</span>
              {!locked && (
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  aria-label={`${k} 제거`}
                  className="text-primary/70 hover:text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {!locked && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="키워드"
                maxLength={16}
                className="h-7 w-24 rounded-full border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                <span>키워드 추가</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-primary">
          추가 요청사항
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (선택)
          </span>
        </Label>
        <Textarea
          value={plan.additionalRequest}
          onChange={(e) => onPlanChange({ additionalRequest: e.target.value })}
          readOnly={locked}
          maxLength={500}
          placeholder="예: 책과 학교 공간이 중심이 되도록 부탁드려요."
          className={cn(
            'min-h-[4.5rem] w-full resize-none',
            locked && 'cursor-not-allowed bg-muted/40',
          )}
        />
      </div>
    </section>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-primary">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-primary/40',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {options.map((opt) =>
          opt === '' ? (
            <option key="__none__" value="">
              {placeholder}
            </option>
          ) : (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ),
        )}
      </select>
    </div>
  );
}

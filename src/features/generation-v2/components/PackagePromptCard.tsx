'use client';

// STEP 1 카드 — 패키지 모드 ON 시 렌더.
//
// 목표 UI 매칭:
//   [1] 어떤 패키지가 필요하세요?      [테마별(목적별) 패키지 생성 ●]
//   ┌──────────────────────────────────────────────────────────┐
//   │ 목적           주제 / 행사                                │
//   │ [select]       [input]                                    │
//   │ 대상           스타일 / 톤                                │
//   │ [select]       [select]                                   │
//   │ 핵심 키워드                                               │
//   │ [chip x] [chip x] [chip x] [+ 키워드 추가]                │
//   │ 추가 요청사항 (선택)                                      │
//   │ [textarea]                                                │
//   └──────────────────────────────────────────────────────────┘

import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PackageModeToggle } from '@/features/generation-v2/components/PackageModeToggle';
import { selectVisibleKeywords } from '@/features/generation-v2/lib/mergePackagePlan';
import { cn } from '@/lib/utils';

interface Props {
  locked: boolean;
  packageMode: boolean;
  onPackageModeChange: (next: boolean) => void;
  purpose: string;
  onPurposeChange: (next: string) => void;
  topicOrEvent: string;
  onTopicOrEventChange: (next: string) => void;
  target: string;
  onTargetChange: (next: string) => void;
  styleTone: string;
  onStyleToneChange: (next: string) => void;
  additionalRequest: string;
  onAdditionalRequestChange: (next: string) => void;
  aiKeywords: readonly string[];
  userAddedKeywords: readonly string[];
  userRemovedKeywords: readonly string[];
  onUserAddedKeywordsChange: (next: string[]) => void;
  onUserRemovedKeywordsChange: (next: string[]) => void;
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
  purpose,
  onPurposeChange,
  topicOrEvent,
  onTopicOrEventChange,
  target,
  onTargetChange,
  styleTone,
  onStyleToneChange,
  additionalRequest,
  onAdditionalRequestChange,
  aiKeywords,
  userAddedKeywords,
  userRemovedKeywords,
  onUserAddedKeywordsChange,
  onUserRemovedKeywordsChange,
  isRecommendationLoading,
}: Props) {
  const [newKeyword, setNewKeyword] = useState('');
  const visibleKeywords = selectVisibleKeywords({
    packageAiKeywords: aiKeywords,
    packageUserAddedKeywords: userAddedKeywords,
    packageUserRemovedKeywords: userRemovedKeywords,
  });

  function removeKeyword(k: string) {
    if (locked) return;
    // 사용자 추가 키워드면 그 배열에서 제거.
    if (userAddedKeywords.includes(k)) {
      onUserAddedKeywordsChange(userAddedKeywords.filter((x) => x !== k));
      return;
    }
    // AI 추천 키워드면 removed 배열에 추가.
    if (!userRemovedKeywords.includes(k)) {
      onUserRemovedKeywordsChange([...userRemovedKeywords, k]);
    }
  }

  function addKeyword() {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (visibleKeywords.includes(trimmed)) {
      setNewKeyword('');
      return;
    }
    onUserAddedKeywordsChange([...userAddedKeywords, trimmed]);
    // 이전에 제거했던 키워드를 다시 추가하려면 removed 에서도 빼줌.
    if (userRemovedKeywords.includes(trimmed)) {
      onUserRemovedKeywordsChange(
        userRemovedKeywords.filter((x) => x !== trimmed),
      );
    }
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
          value={purpose}
          onChange={onPurposeChange}
          options={PURPOSE_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
        <div className="space-y-1">
          <Label className="text-primary">주제 / 행사</Label>
          <Input
            value={topicOrEvent}
            onChange={(e) => onTopicOrEventChange(e.target.value)}
            placeholder="예: 책과 함께 자라는 우리"
            maxLength={80}
            readOnly={locked}
            className={cn(locked && 'cursor-not-allowed bg-muted/40')}
          />
        </div>
        <FieldSelect
          label="대상"
          value={target}
          onChange={onTargetChange}
          options={TARGET_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
        <FieldSelect
          label="스타일 / 톤"
          value={styleTone}
          onChange={onStyleToneChange}
          options={STYLE_OPTIONS}
          placeholder="선택하세요"
          disabled={locked}
        />
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
          value={additionalRequest}
          onChange={(e) => onAdditionalRequestChange(e.target.value)}
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

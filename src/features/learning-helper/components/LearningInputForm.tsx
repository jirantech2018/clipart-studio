'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { LEARNING_MATERIAL_TYPES } from '@/features/learning-helper/domain/material-types';
import { LEARNING_SUBJECTS } from '@/features/learning-helper/domain/subjects';

export interface LearningInputValue {
  grade: number;
  subject: string;
  materialType: string;
  topic: string;
  questionCount: number;
  difficulty: 'easy' | 'normal' | 'hard';
  additionalRequest: string;
}

interface Props {
  value: LearningInputValue;
  onChange: (patch: Partial<LearningInputValue>) => void;
  onRequestRecommendations: () => void;
  onSubmit: () => void;
  submitting: boolean;
  recommending: boolean;
  disabled?: boolean;
}

// M1 노출 학년: 1~2 (사용자 지시). 나머지는 회색 처리.
const M1_GRADES = [1, 2];
const FUTURE_GRADES = [3, 4, 5, 6];

export function LearningInputForm({
  value,
  onChange,
  onRequestRecommendations,
  onSubmit,
  submitting,
  recommending,
  disabled,
}: Props) {
  const canRecommend =
    !!value.grade && !!value.subject && !!value.materialType && !recommending && !disabled;
  const canSubmit = canRecommend && value.topic.trim().length >= 2 && !submitting;

  return (
    <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {/* 학년 */}
      <FieldRow label="학년" hint="M1 은 1~2학년만 지원해요">
        <div className="flex flex-wrap gap-2">
          {M1_GRADES.map((g) => (
            <ChipButton
              key={g}
              active={value.grade === g}
              onClick={() => onChange({ grade: g })}
              disabled={disabled}
            >
              {g}학년
            </ChipButton>
          ))}
          {FUTURE_GRADES.map((g) => (
            <ChipButton key={g} active={false} disabled title="M2 이후 지원 예정">
              {g}학년 (준비중)
            </ChipButton>
          ))}
        </div>
      </FieldRow>

      {/* 과목 */}
      <FieldRow label="과목">
        <div className="flex flex-wrap gap-2">
          {LEARNING_SUBJECTS.map((s) => (
            <ChipButton
              key={s.code}
              active={value.subject === s.code}
              onClick={() => onChange({ subject: s.code })}
              disabled={disabled}
            >
              {s.nameKo}
            </ChipButton>
          ))}
        </div>
      </FieldRow>

      {/* 자료 유형 */}
      <FieldRow label="자료 유형" hint="객관식 · 개별 활동지 우선 검증 (M1)">
        <div className="grid gap-2 sm:grid-cols-2">
          {LEARNING_MATERIAL_TYPES.map((m) => (
            <button
              key={m.code}
              type="button"
              onClick={() => onChange({ materialType: m.code })}
              disabled={disabled}
              className={`rounded-lg border-2 p-3 text-left transition ${
                value.materialType === m.code
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{m.nameKo}</span>
                {m.m1Featured && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                    M1 우선
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{m.description}</div>
            </button>
          ))}
        </div>
      </FieldRow>

      {/* 단원·주제 */}
      <FieldRow label="단원·주제" hint="직접 입력하거나 아래 'AI 추천' 을 눌러보세요">
        <div className="flex flex-col gap-2">
          <Input
            value={value.topic}
            onChange={(e) => onChange({ topic: e.target.value })}
            placeholder="예: 낱말의 뜻 익히기 / 9까지의 수 세기"
            maxLength={80}
            disabled={disabled}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRequestRecommendations}
              disabled={!canRecommend}
            >
              {recommending ? '추천 중…' : 'AI 추천 3개 받기'}
            </Button>
          </div>
        </div>
      </FieldRow>

      {/* 문항 수 · 난이도 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="문항 수" hint="객관식 3~10문항 권장">
          <Input
            type="number"
            min={1}
            max={20}
            value={value.questionCount}
            onChange={(e) => onChange({ questionCount: Number(e.target.value) || 5 })}
            disabled={disabled}
          />
        </FieldRow>
        <FieldRow label="난이도">
          <div className="flex gap-2">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <ChipButton
                key={d}
                active={value.difficulty === d}
                onClick={() => onChange({ difficulty: d })}
                disabled={disabled}
              >
                {d === 'easy' ? '쉬움' : d === 'normal' ? '보통' : '어려움'}
              </ChipButton>
            ))}
          </div>
        </FieldRow>
      </div>

      {/* 추가 요청 */}
      <FieldRow label="추가 요청 (선택)">
        <Textarea
          value={value.additionalRequest}
          onChange={(e) => onChange({ additionalRequest: e.target.value })}
          placeholder="예: 오답도 그럴듯하게 만들어주세요"
          maxLength={300}
          rows={2}
          disabled={disabled}
        />
      </FieldRow>

      {/* Submit */}
      <div className="flex justify-end">
        <Button type="button" onClick={onSubmit} disabled={!canSubmit} size="lg">
          {submitting ? 'AI 생성 중…' : '학습자료 생성 (3 크레딧)'}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// helpers
// ============================================================
function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-sm font-semibold text-slate-800">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  disabled,
  children,
  title,
}: {
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active
          ? 'border-indigo-500 bg-indigo-500 text-white'
          : disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
            : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400'
      }`}
    >
      {children}
    </button>
  );
}

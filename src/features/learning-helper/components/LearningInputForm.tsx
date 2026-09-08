'use client';

// M2-1 (v0.5) 재구성:
//   - 단원(unit) 과 주제(topic) 필드 분리
//     · 단원: 학년+과목 seed 기반 select
//     · 주제: 자유 입력 (기본 흐름)
//   - AI 추천은 별도 방식이 아니라 "주제가 아직 없을 때 도움받기" 보조 버튼
//   - 시각적 톤앤매너는 기존 /generate 와 통일 (components/ui 재사용, 카드/버튼/입력 동일)

import { HelpCircle, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { amountSpecFor } from '@/features/learning-helper/domain/amount';
import {
  LEARNING_MATERIAL_TYPES,
  type MaterialTypeCode,
} from '@/features/learning-helper/domain/material-types';
import { LEARNING_SUBJECTS } from '@/features/learning-helper/domain/subjects';

export interface LearningInputValue {
  grade: number;
  subject: string;
  materialType: string;
  unit: string;
  topic: string;
  questionCount: number;
  difficulty: 'easy' | 'normal' | 'hard';
  additionalRequest: string;
}

interface Props {
  value: LearningInputValue;
  onChange: (patch: Partial<LearningInputValue>) => void;
  onRequestTopicSuggestions: () => void;
  onSubmit: () => void;
  submitting: boolean;
  suggesting: boolean;
  units: string[];
  unitsLoading: boolean;
  disabled?: boolean;
}

// M1 노출 학년: 1~2 (사용자 지시). 나머지는 회색 처리.
const M1_GRADES = [1, 2];
const FUTURE_GRADES = [3, 4, 5, 6];

export function LearningInputForm({
  value,
  onChange,
  onRequestTopicSuggestions,
  onSubmit,
  submitting,
  suggesting,
  units,
  unitsLoading,
  disabled,
}: Props) {
  const canSuggest =
    !!value.grade &&
    !!value.subject &&
    !!value.materialType &&
    !!value.unit &&
    !suggesting &&
    !disabled;
  const canSubmit =
    !!value.grade &&
    !!value.subject &&
    !!value.materialType &&
    !!value.unit &&
    value.topic.trim().length >= 2 &&
    !submitting &&
    !disabled;

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm">
      {/* 학년 */}
      <FieldRow label="학년" hint="현재 1~2학년 국어·수학을 지원해요">
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
            <ChipButton key={g} active={false} disabled title="곧 지원 예정">
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
      <FieldRow label="자료 유형">
        <div className="grid gap-2 sm:grid-cols-2">
          {LEARNING_MATERIAL_TYPES.map((m) => (
            <button
              key={m.code}
              type="button"
              onClick={() =>
                onChange({
                  materialType: m.code,
                  // 자료유형 바뀌면 기본 amount 로 재설정 (선택 옵션이 달라짐)
                  questionCount: amountSpecFor(m.code).defaultValue,
                })
              }
              disabled={disabled}
              className={`rounded-lg border-2 p-3 text-left transition ${
                value.materialType === m.code
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-border/60'
              }`}
            >
              <div className="text-sm font-semibold text-foreground">{m.nameKo}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{m.description}</div>
            </button>
          ))}
        </div>
      </FieldRow>

      {/* 단원 (select) */}
      <FieldRow
        label="단원"
        hint={unitsLoading ? '단원 목록 불러오는 중…' : '학년·과목 seed 에서 선택'}
      >
        <div className="flex flex-wrap gap-2">
          {units.length === 0 && !unitsLoading && (
            <div className="text-sm text-muted-foreground">
              선택 가능한 단원이 없습니다. 학년·과목을 다시 확인해주세요.
            </div>
          )}
          {units.map((u) => (
            <ChipButton
              key={u}
              active={value.unit === u}
              onClick={() =>
                // 단원 바뀌면 기존 주제(input)도 초기화 — 서로 다른 단원의 주제 잔재 방지
                onChange({ unit: u, topic: '' })
              }
              disabled={disabled}
            >
              {u}
            </ChipButton>
          ))}
        </div>
      </FieldRow>

      {/* 주제 (자유 입력) — 기본 흐름 */}
      <FieldRow label="주제" hint="자유롭게 입력해 주세요">
        <div className="flex flex-col gap-2">
          <Input
            value={value.topic}
            onChange={(e) => onChange({ topic: e.target.value })}
            placeholder={
              value.unit
                ? `예: ${value.unit} 관련 세부 주제를 자유롭게`
                : '먼저 단원을 선택하거나 자유롭게 주제를 입력해 주세요'
            }
            maxLength={80}
            disabled={disabled}
          />
          {/* 도움받기 — 주제가 정해지지 않았을 때 보조 */}
          <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              주제가 아직 정해지지 않았나요?
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRequestTopicSuggestions}
              disabled={!canSuggest}
              title={
                canSuggest
                  ? undefined
                  : '학년·과목·자료유형·단원을 먼저 선택하면 이용할 수 있어요'
              }
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {suggesting ? '추천 중…' : '이 단원의 세부 주제 3가지 추천받기'}
            </Button>
          </div>
        </div>
      </FieldRow>

      {/* 자료유형별 수량 (문항 수 / 활동 수 / 구성 분량 / 읽기 분량) · 난이도 */}
      {(() => {
        const spec = amountSpecFor(value.materialType as MaterialTypeCode);
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label={spec.fieldLabel} hint={spec.helperText}>
              <div className="flex flex-wrap gap-2">
                {spec.options.map((opt) => (
                  <ChipButton
                    key={opt.value}
                    active={value.questionCount === opt.value}
                    onClick={() => onChange({ questionCount: opt.value })}
                    disabled={disabled}
                  >
                    {opt.label}
                  </ChipButton>
                ))}
              </div>
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
        );
      })()}

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
          {submitting ? 'AI 생성 중…' : '학습자료 생성 · 3크레딧'}
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
      <Label className="mb-1.5 block text-sm font-semibold text-foreground">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
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
          ? 'border-primary bg-primary text-primary-foreground'
          : disabled
            ? 'cursor-not-allowed border-border bg-muted text-muted-foreground'
            : 'border-border bg-card text-foreground hover:border-primary/50'
      }`}
    >
      {children}
    </button>
  );
}

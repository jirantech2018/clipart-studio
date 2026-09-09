// LearningPageClientV2 — Phase 2 UI 통합 컴포넌트.
//
// 기존 /generate 레이아웃 (max-w-7xl · 2-column · sidebar) 을 재사용해서 학년 1~6
// 선택, 자료유형·수량 단위, 단원 vs 세부 주제 분리, AI 추천 3개, 학생/교사/통합본
// 선택, PDF/Word/PPT 선택, 우측 요약, 하단 미리보기, 최근 자료 재다운로드를 한
// 화면에서 처리한다.
//
// 원칙:
//   - 생성 엔진·저장·크레딧·렌더러·권한 코드는 그대로 사용 (POST /api/learning/documents,
//     GET /render?format=&variant=). 이번 파일에서는 UI 재배선만.
//   - 활성 프로필이 없는 (grade, subject) 조합은 "준비 중" 배지로 명확히 표시,
//     선택은 되지만 생성 버튼은 비활성.
//   - 클립아트 UI 자리는 있지만 실제 검색·삽입은 3단계에서 연동 (지금은 표시 X).

'use client';

import {
  Download,
  FileText,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { amountSpecFor } from '@/features/learning-helper/domain/amount';
import {
  LEARNING_MATERIAL_TYPES,
  type MaterialTypeCode,
} from '@/features/learning-helper/domain/material-types';
import {
  LEARNING_SUBJECTS,
  SUBJECT_LABEL,
  type SubjectCode,
} from '@/features/learning-helper/domain/subjects';
import { LearningPreview } from './LearningPreview';
import type { SupportMatrix } from '@/features/learning-helper/lib/support-matrix';

import type { LearningDocument } from '@/services/learning-renderer/schema';

// ============================================================
// Types
// ============================================================

interface Props {
  orgSlug: string;
  orgName: string;
  initialCredits: number;
  supportMatrix: SupportMatrix;
  /** 인증된 사용자 이메일. Admin 판정에만 사용 (UI 표시 없음). */
  userEmail: string | null;
}

interface Recommendation {
  type: 'basic' | 'realworld' | 'inquiry';
  unit: string;
  topic: string;
  reason: string;
}

interface GenerateResponse {
  jobId: string;
  documentId: string;
  document: LearningDocument;
  creditsUsed: number;
  generationMode?: 'v1' | 'v2C';
  appliedProfile?: string;
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

interface RecentDocument {
  id: string;
  title: string;
  grade: number;
  subjectCode: string;
  materialTypeCode: string;
  topic: string;
  createdAt: string;
}

type Variant = 'student' | 'teacher' | 'combined';
type Format = 'pdf' | 'docx' | 'pptx';

interface FormState {
  grade: number;
  subject: SubjectCode;
  materialType: MaterialTypeCode;
  unit: string;
  topic: string;
  questionCount: number;
  difficulty: 'easy' | 'normal' | 'hard';
  additionalRequest: string;
  variant: Variant;
  format: Format;
}

const DEFAULT_FORM: FormState = {
  grade: 1,
  subject: 'KOR',
  materialType: 'multiple_choice',
  unit: '',
  topic: '',
  questionCount: 5,
  difficulty: 'normal',
  additionalRequest: '',
  variant: 'student',
  format: 'pdf',
};

const LEARNING_DOC_CREDITS = 3;
const ALL_GRADES = [1, 2, 3, 4, 5, 6];

const VARIANT_OPTIONS: Array<{ value: Variant; label: string; hint: string }> = [
  { value: 'student', label: '학생용', hint: '정답 숨김' },
  { value: 'teacher', label: '교사용', hint: '정답 · 해설 포함' },
  { value: 'combined', label: '통합본', hint: '학생 + 정답 함께' },
];

const FORMAT_OPTIONS: Array<{ value: Format; label: string; ext: string }> = [
  { value: 'pdf', label: 'PDF', ext: '.pdf' },
  { value: 'docx', label: 'Word', ext: '.docx' },
  { value: 'pptx', label: 'PPT', ext: '.pptx' },
];

const REC_TYPE_LABEL: Record<Recommendation['type'], string> = {
  basic: '기본 개념 익히기',
  realworld: '생활 속에서 적용하기',
  inquiry: '생각을 넓혀 탐구하기',
};

// ============================================================
// Support-matrix lookups (subject-invariant)
// ============================================================

function isSupported(matrix: SupportMatrix, grade: number, subject: string): boolean {
  return matrix.entries.some((e) => e.grade === grade && e.subject === subject);
}

function supportedSubjectsForGrade(matrix: SupportMatrix, grade: number): Set<string> {
  const set = new Set<string>();
  for (const e of matrix.entries) if (e.grade === grade) set.add(e.subject);
  return set;
}

function supportedUnitsFor(matrix: SupportMatrix, grade: number, subject: string): string[] {
  const entry = matrix.entries.find((e) => e.grade === grade && e.subject === subject);
  return entry?.units ?? [];
}

// ============================================================
// Component
// ============================================================

export function LearningPageClientV2({
  orgSlug,
  orgName,
  initialCredits,
  supportMatrix,
  userEmail,
}: Props) {
  const [credits, setCredits] = useState(initialCredits);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  // 단원 목록 — DB seed 기반 (지원 조합에서만).
  const [units, setUnits] = useState<string[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  // AI 세부 주제 추천
  const [suggestions, setSuggestions] = useState<Recommendation[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // 생성
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  // 다운로드
  const [downloading, setDownloading] = useState(false);

  // 최근 자료
  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // ============================================================
  // Derived
  // ============================================================
  const supportedSubjects = useMemo(
    () => supportedSubjectsForGrade(supportMatrix, form.grade),
    [supportMatrix, form.grade],
  );
  const gradeSupported = supportedSubjects.size > 0;
  const combinationSupported = isSupported(supportMatrix, form.grade, form.subject);
  const supportedUnits = useMemo(
    () => supportedUnitsFor(supportMatrix, form.grade, form.subject),
    [supportMatrix, form.grade, form.subject],
  );
  const amountSpec = amountSpecFor(form.materialType);

  // ============================================================
  // Effects: 단원 목록 로드
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!combinationSupported) {
        setUnits([]);
        return;
      }
      setUnitsLoading(true);
      try {
        const res = await fetch(
          `/api/learning/topics?grade=${form.grade}&subject=${form.subject}`,
        );
        if (!res.ok) {
          if (!cancelled) setUnits([]);
          return;
        }
        const body = (await res.json()) as { data: { units: string[] } };
        if (!cancelled) setUnits(body.data.units);
      } catch {
        if (!cancelled) setUnits([]);
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [form.grade, form.subject, combinationSupported]);

  // 자료유형 변경 시 수량 default 조정
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      questionCount: amountSpecFor(prev.materialType).defaultValue,
    }));
    setSuggestions(null);
    setSuggestError(null);
  }, [form.materialType]);

  // 학년·과목 변경 시 단원·주제 초기화
  useEffect(() => {
    setForm((prev) => ({ ...prev, unit: '', topic: '' }));
    setSuggestions(null);
    setSuggestError(null);
  }, [form.grade, form.subject]);

  // 단원 변경 시 추천 초기화
  useEffect(() => {
    setSuggestions(null);
    setSuggestError(null);
  }, [form.unit]);

  // 최근 자료 로드
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/learning/documents/recent?orgSlug=${orgSlug}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data: { documents: RecentDocument[] } };
        if (!cancelled) setRecent(body.data.documents);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, result?.documentId]);

  // ============================================================
  // Handlers
  // ============================================================
  const patch = useCallback((delta: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...delta }));
  }, []);

  const handleRequestSuggestions = useCallback(async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch('/api/learning/topic-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: form.grade,
          subject: form.subject,
          materialType: form.materialType,
          unit: form.unit,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ErrorBody | null;
        setSuggestError(body?.error?.message ?? '추천 실패');
        return;
      }
      const body = (await res.json()) as {
        data: { unit: string; recommendations: Recommendation[] };
      };
      setSuggestions(body.data.recommendations);
    } catch (err) {
      setSuggestError((err as Error).message || '네트워크 오류');
    } finally {
      setSuggesting(false);
    }
  }, [form.grade, form.subject, form.materialType, form.unit]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setGenError(null);
    setResult(null);
    try {
      const res = await fetch('/api/learning/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSlug,
          grade: form.grade,
          subject: form.subject,
          materialType: form.materialType,
          unit: form.unit,
          topic: form.topic.trim(),
          questionCount: form.questionCount,
          difficulty: form.difficulty,
          additionalRequest: form.additionalRequest.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ErrorBody | null;
        setGenError(body?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { data: GenerateResponse };
      setResult(body.data);
      setCredits((prev) => Math.max(0, prev - body.data.creditsUsed));
    } catch (err) {
      setGenError((err as Error).message || '네트워크 오류');
    } finally {
      setSubmitting(false);
    }
  }, [orgSlug, form]);

  const doDownload = useCallback(
    async (documentId: string, format: Format, variant: Variant, title: string) => {
      setDownloading(true);
      try {
        const res = await fetch(
          `/api/learning/documents/${documentId}/render?format=${format}&variant=${variant}`,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ErrorBody | null;
          alert(body?.error?.message ?? `다운로드 실패 (HTTP ${res.status})`);
          return;
        }
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') ?? '';
        const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
        const ext = FORMAT_OPTIONS.find((f) => f.value === format)?.ext ?? '.pdf';
        const filename =
          utf8Match?.[1] !== undefined
            ? decodeURIComponent(utf8Match[1])
            : asciiMatch?.[1] !== undefined
              ? asciiMatch[1]
              : `${title}-${variant}${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(`다운로드 오류: ${(err as Error).message}`);
      } finally {
        setDownloading(false);
      }
    },
    [],
  );

  const canSuggest =
    combinationSupported && !!form.unit && !suggesting;
  const canSubmit =
    combinationSupported &&
    !!form.unit &&
    form.topic.trim().length >= 2 &&
    !submitting;

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="mx-auto flex max-w-7xl gap-6">
      {/* ============ MAIN ============ */}
      <main className="min-w-0 flex-1 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            학습 자료 만들기
          </h1>
          <p className="text-xs text-muted-foreground">
            학년·과목·단원을 고르고 세부 주제까지 정하면 학생용 학습지가 자동으로 만들어집니다.
            현재 워크스페이스: <span className="font-medium text-foreground">{orgName}</span>
          </p>
        </header>

        {/* 최근 자료 (재다운로드) */}
        <RecentDocumentsCard
          documents={recent}
          loading={recentLoading}
          orgSlug={orgSlug}
          downloading={downloading}
          onDownload={(id, title) => doDownload(id, 'pdf', 'student', title)}
        />

        {/* 입력 카드 */}
        <section className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm">
          {/* 학년 */}
          <div>
            <Label className="mb-2 block text-sm font-medium">학년</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_GRADES.map((g) => {
                const hasProfile = supportedSubjectsForGrade(supportMatrix, g).size > 0;
                const selected = form.grade === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => patch({ grade: g })}
                    className={
                      selected
                        ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                        : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                    }
                  >
                    {g}학년
                    {!hasProfile && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500">
                        준비 중
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 과목 */}
          <div>
            <Label className="mb-2 block text-sm font-medium">과목</Label>
            <div className="flex flex-wrap gap-2">
              {LEARNING_SUBJECTS.map((s) => {
                const hasProfile = supportedSubjects.has(s.code);
                const selected = form.subject === s.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => patch({ subject: s.code })}
                    className={
                      selected
                        ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                        : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                    }
                  >
                    {s.nameKo}
                    {gradeSupported && !hasProfile && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500">
                        준비 중
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 자료유형 */}
          <div>
            <Label className="mb-2 block text-sm font-medium">자료유형</Label>
            <div className="flex flex-wrap gap-2">
              {LEARNING_MATERIAL_TYPES.map((m) => {
                const selected = form.materialType === m.code;
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => patch({ materialType: m.code })}
                    className={
                      selected
                        ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                        : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                    }
                    title={m.description}
                  >
                    {m.nameKo}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 수량 */}
          <div>
            <Label className="mb-1 block text-sm font-medium">{amountSpec.fieldLabel}</Label>
            <p className="mb-2 text-xs text-muted-foreground">{amountSpec.helperText}</p>
            <div className="flex flex-wrap gap-2">
              {amountSpec.options.map((opt) => {
                const selected = form.questionCount === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch({ questionCount: opt.value })}
                    className={
                      selected
                        ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                        : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 단원 */}
          <div>
            <Label className="mb-2 block text-sm font-medium">단원</Label>
            {!combinationSupported ? (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {form.grade}학년 {SUBJECT_LABEL[form.subject as 'KOR' | 'MATH'] ?? form.subject}은
                아직 프로필이 준비되지 않았어요. 다른 학년·과목을 선택해 주세요.
              </p>
            ) : unitsLoading ? (
              <p className="text-xs text-muted-foreground">단원 목록 불러오는 중…</p>
            ) : units.length === 0 ? (
              <p className="text-xs text-muted-foreground">등록된 단원이 없어요.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {units.map((u) => {
                  const hasProfile = supportedUnits.includes(u);
                  const selected = form.unit === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      onClick={() => patch({ unit: u })}
                      className={
                        selected
                          ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                          : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                      }
                    >
                      {u}
                      {hasProfile && (
                        <span className="ml-1.5 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700">
                          맞춤 프로필
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 세부 주제 + AI 추천 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-sm font-medium">세부 주제</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRequestSuggestions}
                disabled={!canSuggest}
                title="세부 주제 3가지를 AI에게 추천받아요"
              >
                {suggesting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <HelpCircle className="mr-1 h-3.5 w-3.5" />
                )}
                도움받기
              </Button>
            </div>
            <Input
              value={form.topic}
              onChange={(e) => patch({ topic: e.target.value })}
              placeholder="예: 받아올림이 있는 두 자리 수 덧셈"
              disabled={!combinationSupported}
            />
            {suggestError && (
              <p className="mt-2 text-xs text-red-600">{suggestError}</p>
            )}
            {suggestions && suggestions.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {suggestions.map((rec) => (
                  <button
                    key={rec.type}
                    type="button"
                    onClick={() => patch({ topic: rec.topic })}
                    className="rounded-md border border-border bg-background p-3 text-left transition hover:border-primary hover:bg-primary/5"
                  >
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {REC_TYPE_LABEL[rec.type]}
                    </div>
                    <div className="text-sm font-medium text-foreground">{rec.topic}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{rec.reason}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 추가 요청 */}
          <div>
            <Label className="mb-2 block text-sm font-medium">
              추가 요청 <span className="text-xs text-muted-foreground">(선택)</span>
            </Label>
            <Textarea
              rows={2}
              value={form.additionalRequest}
              onChange={(e) => patch({ additionalRequest: e.target.value })}
              placeholder="예: 활동에 짝 활동을 포함해 주세요."
              disabled={!combinationSupported}
            />
          </div>

          {/* 출력 옵션 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block text-sm font-medium">배포 대상</Label>
              <div className="flex flex-wrap gap-2">
                {VARIANT_OPTIONS.map((opt) => {
                  const selected = form.variant === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch({ variant: opt.value })}
                      className={
                        selected
                          ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                          : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                      }
                      title={opt.hint}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="mb-2 block text-sm font-medium">출력 형식</Label>
              <div className="flex flex-wrap gap-2">
                {FORMAT_OPTIONS.map((opt) => {
                  const selected = form.format === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch({ format: opt.value })}
                      className={
                        selected
                          ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                          : 'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted'
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 클립아트 자리 (3단계 예정) */}
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
            <div className="mb-1 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="font-medium text-slate-700">클립아트 자동 삽입</span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                3단계 예정
              </span>
            </div>
            생성된 학습지에 우리 학교 클립아트를 자동으로 배치할 준비가 진행 중이에요.
          </div>

          {/* 액션 */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {combinationSupported
                ? `이 자료 생성에 크레딧 ${LEARNING_DOC_CREDITS}이(가) 사용돼요. 잔액: ${credits}`
                : '지원 학년·과목을 선택하면 생성할 수 있어요.'}
            </div>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="min-w-[10rem]"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 생성 중…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> 학습지 만들기
                </>
              )}
            </Button>
          </div>

          {genError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {genError}
            </div>
          )}
        </section>

        {/* 미리보기 */}
        {result && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">생성 결과</h2>
              <Button
                type="button"
                onClick={() =>
                  doDownload(result.documentId, form.format, form.variant, result.document.meta.title)
                }
                disabled={downloading}
                variant="secondary"
              >
                {downloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 다운로드 중…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {VARIANT_OPTIONS.find((v) => v.value === form.variant)?.label}{' '}
                    {FORMAT_OPTIONS.find((f) => f.value === form.format)?.label} 다운로드
                  </>
                )}
              </Button>
            </div>
            <LearningPreview
              document={result.document}
              variant={form.variant}
              generationMode={result.generationMode}
              appliedProfile={result.appliedProfile}
            />
          </section>
        )}
      </main>

      {/* ============ SIDEBAR ============ */}
      <aside className="hidden w-72 shrink-0 space-y-4 lg:block">
        <SummarySidebar
          credits={credits}
          form={form}
          combinationSupported={combinationSupported}
          appliedProfile={result?.appliedProfile}
          matrix={supportMatrix}
        />
      </aside>
    </div>
  );
}

// ============================================================
// Sidebar
// ============================================================
function SummarySidebar({
  credits,
  form,
  combinationSupported,
  appliedProfile,
  matrix,
}: {
  credits: number;
  form: FormState;
  combinationSupported: boolean;
  appliedProfile?: string;
  matrix: SupportMatrix;
}) {
  const amountSpec = amountSpecFor(form.materialType);
  const amountLabel = amountSpec.options.find((o) => o.value === form.questionCount)?.label ?? '';
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="text-xs font-semibold text-muted-foreground">잔여 크레딧</div>
        <div className="mt-1 text-2xl font-bold text-foreground">{credits}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          이번 생성에 <span className="font-medium">{LEARNING_DOC_CREDITS}</span> 사용
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          AI 추천 제작 구성
        </div>
        <ul className="space-y-1 text-xs text-foreground">
          <li>
            <span className="text-muted-foreground">학년·과목:</span>{' '}
            <span className="font-medium">
              {form.grade}학년 {SUBJECT_LABEL[form.subject as 'KOR' | 'MATH'] ?? form.subject}
            </span>
          </li>
          <li>
            <span className="text-muted-foreground">자료유형:</span>{' '}
            <span className="font-medium">
              {LEARNING_MATERIAL_TYPES.find((m) => m.code === form.materialType)?.nameKo ?? form.materialType}
            </span>
          </li>
          <li>
            <span className="text-muted-foreground">단원:</span>{' '}
            <span className="font-medium">{form.unit || '(미선택)'}</span>
          </li>
          <li>
            <span className="text-muted-foreground">세부 주제:</span>{' '}
            <span className="font-medium">{form.topic || '(미입력)'}</span>
          </li>
          <li>
            <span className="text-muted-foreground">{amountSpec.fieldLabel}:</span>{' '}
            <span className="font-medium">{amountLabel}</span>
          </li>
          <li>
            <span className="text-muted-foreground">배포 대상:</span>{' '}
            <span className="font-medium">
              {VARIANT_OPTIONS.find((v) => v.value === form.variant)?.label}
            </span>
          </li>
          <li>
            <span className="text-muted-foreground">출력 형식:</span>{' '}
            <span className="font-medium">
              {FORMAT_OPTIONS.find((f) => f.value === form.format)?.label}
            </span>
          </li>
        </ul>
        {!combinationSupported && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            현재 학년·과목은 준비 중이에요. 결과 품질이 보장되지 않아 생성 버튼이
            비활성 상태예요.
          </p>
        )}
        {appliedProfile && appliedProfile !== '(활성 프로필 없음)' && (
          <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
            직전 생성에 적용된 프로필: <span className="font-medium">{appliedProfile}</span>
          </p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
        <div className="mb-1 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-medium text-slate-800">클립아트</span>
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            3단계 예정
          </span>
        </div>
        <p>학교 클립아트 라이브러리를 먼저 검색하고, 없으면 새로 만들어 자동 삽입합니다.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground shadow-sm">
        <div className="mb-1 font-medium text-foreground">지원 학년·과목</div>
        {matrix.entries.length === 0 ? (
          <p>등록된 활성 프로필이 없어요.</p>
        ) : (
          <ul className="space-y-0.5">
            {matrix.entries.map((e) => (
              <li key={`${e.grade}-${e.subject}`}>
                {e.grade}학년 {SUBJECT_LABEL[e.subject as 'KOR' | 'MATH'] ?? e.subject}
                {e.units.length > 0 && (
                  <span className="text-muted-foreground/70"> · 세부: {e.units.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px]">
          그 외 학년·과목은 준비 중이며 순차 확대 예정이에요.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Recent list
// ============================================================
function RecentDocumentsCard({
  documents,
  loading,
  orgSlug,
  downloading,
  onDownload,
}: {
  documents: RecentDocument[];
  loading: boolean;
  orgSlug: string;
  downloading: boolean;
  onDownload: (id: string, title: string) => void;
}) {
  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground shadow-sm">
        최근 학습자료 불러오는 중…
      </section>
    );
  }
  if (documents.length === 0) {
    return null;
  }
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">최근 학습자료</div>
        <div className="text-xs text-muted-foreground">최근 20건 · 학생용 PDF 재다운로드</div>
      </div>
      <ul className="divide-y divide-border">
        {documents.slice(0, 8).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{d.title}</div>
              <div className="text-xs text-muted-foreground">
                {d.grade}학년 · {SUBJECT_LABEL[d.subjectCode as 'KOR' | 'MATH'] ?? d.subjectCode} ·{' '}
                {d.topic}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDownload(d.id, d.title)}
              disabled={downloading}
              title="학생용 PDF로 다시 받기"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

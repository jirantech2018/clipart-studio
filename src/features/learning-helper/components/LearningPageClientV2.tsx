// LearningPageClientV2 — /generate 디자인 시스템 재사용.
//
// 원칙:
//   - Card / CardHeader / CardTitle / CardContent (@/components/ui/card) 재사용
//   - Sidebar w-[280px] shrink-0 sticky top-20 (ConversationSidebar 와 동일 규격)
//   - 헤더 text-2xl font-semibold tracking-tight + text-xs text-muted-foreground
//   - Button / Input / Label / Textarea 는 @/components/ui 재사용
//   - 최대 폭 mx-auto max-w-7xl gap-6
//   - 생성/저장/크레딧/렌더러 코드 변경 없음. UI 배치만.
//   - 3열 = main 안 (입력 | 추천) 2컬럼 + 우측 sidebar 1컬럼

'use client';

import {
  BookOpen,
  ChevronDown,
  Coins,
  Download,
  Files,
  GraduationCap,
  HelpCircle,
  ImageIcon,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
  { value: 'teacher', label: '교사용', hint: '정답·해설 포함' },
  { value: 'combined', label: '통합본', hint: '학생 + 정답' },
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
// Support helpers
// ============================================================
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
}: Props) {
  const [credits, setCredits] = useState(initialCredits);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const [units, setUnits] = useState<string[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  const [suggestions, setSuggestions] = useState<Recommendation[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const [downloading, setDownloading] = useState(false);

  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const [guideOpen, setGuideOpen] = useState(false);

  const supportedSubjects = useMemo(
    () => supportedSubjectsForGrade(supportMatrix, form.grade),
    [supportMatrix, form.grade],
  );
  const gradeSupported = supportedSubjects.size > 0;
  const combinationSupported = supportedSubjects.has(form.subject);
  const supportedUnits = useMemo(
    () => supportedUnitsFor(supportMatrix, form.grade, form.subject),
    [supportMatrix, form.grade, form.subject],
  );
  const amountSpec = amountSpecFor(form.materialType);

  // ============ Effects ============
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

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      questionCount: amountSpecFor(prev.materialType).defaultValue,
    }));
    setSuggestions(null);
    setSuggestError(null);
  }, [form.materialType]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, unit: '', topic: '' }));
    setSuggestions(null);
    setSuggestError(null);
  }, [form.grade, form.subject]);

  useEffect(() => {
    if (supportedSubjects.size === 0) return;
    if (!supportedSubjects.has(form.subject)) {
      const first = Array.from(supportedSubjects)[0];
      if (first) setForm((prev) => ({ ...prev, subject: first as SubjectCode }));
    }
  }, [supportedSubjects, form.subject]);

  useEffect(() => {
    setSuggestions(null);
    setSuggestError(null);
  }, [form.unit]);

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

  // ============ Handlers ============
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

  const canSuggest = combinationSupported && !!form.unit && !suggesting;
  const canSubmit =
    combinationSupported &&
    !!form.unit &&
    form.topic.trim().length >= 2 &&
    !submitting;

  const projectedCredits = Math.max(0, credits - LEARNING_DOC_CREDITS);
  const insufficientCredits = credits < LEARNING_DOC_CREDITS;

  const generatePath = `/organization/my/generate`;
  const libraryPath = `/organization/my/library`;

  // ============================================================
  // Render — /generate 와 동일한 컨테이너 + sidebar 규격
  // ============================================================
  return (
    <div className="mx-auto max-w-7xl">
      {/* ============ 1. Header (Generate와 동일 스타일) ============ */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              수업에 필요한 학습자료를 AI와 함께 만들어보세요.
            </h1>
            <p className="text-xs text-muted-foreground">
              초등 학년과 과목에 맞는 문제·활동·클립아트를 한 번에 만들 수 있어요.
              <span className="ml-1">
                (현재 워크스페이스: <span className="font-medium text-foreground">{orgName}</span>)
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
            >
              <HelpCircle className="h-4 w-4" />
              사용 가이드
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', guideOpen && 'rotate-180')}
              />
            </button>
          </div>
        </div>
        {guideOpen && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            학습자료 만들기는 초등 학년·과목·단원·주제를 선택하면 AI가 학생용 학습지를 만들어
            줍니다. 클립아트 자동 삽입은 이후 단계에서 연결됩니다.
          </div>
        )}
      </header>

      {/* ============ 2. 제작 방식 카드 4개 ============ */}
      <div className="mt-6">
        <ModeCards generatePath={generatePath} libraryPath={libraryPath} />
      </div>

      {/* ============ Body 2-column (main + 280px sidebar) — /generate 규격 ============ */}
      <div className="mt-6 flex gap-6">
        <main className="min-w-0 flex-1 space-y-6">
          {/* 입력 + 추천 2-column */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <InputCard
                form={form}
                patch={patch}
                supportMatrix={supportMatrix}
                supportedSubjects={supportedSubjects}
                gradeSupported={gradeSupported}
                combinationSupported={combinationSupported}
                supportedUnits={supportedUnits}
                units={units}
                unitsLoading={unitsLoading}
                amountSpec={amountSpec}
                suggestions={suggestions}
                suggesting={suggesting}
                suggestError={suggestError}
                onRequestSuggestions={handleRequestSuggestions}
                canSuggest={canSuggest}
              />
            </div>
            <div className="lg:col-span-2">
              <RecommendationCard
                form={form}
                amountSpec={amountSpec}
                combinationSupported={combinationSupported}
                canSubmit={canSubmit}
                submitting={submitting}
                onSubmit={handleSubmit}
                genError={genError}
                expectedCredits={LEARNING_DOC_CREDITS}
              />
            </div>
          </div>

          {/* 미리보기 */}
          <PreviewSection
            form={form}
            result={result}
            downloading={downloading}
            onDownload={doDownload}
          />
        </main>

        {/* ============ Sidebar (/generate와 동일 폭 280px + sticky) ============ */}
        <aside
          className={cn(
            'hidden w-[280px] shrink-0 flex-col gap-2',
            'lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)]',
          )}
        >
          <Link
            href={generatePath}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="mr-1 h-4 w-4" />
            새로운 대화
          </Link>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">크레딧 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <Row label="보유 크레딧">
                <span className="inline-flex items-center gap-1">
                  <Coins className="h-3.5 w-3.5 text-amber-500" />
                  <strong className="tabular-nums text-primary">{credits}</strong>
                </span>
              </Row>
              <Row label="이번 사용">
                <span className="tabular-nums text-muted-foreground">-{LEARNING_DOC_CREDITS}</span>
              </Row>
              <div className="my-1 border-t border-border/60" />
              <Row label="생성 후 예상">
                <strong
                  className={cn(
                    'tabular-nums',
                    insufficientCredits ? 'text-destructive' : 'text-primary',
                  )}
                >
                  {projectedCredits}
                </strong>
              </Row>
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-1 flex-col">
            <Card className="flex max-h-full flex-col overflow-hidden">
              <CardHeader className="shrink-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen className="h-4 w-4 text-primary" />
                  최근 학습자료
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-1 overflow-auto">
                {recentLoading ? (
                  <p className="text-xs text-muted-foreground">불러오는 중…</p>
                ) : recent.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    아직 생성한 학습자료가 없어요.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {(recentExpanded ? recent : recent.slice(0, 7)).map((d) => (
                        <li
                          key={d.id}
                          className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-foreground">
                              {d.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {d.grade}학년 ·{' '}
                              {SUBJECT_LABEL[d.subjectCode as 'KOR' | 'MATH'] ?? d.subjectCode}
                              <span className="ml-1">· {formatRelative(d.createdAt)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => doDownload(d.id, 'pdf', 'student', d.title)}
                            disabled={downloading}
                            title="학생용 PDF로 재다운로드"
                            className="inline-flex shrink-0 items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-muted"
                          >
                            <RefreshCw className="mr-0.5 h-3 w-3" /> PDF
                          </button>
                        </li>
                      ))}
                    </ul>
                    {recent.length > 7 && (
                      <div className="mt-2 border-t border-border pt-2 text-center">
                        <button
                          type="button"
                          onClick={() => setRecentExpanded((v) => !v)}
                          className="text-xs font-medium text-primary hover:opacity-80"
                        >
                          {recentExpanded ? '접기' : `전체 보기 (${recent.length}건)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ============================================================
// 2. Mode cards
// ============================================================
function ModeCards({
  generatePath,
  libraryPath,
}: {
  generatePath: string;
  libraryPath: string;
}) {
  const items: Array<{
    href: string | null;
    Icon: typeof PenLine;
    subtitle: string;
    description: string;
    tone: { iconBg: string; iconColor: string; subtitleColor: string };
    selected?: boolean;
  }> = [
    {
      href: generatePath,
      Icon: PenLine,
      subtitle: '직접 글로 적어서 만들기',
      description: '원하는 내용을 자유롭게 입력하면 AI가 새로운 학습자료를 만들어드립니다.',
      tone: {
        iconBg: 'bg-purple-100',
        iconColor: 'text-purple-600',
        subtitleColor: 'text-purple-600',
      },
    },
    {
      href: `${generatePath}?mode=reference`,
      Icon: ImageIcon,
      subtitle: '참조 이미지 이용하여 만들기',
      description:
        '내가 등록한 학교 이미지나 학교·기관의 이미지를 바탕으로 학습자료를 생성합니다.',
      tone: {
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-600',
        subtitleColor: 'text-blue-600',
      },
    },
    {
      href: libraryPath,
      Icon: Files,
      subtitle: '라이브러리 이용하여 만들기',
      description: '공유 라이브러리의 클립아트나 템플릿을 선택해 새로운 학습자료를 만듭니다.',
      tone: {
        iconBg: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
        subtitleColor: 'text-emerald-600',
      },
    },
    {
      href: null,
      Icon: GraduationCap,
      subtitle: '초등 학습도우미',
      description: '학년·과목·주제를 선택하면 문제와 그림이 포함된 학습자료를 만들어드립니다.',
      tone: {
        iconBg: 'bg-primary/10',
        iconColor: 'text-primary',
        subtitleColor: 'text-primary',
      },
      selected: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const inner = (
          <div
            className={cn(
              'card flex h-full flex-col gap-3 p-4 transition',
              item.selected
                ? 'border-2 border-primary ring-2 ring-primary/20'
                : 'hover:border-primary/50 hover:shadow-md',
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  item.tone.iconBg,
                )}
              >
                <item.Icon className={cn('h-4 w-4', item.tone.iconColor)} />
              </div>
              <p className={cn('text-sm font-semibold', item.tone.subtitleColor)}>
                {item.subtitle}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </div>
        );
        if (item.href) {
          return (
            <Link key={item.subtitle} href={item.href} className="block">
              {inner}
            </Link>
          );
        }
        return (
          <div key={item.subtitle} className="block cursor-default">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Input card (Card 컴포넌트 재사용)
// ============================================================
interface InputCardProps {
  form: FormState;
  patch: (delta: Partial<FormState>) => void;
  supportMatrix: SupportMatrix;
  supportedSubjects: Set<string>;
  gradeSupported: boolean;
  combinationSupported: boolean;
  supportedUnits: string[];
  units: string[];
  unitsLoading: boolean;
  amountSpec: ReturnType<typeof amountSpecFor>;
  suggestions: Recommendation[] | null;
  suggesting: boolean;
  suggestError: string | null;
  onRequestSuggestions: () => void;
  canSuggest: boolean;
}

function InputCard({
  form,
  patch,
  supportMatrix,
  supportedSubjects,
  gradeSupported,
  combinationSupported,
  supportedUnits,
  units,
  unitsLoading,
  amountSpec,
  suggestions,
  suggesting,
  suggestError,
  onRequestSuggestions,
  canSuggest,
}: InputCardProps) {
  const chipBase =
    'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition';
  const chipSelected =
    'border-2 border-primary bg-primary text-primary-foreground shadow-sm';
  const chipIdle =
    'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted';
  const chipDisabled = 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <NumberBadge>1</NumberBadge>
          수업 정보를 알려주세요
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">학년</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_GRADES.map((g) => {
                const has = supportedSubjectsForGrade(supportMatrix, g).size > 0;
                const selected = form.grade === g;
                return (
                  <button
                    key={g}
                    type="button"
                    disabled={!has}
                    onClick={() => has && patch({ grade: g })}
                    title={!has ? '준비 중인 학년이에요' : undefined}
                    className={cn(chipBase, !has ? chipDisabled : selected ? chipSelected : chipIdle)}
                  >
                    {g}학년
                    {!has && (
                      <span className="ml-1 rounded-md bg-slate-200 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                        준비 중
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">과목</Label>
            <div className="flex flex-wrap gap-1.5">
              {LEARNING_SUBJECTS.map((s) => {
                const has = supportedSubjects.has(s.code);
                const selected = form.subject === s.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    disabled={!has}
                    onClick={() => has && patch({ subject: s.code })}
                    title={!has ? '이 학년에서는 준비 중인 과목이에요' : undefined}
                    className={cn(chipBase, !has ? chipDisabled : selected ? chipSelected : chipIdle)}
                  >
                    {s.nameKo}
                    {gradeSupported && !has && (
                      <span className="ml-1 rounded-md bg-slate-200 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                        준비 중
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">자료 유형</Label>
            <div className="flex flex-wrap gap-1.5">
              {LEARNING_MATERIAL_TYPES.map((m) => {
                const selected = form.materialType === m.code;
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => patch({ materialType: m.code })}
                    title={m.description}
                    className={cn(chipBase, selected ? chipSelected : chipIdle)}
                  >
                    {m.nameKo}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">{amountSpec.fieldLabel}</Label>
            <div className="flex flex-wrap gap-1.5">
              {amountSpec.options.map((opt) => {
                const selected = form.questionCount === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch({ questionCount: opt.value })}
                    className={cn(chipBase, selected ? chipSelected : chipIdle)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{amountSpec.helperText}</p>
          </div>
        </div>

        <div>
          <Label className="mb-2 block text-sm font-semibold">단원</Label>
          {!combinationSupported ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {form.grade}학년 {SUBJECT_LABEL[form.subject as 'KOR' | 'MATH'] ?? form.subject}은
              아직 프로필이 준비되지 않았어요.
            </p>
          ) : unitsLoading ? (
            <p className="text-xs text-muted-foreground">단원 목록 불러오는 중…</p>
          ) : units.length === 0 ? (
            <p className="text-xs text-muted-foreground">등록된 단원이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {units.map((u) => {
                const has = supportedUnits.includes(u);
                const selected = form.unit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => patch({ unit: u })}
                    className={cn(chipBase, selected ? chipSelected : chipIdle)}
                  >
                    {u}
                    {has && (
                      <span className="ml-1 rounded-md bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800">
                        맞춤 프로필
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-sm font-semibold">세부 주제</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRequestSuggestions}
              disabled={!canSuggest}
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
          {suggestError && <p className="mt-2 text-xs text-red-600">{suggestError}</p>}
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

        <div>
          <Label className="mb-2 block text-sm font-semibold">
            추가 요청사항 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
          </Label>
          <Textarea
            rows={2}
            value={form.additionalRequest}
            onChange={(e) => patch({ additionalRequest: e.target.value })}
            placeholder="학생이 직접 쓸 수 있는 답안 공간을 충분히 넣어주세요."
            disabled={!combinationSupported}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">배포 대상</Label>
            <div className="flex flex-wrap gap-1.5">
              {VARIANT_OPTIONS.map((opt) => {
                const selected = form.variant === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch({ variant: opt.value })}
                    title={opt.hint}
                    className={cn(chipBase, selected ? chipSelected : chipIdle)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">출력 형식</Label>
            <div className="flex flex-wrap gap-1.5">
              {FORMAT_OPTIONS.map((opt) => {
                const selected = form.format === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch({ format: opt.value })}
                    className={cn(chipBase, selected ? chipSelected : chipIdle)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Recommendation card
// ============================================================
function RecommendationCard({
  form,
  amountSpec,
  combinationSupported,
  canSubmit,
  submitting,
  onSubmit,
  genError,
  expectedCredits,
}: {
  form: FormState;
  amountSpec: ReturnType<typeof amountSpecFor>;
  combinationSupported: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  genError: string | null;
  expectedCredits: number;
}) {
  const amountLabel = amountSpec.options.find((o) => o.value === form.questionCount)?.label ?? '';
  const materialLabel =
    LEARNING_MATERIAL_TYPES.find((m) => m.code === form.materialType)?.nameKo ?? form.materialType;

  const bullets: Array<{ title: string; detail: string; check: boolean }> = [
    {
      title: `${form.variant === 'teacher' ? '교사용' : form.variant === 'combined' ? '통합본' : '학생용'} ${materialLabel} ${amountLabel}`,
      detail: `${form.grade}학년 수준에 맞춘 ${materialLabel} 문제로 구성`,
      check: true,
    },
    {
      title: form.variant !== 'student' ? '정답·해설 포함' : '학생용 (정답 숨김)',
      detail:
        form.variant === 'student'
          ? '학생 배포용. 정답과 해설은 숨김'
          : '정답과 해설, 지도 방법까지 제공',
      check: true,
    },
    {
      title: `출력 형식: ${FORMAT_OPTIONS.find((f) => f.value === form.format)?.label}`,
      detail: '선택한 형식으로 즉시 다운로드 가능',
      check: true,
    },
    {
      title: '클립아트 자동 삽입 (3단계 예정)',
      detail: '학교 클립아트 라이브러리 연동 예정',
      check: false,
    },
  ];

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <NumberBadge>2</NumberBadge>
          AI 추천 제작 구성
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex-1 space-y-3">
          {bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                  b.check ? 'bg-primary text-primary-foreground' : 'bg-slate-200 text-slate-500',
                )}
              >
                {b.check ? '✓' : '…'}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{b.title}</div>
                <div className="text-xs text-muted-foreground">{b.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-sm text-muted-foreground">예상 사용 크레딧</span>
            <span className="inline-flex items-center gap-1 text-lg font-bold text-primary">
              <Coins className="h-4 w-4 text-amber-500" /> {expectedCredits}
            </span>
          </div>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            size="lg"
            className="w-full text-base font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 생성 중…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" /> 학습자료 만들기
              </>
            )}
          </Button>
          {!combinationSupported && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              현재 학년·과목은 준비 중이에요. 지원 조합을 선택하면 생성할 수 있어요.
            </p>
          )}
          {genError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {genError}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Preview
// ============================================================
function PreviewSection({
  form,
  result,
  downloading,
  onDownload,
}: {
  form: FormState;
  result: GenerateResponse | null;
  downloading: boolean;
  onDownload: (id: string, format: Format, variant: Variant, title: string) => void;
}) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">생성될 자료 미리보기</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            학습자료 만들기를 누르면 아래 순서로 준비돼요.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PlaceholderCard label={`학생용 ${form.grade}학년`} tone="primary" Icon={BookOpen} />
            <PlaceholderCard label={`학생용 예시`} tone="primary" Icon={BookOpen} />
            <PlaceholderCard label="교사용" tone="rose" Icon={GraduationCap} />
            <PlaceholderCard label="클립아트" tone="emerald" Icon={ImageIcon} note="3단계 예정" />
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">생성 결과</h2>
        <Button
          type="button"
          onClick={() =>
            onDownload(result.documentId, form.format, form.variant, result.document.meta.title)
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
  );
}

function PlaceholderCard({
  label,
  tone,
  Icon,
  note,
}: {
  label: string;
  tone: 'primary' | 'rose' | 'emerald';
  Icon: typeof BookOpen;
  note?: string;
}) {
  const toneCls =
    tone === 'primary'
      ? 'bg-primary/10 text-primary'
      : tone === 'rose'
        ? 'bg-rose-100 text-rose-500'
        : 'bg-emerald-100 text-emerald-600';
  return (
    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-center">
      <div className={cn('mb-1 flex h-10 w-10 items-center justify-center rounded-full', toneCls)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs font-semibold text-foreground">{label}</div>
      {note && (
        <div className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          {note}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Small utilities
// ============================================================
function NumberBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return `${Math.floor(day / 7)}주 전`;
}

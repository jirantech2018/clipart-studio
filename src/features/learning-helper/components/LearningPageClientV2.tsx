// LearningPageClientV2 — 목표 캡처 밀도로 재작성.
//
// 원칙 (사용자 캡처 기준):
//   - Mode 카드 4개: /generate 의 UsageGuideBanners 패턴을 재사용 (아이콘 + subtitle
//     + description + 하단 예시 이미지). 학습도우미 카드는 primary ring 선택 상태.
//   - Input Card: dropdown(select) 중심으로 학년/과목/자료유형/수량 2열, 단원 칩,
//     세부 주제 입력, 추가 요청 textarea, 배포/출력 radio 그룹.
//   - Recommendation Card: 체크박스 3항목 (자료 유형 요약 / 정답·해설 / 클립아트) +
//     예상 크레딧 + full-width 학습자료 만들기 버튼.
//   - Sidebar: 상단 큰 "새로운 대화" 버튼 → 크레딧 카드 → 최근 학습자료 카드.
//   - Preview: 생성 전엔 4개 예시 썸네일 (예시 배지), 생성 후엔 LearningPreview 실 결과.
//
// 생성 엔진·저장·크레딧·렌더러·권한 코드 변경 없음.

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
  Palette,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

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
// Helpers
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
// Root
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
    combinationSupported && !!form.unit && form.topic.trim().length >= 2 && !submitting;

  const projectedCredits = Math.max(0, credits - LEARNING_DOC_CREDITS);
  const insufficientCredits = credits < LEARNING_DOC_CREDITS;

  const generatePath = `/organization/my/generate`;
  const libraryPath = `/organization/my/library`;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* ============ Header ============ */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">
              수업에 필요한 학습자료를 AI와 함께 만들어보세요.
            </h1>
            <p className="text-sm text-muted-foreground">
              초등 학년과 과목에 맞는 문제·활동·클립아트를 한 번에 만들 수 있어요.
              <span className="ml-1">
                (현재 워크스페이스: <span className="font-medium text-foreground">{orgName}</span>)
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
          >
            <HelpCircle className="h-4 w-4" />
            사용 가이드
            <ChevronDown className={cn('h-4 w-4 transition', guideOpen && 'rotate-180')} />
          </button>
        </div>
        {guideOpen && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            학년·과목·단원·주제를 고르면 AI가 학습지를 만들어 줍니다. 클립아트 자동 삽입은 다음
            단계에서 연결됩니다.
          </div>
        )}
      </header>

      {/* ============ Mode Cards (큰 카드 + 예시 이미지) ============ */}
      <ModeCards generatePath={generatePath} libraryPath={libraryPath} />

      {/* ============ Body: main + 280px sidebar ============ */}
      <div className="flex gap-6">
        <main className="min-w-0 flex-1 space-y-6">
          {/* Input + Recommendation 2-column */}
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

          {/* Preview */}
          <PreviewSection
            form={form}
            result={result}
            downloading={downloading}
            onDownload={doDownload}
          />
        </main>

        {/* Sidebar */}
        <aside
          className={cn(
            'hidden w-[300px] shrink-0 flex-col gap-3',
            'lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)]',
          )}
        >
          <Link
            href={generatePath}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="mr-1.5 h-5 w-5" />
            새로운 대화
          </Link>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">크레딧 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="보유 크레딧">
                <span className="inline-flex items-center gap-1">
                  <Coins className="h-4 w-4 text-amber-500" />
                  <strong className="text-lg tabular-nums text-primary">{credits}</strong>
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

          <Card className="flex max-h-full min-h-0 flex-1 flex-col overflow-hidden">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <BookOpen className="h-4 w-4 text-primary" />
                최근 학습자료
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto p-3">
              {recentLoading ? (
                <p className="px-3 text-xs text-muted-foreground">불러오는 중…</p>
              ) : recent.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground">
                  아직 생성한 학습자료가 없어요.
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {(recentExpanded ? recent : recent.slice(0, 7)).map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 transition hover:border-border hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {d.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
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
                          className="inline-flex shrink-0 items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> PDF
                        </button>
                      </li>
                    ))}
                  </ul>
                  {recent.length > 7 && (
                    <div className="mt-3 border-t border-border pt-2 text-center">
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
        </aside>
      </div>
    </div>
  );
}

// ============================================================
// Mode Cards — /generate UsageGuideBanners 패턴 (아이콘 + subtitle + 설명 + 예시 이미지)
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
    exampleImage?: string;
    exampleFallback?: ReactNode;
    tone: { iconBg: string; iconColor: string; subtitleColor: string };
    selected?: boolean;
  }> = [
    {
      href: generatePath,
      Icon: PenLine,
      subtitle: '직접 글로 적어서 만들기',
      description: '원하는 내용을 자유롭게 입력하면 AI가 학습자료를 만들어드립니다.',
      exampleImage: '/generate-v2_intro_01.png',
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
      description: '내가 등록한 학교 이미지나 기관 이미지를 바탕으로 학습자료를 생성합니다.',
      exampleImage: '/generate-v2_intro_02.png',
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
      description: '공유 라이브러리의 클립아트와 템플릿을 선택해 학습자료를 만듭니다.',
      exampleImage: '/generate-v2_intro_03.png',
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
      description: '학년·과목·주제를 고르면 문제와 그림이 포함된 학습자료를 만듭니다.',
      exampleFallback: (
        <div className="flex h-full items-center justify-center gap-2 bg-primary/5 p-4">
          <GraduationCap className="h-8 w-8 text-primary" />
          <BookOpen className="h-8 w-8 text-primary/80" />
          <Palette className="h-8 w-8 text-primary/60" />
        </div>
      ),
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
              'card flex h-full flex-col gap-3 overflow-hidden p-4 transition',
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
            <div className="-mx-4 -mb-4 -mt-1 aspect-[16/9]">
              {item.exampleImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.exampleImage}
                  alt={`${item.subtitle} 예시`}
                  className="block h-full w-full object-cover"
                />
              ) : (
                item.exampleFallback
              )}
            </div>
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
          <div key={item.subtitle} className="block">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Input Card — dropdown 중심 + 단원 칩 + radio 그룹
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
  const selectCls =
    'h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

  const chipBase =
    'inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium transition';
  const chipSelected = 'border-2 border-primary bg-primary text-primary-foreground shadow-sm';
  const chipIdle =
    'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted';

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <NumberBadge>1</NumberBadge>
          수업 정보를 알려주세요
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 학년 / 과목 2열 dropdown */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">학년</Label>
            <select
              className={selectCls}
              value={form.grade}
              onChange={(e) => patch({ grade: Number(e.target.value) })}
            >
              {ALL_GRADES.map((g) => {
                const has = supportedSubjectsForGrade(supportMatrix, g).size > 0;
                return (
                  <option key={g} value={g} disabled={!has}>
                    {g}학년{!has ? ' (준비 중)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">과목</Label>
            <select
              className={selectCls}
              value={form.subject}
              onChange={(e) => patch({ subject: e.target.value as SubjectCode })}
            >
              {LEARNING_SUBJECTS.map((s) => {
                const has = supportedSubjects.has(s.code);
                return (
                  <option key={s.code} value={s.code} disabled={!has}>
                    {s.nameKo}
                    {gradeSupported && !has ? ' (준비 중)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* 자료 유형 / 수량 2열 dropdown */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">자료 유형</Label>
            <select
              className={selectCls}
              value={form.materialType}
              onChange={(e) => patch({ materialType: e.target.value as MaterialTypeCode })}
            >
              {LEARNING_MATERIAL_TYPES.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.nameKo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">{amountSpec.fieldLabel}</Label>
            <select
              className={selectCls}
              value={form.questionCount}
              onChange={(e) => patch({ questionCount: Number(e.target.value) })}
            >
              {amountSpec.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{amountSpec.helperText}</p>
          </div>
        </div>

        {/* 단원 (풀너비 칩) */}
        <div>
          <Label className="mb-2 block text-sm font-semibold">단원</Label>
          {!combinationSupported ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              {form.grade}학년 {SUBJECT_LABEL[form.subject as 'KOR' | 'MATH'] ?? form.subject}은
              아직 프로필이 준비되지 않았어요.
            </p>
          ) : unitsLoading ? (
            <p className="text-sm text-muted-foreground">단원 목록 불러오는 중…</p>
          ) : units.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 단원이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
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
                      <span
                        className={cn(
                          'ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                          selected
                            ? 'bg-primary-foreground/20 text-primary-foreground'
                            : 'bg-emerald-100 text-emerald-800',
                        )}
                      >
                        맞춤 프로필
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 세부 주제 + 도움받기 */}
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
            className="h-11 text-sm"
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

        {/* 추가 요청 */}
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

        {/* 배포 대상 / 출력 형식 radio */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-semibold">배포 대상</Label>
            <RadioRow
              options={VARIANT_OPTIONS.map((v) => ({ value: v.value, label: v.label, hint: v.hint }))}
              value={form.variant}
              onChange={(v) => patch({ variant: v as Variant })}
            />
          </div>
          <div>
            <Label className="mb-2 block text-sm font-semibold">출력 형식</Label>
            <RadioRow
              options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
              value={form.format}
              onChange={(v) => patch({ format: v as Format })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RadioRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            title={opt.hint}
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition',
              selected
                ? 'border-2 border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={`radio-${opt.value}`}
              checked={selected}
              onChange={() => onChange(opt.value)}
            />
            <span
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded-full border-2',
                selected ? 'border-primary bg-primary' : 'border-slate-300',
              )}
            >
              {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
            </span>
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

// ============================================================
// Recommendation Card — checkbox 3 항목 + full-width 생성 버튼
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
  const variantLabel = VARIANT_OPTIONS.find((v) => v.value === form.variant)?.label ?? '학생용';
  const formatLabel = FORMAT_OPTIONS.find((f) => f.value === form.format)?.label ?? 'PDF';

  const bullets = [
    {
      Icon: BookOpen,
      tone: 'bg-primary/10 text-primary',
      title: `${variantLabel} ${materialLabel} ${amountLabel}`,
      detail: `${form.grade}학년 수준에 맞춘 ${materialLabel} 문제로 구성`,
      check: true,
    },
    {
      Icon: GraduationCap,
      tone: 'bg-rose-100 text-rose-500',
      title: form.variant === 'student' ? '학생용 (정답 숨김)' : '교사용 정답·해설',
      detail:
        form.variant === 'student'
          ? '학생 배포용. 정답과 해설은 숨김'
          : '정답과 해설, 지도 방법까지 제공',
      check: true,
    },
    {
      Icon: Palette,
      tone: 'bg-emerald-100 text-emerald-600',
      title: `주제 맞춤 클립아트 · 출력 형식 ${formatLabel}`,
      detail: '선택한 출력 형식으로 즉시 다운로드. 클립아트 자동 삽입은 3단계 예정.',
      check: false,
    },
  ];

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <NumberBadge>2</NumberBadge>
            AI 추천 제작 구성
          </CardTitle>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            자동 추천됨
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="mb-4 text-sm text-muted-foreground">
          입력한 수업 정보에 맞춰 학습지 구성을 추천했어요.
        </p>
        <div className="flex-1 space-y-3">
          {bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                  b.tone,
                )}
              >
                <b.Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{b.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{b.detail}</div>
              </div>
              <div
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold',
                  b.check
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-300 bg-white text-slate-400',
                )}
              >
                {b.check ? '✓' : ''}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2.5">
            <span className="text-sm text-muted-foreground">예상 사용 크레딧</span>
            <span className="inline-flex items-center gap-1 text-xl font-bold text-primary">
              <Coins className="h-4 w-4 text-amber-500" /> {expectedCredits}
            </span>
          </div>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            size="lg"
            className="h-12 w-full text-base font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> AI가 학습지를 만들고 있어요…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" /> 학습자료 만들기
              </>
            )}
          </Button>
          {submitting && (
            <p className="text-center text-xs text-muted-foreground">
              AI 생성은 20~60초 걸릴 수 있어요. 이 화면을 닫지 말고 잠시만 기다려 주세요.
            </p>
          )}
          {!combinationSupported && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              현재 학년·과목은 준비 중이에요. 지원 조합을 선택하면 생성할 수 있어요.
            </p>
          )}
          {genError && (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-700">{genError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSubmit}
                disabled={submitting || !canSubmit}
                className="w-full text-xs"
              >
                <Loader2
                  className={cn('mr-2 h-3.5 w-3.5', submitting && 'animate-spin')}
                  aria-hidden="true"
                />
                다시 시도하기
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Preview — 생성 전 4개 예시 썸네일 / 생성 후 실 결과
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
          <p className="mb-4 text-sm text-muted-foreground">
            학습자료 만들기 버튼을 누르면 아래 네 가지 결과가 준비돼요. 아래는 <b>예시</b>입니다.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PreviewPlaceholder label="학생용 1" tone="primary" Icon={BookOpen} />
            <PreviewPlaceholder label="학생용 2" tone="primary" Icon={BookOpen} />
            <PreviewPlaceholder label="교사용" tone="rose" Icon={GraduationCap} />
            <PreviewPlaceholder label="클립아트" tone="emerald" Icon={Palette} note="3단계 예정" />
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

function PreviewPlaceholder({
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
  const toneBg =
    tone === 'primary' ? 'bg-primary/10' : tone === 'rose' ? 'bg-rose-100' : 'bg-emerald-100';
  const toneText =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'rose'
        ? 'text-rose-500'
        : 'text-emerald-600';
  return (
    <div className="relative flex aspect-[3/4] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="absolute right-2 top-2 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        예시
      </div>
      <div className={cn('flex flex-1 items-center justify-center', toneBg)}>
        <Icon className={cn('h-12 w-12', toneText)} />
      </div>
      <div className="flex items-center justify-between border-t border-border bg-card px-3 py-2 text-xs">
        <span className="font-semibold text-foreground">{label}</span>
        {note && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Utils
// ============================================================
function NumberBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
      {children}
    </span>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
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

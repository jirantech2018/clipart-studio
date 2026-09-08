// 학습지 만들기 페이지 클라이언트 shell (Phase 1 M2-1, v0.5).
//
// v0.5 변경:
//   - 단원(unit) 과 주제(topic) 필드 분리
//   - 추천은 "도움받기" 형태로 배치 (POST /api/learning/topic-suggestions)
//   - AI 추천 카드 명칭 변경 (기본 개념 익히기 / 생활 속에서 적용하기 / 생각을 넓혀 탐구하기)
//   - /generate 와 시각적 통일 (max-w-7xl, components/ui 재사용, header 톤)

'use client';

import { Download, HelpCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { LearningInputForm, type LearningInputValue } from './LearningInputForm';
import { LearningPreview } from './LearningPreview';
import { RecommendationCards, type Recommendation } from './RecommendationCards';

import type { LearningDocument } from '@/services/learning-renderer/schema';

interface Props {
  orgSlug: string;
  orgName: string;
  initialCredits: number;
}

const DEFAULT_INPUT: LearningInputValue = {
  grade: 1,
  subject: 'KOR',
  materialType: 'multiple_choice',
  unit: '',
  topic: '',
  questionCount: 5,
  difficulty: 'normal',
  additionalRequest: '',
};

interface GenerateResponse {
  jobId: string;
  documentId: string;
  document: LearningDocument;
  creditsUsed: number;
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function LearningPageClient({ orgSlug, orgName, initialCredits }: Props) {
  const [credits, setCredits] = useState(initialCredits);
  const [input, setInput] = useState<LearningInputValue>(DEFAULT_INPUT);

  // 단원 목록 (학년+과목 기반)
  const [units, setUnits] = useState<string[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  // 세부 주제 추천 (도움받기)
  const [suggestions, setSuggestions] = useState<Recommendation[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // 생성 상태
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  // 다운로드 상태
  const [downloading, setDownloading] = useState(false);

  // 학년·과목 변경 시 단원 목록 재조회 + 기존 선택 초기화
  useEffect(() => {
    let cancelled = false;
    async function loadUnits() {
      if (!input.grade || !input.subject) return;
      setUnitsLoading(true);
      try {
        const res = await fetch(
          `/api/learning/topics?grade=${input.grade}&subject=${input.subject}`,
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
    loadUnits();
    return () => {
      cancelled = true;
    };
  }, [input.grade, input.subject]);

  const handleInputChange = useCallback((patch: Partial<LearningInputValue>) => {
    setInput((prev) => ({ ...prev, ...patch }));
    // 학년/과목이 바뀌면 단원과 주제 초기화 + 추천 초기화
    if (patch.grade || patch.subject) {
      setInput((prev) => ({ ...prev, unit: '', topic: '' }));
      setSuggestions(null);
      setSuggestError(null);
    }
    // 자료유형/단원 바뀌면 추천만 초기화 (사용자 입력한 주제는 보존)
    if (patch.materialType || patch.unit) {
      setSuggestions(null);
      setSuggestError(null);
    }
  }, []);

  const handleRequestTopicSuggestions = useCallback(async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch('/api/learning/topic-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: input.grade,
          subject: input.subject,
          materialType: input.materialType,
          unit: input.unit,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ErrorBody | null;
        setSuggestError(body?.error?.message ?? '추천 실패');
        setSuggestions(null);
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
  }, [input.grade, input.subject, input.materialType, input.unit]);

  const handleSelectSuggestion = useCallback((rec: Recommendation) => {
    // 주제 필드에 추천 문구를 채우되, 사용자가 수정 가능 (그대로 input 값으로만).
    setInput((prev) => ({ ...prev, topic: rec.topic }));
  }, []);

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
          grade: input.grade,
          subject: input.subject,
          materialType: input.materialType,
          unit: input.unit,
          topic: input.topic.trim(),
          questionCount: input.questionCount,
          difficulty: input.difficulty,
          additionalRequest: input.additionalRequest.trim() || undefined,
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
  }, [orgSlug, input]);

  const handleDownloadPdf = useCallback(async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/learning/documents/${result.documentId}/render?format=pdf&variant=student`,
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
      const filename =
        utf8Match?.[1] !== undefined
          ? decodeURIComponent(utf8Match[1])
          : asciiMatch?.[1] !== undefined
            ? asciiMatch[1]
            : `${result.document.meta.title}-student.pdf`;
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
  }, [result]);

  return (
    // /generate 와 동일한 max-w-7xl · gap-6 · 반응형 shell
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 space-y-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          학습지 만들기
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Phase 1 M2-1
          </span>
        </h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-xs text-muted-foreground">
            {orgName} · 1~2학년 국어·수학 학습지 초안을 AI 로 만들고 학생용 PDF 로 내려받으세요.
            <br className="sm:hidden" />
            <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground/80">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              M2-1 은 UI 재설계 검증 단계입니다. AI 초안이며 반드시 교사 검토가 필요합니다.
            </span>
          </p>
          <div className="shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground">워크스페이스 크레딧</div>
            <div className="text-lg font-bold text-foreground">{credits}</div>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {/* 입력 폼 */}
        <LearningInputForm
          value={input}
          onChange={handleInputChange}
          onRequestTopicSuggestions={handleRequestTopicSuggestions}
          onSubmit={handleSubmit}
          submitting={submitting}
          suggesting={suggesting}
          units={units}
          unitsLoading={unitsLoading}
          disabled={submitting}
        />

        {/* 세부 주제 추천 (도움받기) */}
        {(suggesting || suggestions || suggestError) && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              {input.unit
                ? `‘${input.unit}’ 안의 세부 주제 3가지 추천`
                : '세부 주제 3가지 추천'}
              <span className="text-xs font-normal text-muted-foreground">
                (카드를 누르면 주제 칸에 채워지고 자유롭게 수정할 수 있어요)
              </span>
            </div>
            <RecommendationCards
              loading={suggesting}
              recommendations={suggestions}
              error={suggestError}
              onSelect={handleSelectSuggestion}
            />
          </div>
        )}

        {/* 생성 에러 */}
        {genError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="flex-1">
              <div className="font-semibold">생성 실패</div>
              <div>{genError}</div>
            </div>
            <Button variant="outline" size="sm" onClick={handleSubmit} disabled={submitting}>
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> 재시도
            </Button>
          </div>
        )}

        {/* 미리보기 + 다운로드 */}
        {result && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">미리보기 (학생용)</h2>
              <Button onClick={handleDownloadPdf} disabled={downloading}>
                {downloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> PDF 준비
                    중…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" /> 학생용 PDF 다운로드
                  </>
                )}
              </Button>
            </div>
            <LearningPreview document={result.document} variant="student" />
            <p className="mt-3 text-xs text-muted-foreground">
              문서 ID: {result.documentId} · Job ID: {result.jobId} · 소진 크레딧:{' '}
              {result.creditsUsed}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

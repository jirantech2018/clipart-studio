// 학습지 만들기 페이지 클라이언트 shell (Phase 1 M1).
//
// 데모 시나리오 (사용자 지시, 2026-09-07):
//   1학년 국어 → 자료유형(객관식/개별활동지) → 단원·주제 직접 입력 or AI 추천 3개
//   → 생성 → 미리보기 → PDF 다운로드

'use client';

import { Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';

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

  // AI 추천 상태
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);

  // 생성 상태
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  // 다운로드 상태
  const [downloading, setDownloading] = useState(false);

  const handleInputChange = useCallback((patch: Partial<LearningInputValue>) => {
    setInput((prev) => ({ ...prev, ...patch }));
    // 학년/과목/자료유형이 바뀌면 이전 추천 초기화
    if (patch.grade || patch.subject || patch.materialType) {
      setRecs(null);
      setRecsError(null);
    }
  }, []);

  const handleRequestRecs = useCallback(async () => {
    setRecsLoading(true);
    setRecsError(null);
    try {
      const res = await fetch('/api/learning/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: input.grade,
          subject: input.subject,
          materialType: input.materialType,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ErrorBody | null;
        setRecsError(body?.error?.message ?? '추천 실패');
        setRecs(null);
        return;
      }
      const body = (await res.json()) as { data: { recommendations: Recommendation[] } };
      setRecs(body.data.recommendations);
    } catch (err) {
      setRecsError((err as Error).message || '네트워크 오류');
    } finally {
      setRecsLoading(false);
    }
  }, [input.grade, input.subject, input.materialType]);

  const handleSelectRec = useCallback((rec: Recommendation) => {
    setInput((prev) => ({ ...prev, topic: `${rec.unit} · ${rec.topic}` }));
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
      // Content-Disposition 에서 filename 추출 시도
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
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Sparkles className="h-6 w-6 text-indigo-500" />
            학습지 만들기
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Phase 1 M1
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {orgName} · 1~2학년 국어·수학 학생용 학습지 · PDF 다운로드
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-right">
          <div className="text-xs text-slate-500">워크스페이스 크레딧</div>
          <div className="text-lg font-bold text-slate-900">{credits}</div>
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="mb-6 rounded-lg border-l-4 border-indigo-500 bg-indigo-50 p-3 text-sm text-indigo-900">
        <strong>M1 데모</strong> · 이 화면은 학습지 생성 흐름을 실제로 체험해 보시는 목적입니다.
        AI 초안이며 반드시 교사 검토가 필요합니다. Word/PPT · 교사용 · 클립아트 삽입은 M2 이후
        추가됩니다.
      </div>

      {/* 입력 폼 */}
      <div className="mb-4">
        <LearningInputForm
          value={input}
          onChange={handleInputChange}
          onRequestRecommendations={handleRequestRecs}
          onSubmit={handleSubmit}
          submitting={submitting}
          recommending={recsLoading}
          disabled={submitting}
        />
      </div>

      {/* 추천 카드 */}
      {(recsLoading || recs || recsError) && (
        <div className="mb-6">
          <RecommendationCards
            loading={recsLoading}
            recommendations={recs}
            error={recsError}
            onSelect={handleSelectRec}
          />
        </div>
      )}

      {/* 생성 에러 */}
      {genError && (
        <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="flex-1">
            <div className="font-semibold">생성 실패</div>
            <div>{genError}</div>
          </div>
          <Button variant="outline" size="sm" onClick={handleSubmit} disabled={submitting}>
            <RefreshCw className="mr-1 h-3 w-3" /> 재시도
          </Button>
        </div>
      )}

      {/* 미리보기 + 다운로드 */}
      {result && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">미리보기 (학생용)</h2>
            <Button onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> PDF 준비 중…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" /> 학생용 PDF 다운로드
                </>
              )}
            </Button>
          </div>
          <LearningPreview document={result.document} variant="student" />
          <p className="mt-3 text-xs text-slate-500">
            문서 ID: {result.documentId} · Job ID: {result.jobId} · 소진 크레딧:{' '}
            {result.creditsUsed}
          </p>
        </div>
      )}
    </div>
  );
}

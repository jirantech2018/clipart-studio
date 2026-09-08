'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface Recommendation {
  type: 'basic' | 'realworld' | 'inquiry';
  unit: string;
  topic: string;
  reason: string;
}

interface Props {
  loading: boolean;
  recommendations: Recommendation[] | null;
  error: string | null;
  onSelect: (rec: Recommendation) => void;
}

// M2-1 (v0.5) 명칭 조정 — 내부 값은 유지, 사용자 노출 문구만 변경.
const TYPE_LABEL: Record<Recommendation['type'], string> = {
  basic: '기본 개념 익히기',
  realworld: '생활 속에서 적용하기',
  inquiry: '생각을 넓혀 탐구하기',
};

const TYPE_COLOR: Record<Recommendation['type'], string> = {
  basic: 'border-indigo-300 bg-indigo-50 text-indigo-900',
  realworld: 'border-amber-300 bg-amber-50 text-amber-900',
  inquiry: 'border-emerald-300 bg-emerald-50 text-emerald-900',
};

export function RecommendationCards({ loading, recommendations, error, onSelect }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        추천 3개를 준비하고 있어요…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        추천 생성 실패: {error}
      </div>
    );
  }

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {recommendations.map((rec, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(rec)}
          className={`rounded-lg border-2 p-3 text-left transition hover:shadow-md ${TYPE_COLOR[rec.type]}`}
        >
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide">
            {TYPE_LABEL[rec.type]}
          </div>
          <div className="text-sm font-bold">{rec.unit}</div>
          <div className="mt-1 text-sm">{rec.topic}</div>
          <div className="mt-2 text-xs opacity-80">{rec.reason}</div>
          <div className="mt-2 text-xs font-semibold underline">이 주제로 선택 →</div>
        </button>
      ))}
    </div>
  );
}

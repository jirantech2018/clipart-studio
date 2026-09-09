// LearningDocument JSON 을 브라우저에서 HTML 로 렌더하는 미리보기 컴포넌트.
// PDF/DOCX/PPTX 서버 렌더와는 별도 (미리보기는 텍스트 중심, 이미지 없이도 OK).

'use client';

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';

interface Props {
  document: LearningDocument;
  variant?: 'student' | 'teacher' | 'combined';
  /** 서버가 사용한 생성 방식. 결과 카드 상단에 배지로 표시. */
  generationMode?: 'v1' | 'v2C';
  /** 병합된 프로필 체인 요약 (예: "초등 공통 → 2학년 수학 → 수학 수와 연산 영역"). */
  appliedProfile?: string;
}

const SUBJECT_LABEL: Record<string, string> = {
  KOR: '국어',
  MATH: '수학',
};

export function LearningPreview({
  document: doc,
  variant = 'student',
  generationMode,
  appliedProfile,
}: Props) {
  // student variant 는 answer-key 섹션 숨김, 인라인 정답 숨김.
  const visibleSections =
    variant === 'student' ? doc.sections.filter((s) => s.kind !== 'answer-key') : doc.sections;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      {/* meta bar */}
      <header className="mb-4 border-b-2 border-indigo-700 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-indigo-900">{doc.meta.title}</h2>
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
            {variant === 'student' ? '학생용' : variant === 'teacher' ? '교사용' : '학생 + 정답'}
          </span>
          {generationMode === 'v2C' && (
            <span
              className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
              title="공통 프롬프트 · 프로필 기반 (실험 모드)"
            >
              생성 방식: V2
            </span>
          )}
          {generationMode === 'v1' && (
            <span
              className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"
              title="기존 케이스별 프롬프트 · 3계층 검증"
            >
              생성 방식: V1
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {doc.meta.grade}학년 · {SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}
          {doc.meta.estimatedMinutes ? ` · 예상 ${doc.meta.estimatedMinutes}분` : ''}
          {' · '}AI 초안이며 교사 검토가 필요합니다.
        </p>
        {appliedProfile && appliedProfile !== '(활성 프로필 없음)' && (
          <p className="mt-1 text-xs text-emerald-700">
            적용된 프로필: <span className="font-medium">{appliedProfile}</span>
          </p>
        )}
        {appliedProfile === '(활성 프로필 없음)' && generationMode === 'v1' && (
          <p className="mt-1 text-xs text-slate-500">적용된 프로필: 없음 (기존 흐름 사용)</p>
        )}
      </header>

      <div className="space-y-4">
        {visibleSections.map((s, i) => (
          <SectionView key={`${s.kind}-${i}`} section={s} variant={variant} />
        ))}
      </div>
    </article>
  );
}

function SectionView({
  section,
  variant,
}: {
  section: Section;
  variant: 'student' | 'teacher' | 'combined';
}) {
  switch (section.kind) {
    case 'heading':
      if (section.level === 1) {
        return <h3 className="text-lg font-bold text-indigo-900">{section.text}</h3>;
      }
      if (section.level === 2) {
        return <h4 className="text-base font-semibold text-slate-800">{section.text}</h4>;
      }
      return <h5 className="text-sm font-semibold text-slate-700">{section.text}</h5>;

    case 'paragraph':
      return <p className="text-sm leading-relaxed text-slate-800">{section.text}</p>;

    case 'callout': {
      const bg =
        section.tone === 'warn'
          ? 'border-red-500 bg-red-50 text-red-800'
          : section.tone === 'tip'
            ? 'border-green-600 bg-green-50 text-green-800'
            : 'border-indigo-700 bg-indigo-50 text-indigo-800';
      return <div className={`border-l-4 px-3 py-2 text-sm ${bg}`}>{section.text}</div>;
    }

    case 'question': {
      const number = section.number ? `${section.number}. ` : '';
      return (
        <div className="rounded border border-slate-200 p-3">
          <div className="font-semibold text-slate-800">
            {number}
            {section.stem}
          </div>
          {section.choices && section.choices.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {section.choices.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          )}
          {section.hint && (
            <div className="mt-2 text-xs italic text-slate-500">💡 {section.hint}</div>
          )}
          {variant === 'teacher' && section.answer && (
            <div className="mt-2 text-xs font-semibold text-emerald-700">
              정답: {section.answer}
            </div>
          )}
        </div>
      );
    }

    case 'activity':
      return (
        <div className="rounded border border-slate-200 p-3">
          {section.title && (
            <div className="mb-1 font-semibold text-indigo-800">{section.title}</div>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {section.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {section.materials && section.materials.length > 0 && (
            <div className="mt-2 text-xs italic text-slate-500">
              준비물: {section.materials.join(', ')}
            </div>
          )}
          {section.estimatedMinutes && (
            <div className="mt-1 text-xs italic text-slate-500">
              예상 시간: {section.estimatedMinutes}분
            </div>
          )}
        </div>
      );

    case 'table':
      return (
        <table className="w-full border-collapse text-sm">
          {section.headers && section.headers.length > 0 && (
            <thead className="bg-indigo-50">
              <tr>
                {section.headers.map((h, i) => (
                  <th
                    key={i}
                    className="border border-slate-300 px-2 py-1 text-left font-semibold text-indigo-900"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {section.rows.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j} className="border border-slate-300 px-2 py-1 align-top text-slate-800">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'answer-key':
      return (
        <div className="mt-4 border-t-2 border-dashed border-slate-300 pt-3">
          <h4 className="mb-2 text-base font-semibold text-indigo-900">정답과 해설</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {section.entries.map((e, i) => (
              <li key={i}>
                <strong>{e.ref}</strong>: {e.answer}
                {e.rationale && (
                  <span className="ml-1 italic text-slate-500">— {e.rationale}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      );

    default:
      // image / rubric / slide-break 은 M1 UI 미리보기에서 렌더 안 함.
      return null;
  }
}

-- Migration: 079_learning_common_topics
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 목적:
--   학년·과목별 공통 학습 주제. AI 추천 3개의 seed 재료로 사용되며, 사용자 직접
--   입력과 병렬 UI 옵션.
--
-- 정책 (M1):
--   - 1~2학년 국·수만 seed (M1 관측 후 3~6학년 M2 이후 확대)
--   - unit(단원) + topic(세부 주제) 두 필드 분리 — M1 사용자 리뷰 후 통합 여부 결정
--   - keywords 배열은 AI 프롬프트에 힌트로 전달
--   - RLS 없이 SELECT 허용 (마스터 데이터)

CREATE TABLE IF NOT EXISTS public.learning_common_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade INT NOT NULL CHECK (grade BETWEEN 1 AND 6),
  subject_code TEXT NOT NULL REFERENCES public.learning_subjects(code) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  topic TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (grade, subject_code, unit, topic)
);

CREATE INDEX IF NOT EXISTS idx_learning_common_topics_grade_subject
  ON public.learning_common_topics(grade, subject_code, display_order)
  WHERE active = TRUE;

GRANT SELECT ON public.learning_common_topics TO anon, authenticated;

-- ============================================================
-- Seed: 1학년 국어 (2022 개정 교육과정 참고, 대표 단원·주제)
-- ============================================================
INSERT INTO public.learning_common_topics (grade, subject_code, unit, topic, keywords, display_order) VALUES
  (1, 'KOR', '한글의 자음과 모음', '자음자 익히기', ARRAY['ㄱㄴㄷ','자음','한글']::text[], 10),
  (1, 'KOR', '한글의 자음과 모음', '모음자 익히기', ARRAY['ㅏㅑㅓㅕ','모음','한글']::text[], 20),
  (1, 'KOR', '글자 익히기', '받침 없는 글자 읽기', ARRAY['글자','읽기','한글']::text[], 30),
  (1, 'KOR', '글자 익히기', '받침 있는 글자 읽기', ARRAY['받침','읽기']::text[], 40),
  (1, 'KOR', '낱말과 문장', '낱말의 뜻 알기', ARRAY['낱말','어휘','뜻']::text[], 50),
  (1, 'KOR', '낱말과 문장', '문장으로 말하기', ARRAY['문장','말하기']::text[], 60),
  (1, 'KOR', '이야기 듣기와 말하기', '동시 감상하기', ARRAY['동시','시','감상']::text[], 70),
  (1, 'KOR', '이야기 듣기와 말하기', '동화 듣고 이야기 나누기', ARRAY['동화','이야기']::text[], 80),
  (1, 'KOR', '쓰기 기초', '바르게 글자 쓰기', ARRAY['쓰기','바른자세']::text[], 90),
  (1, 'KOR', '쓰기 기초', '하고 싶은 말 짧게 쓰기', ARRAY['짧은글','쓰기']::text[], 100)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: 1학년 수학
-- ============================================================
INSERT INTO public.learning_common_topics (grade, subject_code, unit, topic, keywords, display_order) VALUES
  (1, 'MATH', '9까지의 수', '수 세기와 읽기', ARRAY['수세기','1-9']::text[], 10),
  (1, 'MATH', '9까지의 수', '수의 크기 비교', ARRAY['크기비교','크다작다']::text[], 20),
  (1, 'MATH', '여러 가지 모양', '모양 알아보기', ARRAY['모양','도형','원사각']::text[], 30),
  (1, 'MATH', '덧셈과 뺄셈', '10 이하 덧셈', ARRAY['덧셈','더하기']::text[], 40),
  (1, 'MATH', '덧셈과 뺄셈', '10 이하 뺄셈', ARRAY['뺄셈','빼기']::text[], 50),
  (1, 'MATH', '50까지의 수', '수 세기 (10~50)', ARRAY['수세기','10-50']::text[], 60),
  (1, 'MATH', '50까지의 수', '수의 순서와 크기', ARRAY['순서','크기']::text[], 70),
  (1, 'MATH', '비교하기', '길이 비교', ARRAY['길이','비교']::text[], 80),
  (1, 'MATH', '비교하기', '무게·들이 비교', ARRAY['무게','들이','비교']::text[], 90),
  (1, 'MATH', '시계 보기', '몇 시 알아보기', ARRAY['시계','시간']::text[], 100)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: 2학년 국어
-- ============================================================
INSERT INTO public.learning_common_topics (grade, subject_code, unit, topic, keywords, display_order) VALUES
  (2, 'KOR', '낱말의 확장', '낱말의 뜻 정확히 알기', ARRAY['낱말','뜻','어휘']::text[], 10),
  (2, 'KOR', '낱말의 확장', '흉내 내는 말 알기', ARRAY['흉내내는말','의성어','의태어']::text[], 20),
  (2, 'KOR', '문장 짜임', '문장 부호 바르게 쓰기', ARRAY['문장부호','마침표']::text[], 30),
  (2, 'KOR', '문장 짜임', '완성된 문장 만들기', ARRAY['문장','완성']::text[], 40),
  (2, 'KOR', '이야기 읽기', '이야기의 인물과 사건', ARRAY['인물','사건','이야기']::text[], 50),
  (2, 'KOR', '이야기 읽기', '이야기의 흐름 파악하기', ARRAY['이야기','흐름','순서']::text[], 60),
  (2, 'KOR', '설명하는 글', '설명하는 글 읽기', ARRAY['설명글','읽기']::text[], 70),
  (2, 'KOR', '설명하는 글', '차례에 맞게 설명하기', ARRAY['차례','설명']::text[], 80),
  (2, 'KOR', '느낌 나누기', '시를 읽고 느낌 표현하기', ARRAY['시','느낌']::text[], 90),
  (2, 'KOR', '느낌 나누기', '겪은 일 표현하기', ARRAY['경험','일기']::text[], 100)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: 2학년 수학
-- ============================================================
INSERT INTO public.learning_common_topics (grade, subject_code, unit, topic, keywords, display_order) VALUES
  (2, 'MATH', '세 자리 수', '100과 1000까지 알기', ARRAY['세자리수','수세기']::text[], 10),
  (2, 'MATH', '세 자리 수', '수의 크기 비교', ARRAY['크기비교','자릿값']::text[], 20),
  (2, 'MATH', '덧셈과 뺄셈', '받아올림이 있는 덧셈', ARRAY['덧셈','받아올림']::text[], 30),
  (2, 'MATH', '덧셈과 뺄셈', '받아내림이 있는 뺄셈', ARRAY['뺄셈','받아내림']::text[], 40),
  (2, 'MATH', '곱셈', '묶어 세기와 곱셈의 뜻', ARRAY['곱셈','묶어세기']::text[], 50),
  (2, 'MATH', '곱셈구구', '2·5·3·6단 곱셈구구', ARRAY['곱셈구구','구구단']::text[], 60),
  (2, 'MATH', '곱셈구구', '4·8·7·9단 곱셈구구', ARRAY['곱셈구구','구구단']::text[], 70),
  (2, 'MATH', '길이 재기', '자와 cm 알기', ARRAY['길이','cm','자']::text[], 80),
  (2, 'MATH', '시각과 시간', '몇 시 몇 분', ARRAY['시계','시각','분']::text[], 90),
  (2, 'MATH', '표와 그래프', '표와 그래프로 나타내기', ARRAY['표','그래프']::text[], 100)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

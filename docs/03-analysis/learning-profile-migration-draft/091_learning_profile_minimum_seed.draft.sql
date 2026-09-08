-- DRAFT — 원격 apply 금지. 스키마 (084~090) apply 검증 후 별도 apply.
--
-- Migration draft: 091_learning_profile_minimum_seed
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   최소 seed. 1~6학년 전체가 아니라 검증 스코프만 (초등 공통 + 1~2학년 국·수 +
--   대표 영역/단원 프로필). draft 상태로만 삽입. 회귀 통과 전 active 전환 X.
--
-- ⚠ 반드시 스키마 마이그레이션 (084~089) apply 완료 후 이 파일 apply.
--
-- Seed 대상:
--   - profile_set: KR_ELEM_2022_V1
--   - domains: 국어 읽기, 수학 수와 연산
--   - profiles (draft):
--       초등 공통 / 1학년 국어 / 2학년 국어 / 1학년 수학 / 2학년 수학 /
--       국어 읽기 영역 / 수학 수와 연산 영역 /
--       1학년 국어 "낱말과 문장" 단원 / 2학년 수학 "덧셈과 뺄셈" 단원
--
-- ⚠ 단원명은 실제 learning_common_topics.unit 값과 정확히 일치해야 함.
--   현재 seed 기준 아래 두 단원명이 이미 존재하는지 확인:
--     · 1학년 · KOR · "낱말과 문장"
--     · 2학년 · MATH · "덧셈과 뺄셈"

-- 1) profile_set
INSERT INTO public.learning_profile_sets (code, name, curriculum_version, status, description)
VALUES (
  'KR_ELEM_2022_V1',
  '2022 개정 초등 교육 프로필 v1',
  '2022_REVISED',
  'draft',
  '1~6학년 전체 확장 전 최소 검증용 프로필 세트'
) ON CONFLICT (code) DO NOTHING;

-- profile_set_id 조회 CTE 대신 별도 SELECT 사용
-- (Postgres INSERT ... SELECT 로 seed. 실제 apply 시 psql 세션에서 순차 실행)

-- 2) domains
INSERT INTO public.learning_domains (subject_code, code, name, sort_order)
VALUES
  ('KOR', 'KOR_READING', '읽기', 10),
  ('KOR', 'KOR_WRITING', '쓰기', 20),
  ('KOR', 'KOR_GRAMMAR', '문법', 30),
  ('MATH', 'MATH_NUMBER_OPS', '수와 연산', 10)
ON CONFLICT (subject_code, code) DO NOTHING;

-- 3) profiles (draft) — profile_set_id 는 서브쿼리로.
--
-- 3-a) 초등 공통 (curriculum scope)
INSERT INTO public.learning_profiles (
  profile_set_id, scope_type, grade_min, grade_max,
  title, description, learning_goals, deterministic_rules, semantic_criteria
)
SELECT
  ps.id,
  'curriculum',
  1, 6,
  '초등 공통 프로필',
  '학년·과목 무관 공통 원칙',
  '[{"code":"COMMON-1","description":"학생 스스로 이해할 수 있는 자기완결성 유지","required":true}]'::JSONB,
  '{"multipleChoice":{"choiceCount":4,"requiredCorrectAnswerCount":1,"allowDuplicateChoices":false}}'::JSONB,
  '[{"key":"selfContained","label":"자기완결성","required":true,"instruction":"이미지 없이도 학생이 stem 만으로 정답을 결정할 수 있어야 한다"},{"key":"hintLeakage","label":"힌트 정답 노출 방지","required":true,"instruction":"힌트가 정답·동의어·활용형을 그대로 담지 않아야 한다"}]'::JSONB
FROM public.learning_profile_sets ps
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id = ps.id
      AND p.scope_type = 'curriculum'
      AND p.title = '초등 공통 프로필'
  );

-- 3-b) 1학년 국어 (grade_subject)
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, scope_type, grade_min, grade_max,
  title, vocabulary_guidance, semantic_criteria
)
SELECT ps.id, 'KOR', 'grade_subject', 1, 1,
  '1학년 국어',
  '{"readingLevel":"1학년","maxSentenceLength":15,"useConcreteVocabulary":true,"avoid":["추상적 한자어","이중 부정"],"notes":["한 문장에는 한 가지 지시만"]}'::JSONB,
  '[{"key":"gradeSuitability","required":true,"instruction":"1학년 어휘·문장 길이 준수"}]'::JSONB
FROM public.learning_profile_sets ps
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id = ps.id AND p.scope_type='grade_subject'
      AND p.subject_code='KOR' AND p.grade_min=1
  );

-- 3-c) 2학년 국어
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, scope_type, grade_min, grade_max,
  title, vocabulary_guidance
)
SELECT ps.id, 'KOR', 'grade_subject', 2, 2,
  '2학년 국어',
  '{"readingLevel":"2학년","maxSentenceLength":25}'::JSONB
FROM public.learning_profile_sets ps
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='grade_subject'
      AND p.subject_code='KOR' AND p.grade_min=2
  );

-- 3-d) 1학년 수학
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, scope_type, grade_min, grade_max, title
)
SELECT ps.id, 'MATH', 'grade_subject', 1, 1, '1학년 수학'
FROM public.learning_profile_sets ps
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='grade_subject'
      AND p.subject_code='MATH' AND p.grade_min=1
  );

-- 3-e) 2학년 수학
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, scope_type, grade_min, grade_max, title
)
SELECT ps.id, 'MATH', 'grade_subject', 2, 2, '2학년 수학'
FROM public.learning_profile_sets ps
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='grade_subject'
      AND p.subject_code='MATH' AND p.grade_min=2
  );

-- 3-f) 국어 읽기 영역
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, domain_id, scope_type, grade_min, grade_max,
  title, semantic_criteria
)
SELECT ps.id, 'KOR', d.id, 'domain', 1, 6, '국어 읽기 영역',
  '[{"key":"topicAlignment","required":true,"instruction":"제시된 낱말·문장·짧은 글을 읽고 판단하는 형식"}]'::JSONB
FROM public.learning_profile_sets ps
JOIN public.learning_domains d ON d.subject_code='KOR' AND d.code='KOR_READING'
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='domain'
      AND p.subject_code='KOR' AND p.domain_id=d.id
  );

-- 3-g) 수학 수와 연산 영역
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, domain_id, scope_type, grade_min, grade_max,
  title, deterministic_rules
)
SELECT ps.id, 'MATH', d.id, 'domain', 1, 6, '수학 수와 연산 영역',
  '{"math":{"allowsNegative":false,"allowsDecimal":false}}'::JSONB
FROM public.learning_profile_sets ps
JOIN public.learning_domains d ON d.subject_code='MATH' AND d.code='MATH_NUMBER_OPS'
WHERE ps.code = 'KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='domain'
      AND p.subject_code='MATH' AND p.domain_id=d.id
  );

-- 3-h) 1학년 국어 "낱말과 문장" 단원 (실 seed 확인 필요)
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, unit_name, scope_type, grade_min, grade_max, title,
  recommended_scope, semantic_criteria
)
SELECT ps.id, 'KOR', '낱말과 문장', 'unit', 1, 1, '1학년 국어 · 낱말과 문장',
  NULL,
  '[{"key":"topicAlignment","required":true,"instruction":"낱말·짧은 문장 수준을 벗어난 문항 금지. 자모(자음/모음) 식별로 대체 금지."}]'::JSONB
FROM public.learning_profile_sets ps
WHERE ps.code='KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='unit'
      AND p.subject_code='KOR' AND p.grade_min=1 AND p.unit_name='낱말과 문장'
  );
-- ⚠ recommended_scope 컬럼 확인 필요. 위 draft 스키마에는 없음. 실제 apply 시엔
--    allowed_scope / excluded_scope JSONB 를 사용. 이 seed 는 예시라 컬럼 미스매치.
--    최종 apply 전 컬럼명 맞춤.

-- 3-i) 2학년 수학 "덧셈과 뺄셈" 단원
INSERT INTO public.learning_profiles (
  profile_set_id, subject_code, unit_name, scope_type, grade_min, grade_max, title,
  deterministic_rules, semantic_criteria
)
SELECT ps.id, 'MATH', '덧셈과 뺄셈', 'unit', 2, 2, '2학년 수학 · 덧셈과 뺄셈',
  '{"math":{"operationSet":["addition","subtraction"],"numberRange":{"min":0,"max":100},"requiresCarry":true,"allowsNegative":false,"allowsDecimal":false}}'::JSONB,
  '[{"key":"topicAlignment","required":true,"instruction":"두 자리 수 덧셈·뺄셈만. 곱셈·나눗셈·분수 금지"}]'::JSONB
FROM public.learning_profile_sets ps
WHERE ps.code='KR_ELEM_2022_V1'
  AND NOT EXISTS (
    SELECT 1 FROM public.learning_profiles p
    WHERE p.profile_set_id=ps.id AND p.scope_type='unit'
      AND p.subject_code='MATH' AND p.grade_min=2 AND p.unit_name='덧셈과 뺄셈'
  );

-- 프로필은 모두 draft 로만 남음. active 전환은 회귀 테스트 통과 후 별도 UPDATE.

NOTIFY pgrst, 'reload schema';

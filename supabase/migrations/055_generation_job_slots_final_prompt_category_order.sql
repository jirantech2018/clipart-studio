-- Migration: 055_generation_job_slots_final_prompt_category_order
--
-- Phase 2 보완 — Slot 실행 정보를 확장한다.
--
--   final_prompt   : runPackageSlot 가 외부 이미지 생성 API 에 실제로 전달한
--                    최종 Prompt 문자열을 그대로 저장. 디버깅 / 재생성 / Prompt
--                    품질 개선 / 실패 분석의 근거가 된다. UI 입력이 아니라
--                    조립 결과.
--   category_order : 동일 category 내부에서의 순서 (0 부터). 기존 `order`
--                    컬럼은 패키지 전역 순서로 그대로 유지. Phase 3 그룹 UI
--                    가 category 내부 순서를 별도 계산 없이 사용할 수 있게
--                    한다.
--
-- 하위호환:
--   final_prompt 는 nullable — Legacy row 는 NULL 로 남는다.
--   category_order 는 NOT NULL DEFAULT 0. Legacy row 는 0 으로 채워지므로
--   같은 category 안에서 순서 구분이 사라진다. 아래 backfill 로 기존 데이터
--   의 category 내부 순서를 `order` 기준으로 재계산해 안전하게 넣어둔다.

ALTER TABLE public.generation_job_slots
  ADD COLUMN IF NOT EXISTS final_prompt TEXT,
  ADD COLUMN IF NOT EXISTS category_order INT NOT NULL DEFAULT 0;

-- Legacy rows backfill — 기존 slot 들의 category_order 를 order 기준으로 채운다.
-- Phase 2 에서 이미 생성된 slot 은 실질적으로 없을 가능성이 크지만, 안전을
-- 위해 실행한다.
UPDATE public.generation_job_slots gs
SET category_order = sub.rn - 1
FROM (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY job_id, category ORDER BY "order") AS rn
  FROM public.generation_job_slots
) sub
WHERE gs.id = sub.id
  AND gs.category_order = 0;

-- 기존 package_plan snapshot 에 version 필드 추가 (없는 경우만). App 레이어
-- (schemas.ts) 는 version 을 optional/default(1) 로 파싱하므로 이 backfill 이
-- 없어도 오류는 없지만, DB 를 눈으로 봤을 때 version 이 없으면 어떤 스키마
-- 로 저장된 건지 판단이 어렵다. 명시적으로 1 을 표시한다.
UPDATE public.generation_jobs
SET package_plan = jsonb_set(package_plan, '{version}', '1'::jsonb, TRUE)
WHERE kind = 'package'
  AND package_plan IS NOT NULL
  AND NOT (package_plan ? 'version');

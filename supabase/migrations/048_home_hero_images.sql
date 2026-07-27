-- Migration: 048_home_hero_images
--
-- 목적:
--   홈 페이지 상단 히어로 배너 배경으로 쓸 이미지를 관리자가 별개 카탈로그로
--   등록할 수 있게 한다. 지금까지는 knowledge 시스템의 positive+primary
--   이미지를 재활용했지만, 홈 배너 톤이 knowledge 참고 이미지 톤과 달라
--   전용 슬롯이 필요.
--
-- 접근 제어:
--   업로드/삭제/조회 모두 관리자 (ADMIN_EMAIL) 만. 서버 라우트에서 isAdmin
--   게이팅 + service_role 로 테이블 접근. 홈 페이지 SSR 도 service_role 로
--   랜덤 하나 조회 (RLS 는 authenticated / anon 을 모두 막아둠).
--
-- 컬럼:
--   sort_order  — 관리자가 순서 조정을 원할 때 대비 (현재 UI 미제공, 등록순 표시)
--   enabled     — 삭제 대신 잠시 숨김이 필요한 경우 대비 (기본 true)

-- 재실행 안전 (IF NOT EXISTS). 이미 CREATE 만 부분 성공한 뒤 인덱스/RLS/GRANT
-- 만 반영하려는 경우도 그대로 통과.

CREATE TABLE IF NOT EXISTS public.home_hero_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT,
  width INT NOT NULL,
  height INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_hero_enabled_order
  ON public.home_hero_images(enabled, sort_order, created_at DESC);

ALTER TABLE public.home_hero_images ENABLE ROW LEVEL SECURITY;
-- 정책을 하나도 만들지 않아 RLS 는 authenticated/anon 모두 차단.
-- 접근은 service_role 로만 가능 (홈 SSR + admin API).

GRANT ALL ON public.home_hero_images TO service_role;

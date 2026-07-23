-- Migration: 046_generation_jobs_org_id
--
-- P5-D-C: /generate?org=<slug> 컨텍스트를 서버 파이프라인이 소비할 수 있게
-- generation_jobs 에 org_id 스냅샷을 추가한다.
--
--   * job 생성 시점에 결정된 조직 컨텍스트를 붙잡아 둔다 (이후 조직 설정이
--     바뀌더라도 진행 중인 job 은 저장 시점의 base_prompt 를 사용).
--   * 조직이 삭제되면 SET NULL 로 떨어져 pipeline 이 조직 없이 개인 컨텍스트
--     처럼 취급 (안전 폴백).
--   * 생성된 images 는 여전히 개인 소유 (users_id = auth.uid()) — 이번
--     마이그레이션은 소유권 정책을 바꾸지 않는다.

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS org_id UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Migration: 036_consolidate_admin_role
--
-- 배경:
--   조직 역할 모델을 단순화 (4단계 → 실질 2단계).
--   * owner  : 조직 생성자 (어드민, UI 상 "어드민")
--   * editor : 그 외 모두 (UI 상 "멤버")
--   admin / viewer 는 스키마상 남기지만 실제 데이터에서는 사용 중단.
--
-- 이 마이그레이션이 하는 일:
--   1) organization_members 에서 role='admin' 인 행을 모두 'editor' 로 UPDATE.
--   2) 아직 수락되지 않고 취소되지 않은 organization_invites 중
--      role='admin' 인 것도 'editor' 로 UPDATE. (이미 수락된 초대는 히스토리
--      보존 차원에서 그대로 둠 — 어차피 UI 는 members.role 을 기준으로 표시.)
--
-- 안전성:
--   - CHECK constraint 나 enum 은 그대로 유지 → 롤백 시 admin 값 다시 사용 가능.
--   - viewer 는 이번에 건드리지 않음 (지금까지 초대 시 admin 만 발급된 것으로
--     추정. viewer 데이터가 있으면 추후 필요 시 별도 정리).

UPDATE public.organization_members
SET role = 'editor'
WHERE role = 'admin';

UPDATE public.organization_invites
SET role = 'editor'
WHERE role = 'admin'
  AND accepted_at IS NULL
  AND revoked_at IS NULL;

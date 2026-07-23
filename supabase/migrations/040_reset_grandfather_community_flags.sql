-- Migration: 040_reset_grandfather_community_flags
--
-- 배경 (P5-C Phase B-1 후속):
--   Migration 038 이 도입되기 전에 개인이 직접 커뮤니티에 공개해둔 이미지
--   ("grandfather") 를 개인 라이브러리 전용 상태로 리셋한다. 앞으로 커뮤니티
--   공개는 "개인 → 조직 → 공유 라이브러리" 경로만 허용되므로, 소스가 확인
--   되지 않는 옛 공개 이미지는 일괄 비공개로 되돌려 큐레이션 원칙과 일치
--   시킨다.
--
-- 대상 (정확히 grandfather 정의):
--   is_on_community = TRUE
--   AND community_source_organization_id IS NULL
--   AND community_published_by IS NULL
--   AND community_published_at IS NULL
--
-- 처리:
--   is_on_community 만 FALSE 로. 나머지 세 큐레이션 컬럼은 이미 NULL 이므로
--   손대지 않는다. 처리 후 CHECK images_community_curated_ck 의 (a) 조건
--   (is_on_community=FALSE) 을 자연히 만족.
--
-- 안전성:
--   - 원본 이미지·개인 라이브러리 데이터는 삭제하지 않음. is_on_community
--     플래그만 뒤집는다.
--   - 정식 큐레이션된 이미지(source_org 채워진 것) 는 WHERE 조건에서 제외.
--   - grandfather 데이터가 없는 환경(스테이징/로컬) 에서는 UPDATE 가 0 행에
--     매치되므로 no-op 로 안전하게 재실행 가능.
--   - 실행 전 프로덕션에서는 `backup_grandfather_reset_040` 로 스냅샷을 남긴
--     뒤 이 UPDATE 를 돌렸다 (실 데이터 조작 이력 보존 목적).

UPDATE public.images
SET is_on_community = FALSE
WHERE is_on_community = TRUE
  AND community_source_organization_id IS NULL
  AND community_published_by IS NULL
  AND community_published_at IS NULL;

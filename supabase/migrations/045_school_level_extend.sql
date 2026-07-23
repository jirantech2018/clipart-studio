-- Migration: 045_school_level_extend
--
-- 배경:
--   school_level_enum 이 elementary/middle/high 3개만이었으나, 조직 설정 UI 에서
--   유치원과 특수학교(기타) 도 선택할 수 있어야 한다는 요구.
--
-- 이 마이그레이션이 하는 일:
--   ALTER TYPE ADD VALUE 로 'kindergarten', 'other' 두 값을 추가한다.
--   기존 3개 값은 그대로 유지되며 (동일 라벨), 앱 코드는 5개 값을 모두
--   지원하도록 새로 배포된다.
--
-- 안전성:
--   IF NOT EXISTS 로 여러 번 실행해도 안전.
--   같은 마이그레이션 파일 내에서 새 값을 즉시 사용하지 않으므로 트랜잭션
--   내 실행 제한도 걸리지 않는다.

ALTER TYPE public.school_level_enum ADD VALUE IF NOT EXISTS 'kindergarten';
ALTER TYPE public.school_level_enum ADD VALUE IF NOT EXISTS 'other';

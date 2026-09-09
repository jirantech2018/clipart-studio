# Migration History Mapping (Draft)

> **⚠ DRAFT · 커밋 대기 · 원격 대조 필요**
> 이 문서는 로컬 `supabase/migrations/` 79개 파일과 033b 1개(스킵)를 스캔하여
> 각 마이그레이션의 산출물을 추출한 결과입니다. 원격 실제 스키마 대조는 후속
> Q11 (§5) 쿼리팩 실행 후 완료됩니다.
>
> 이 문서 자체는 어떤 원격 상태 변경도 유발하지 않습니다.

---

## 0. 요약

| 지표 | 값 |
|---|---|
| 로컬 파일 총계 | 79 (001~083 중 003~007 결번 + 033b 서브넘버) |
| CLI 인식 (`supabase migration list`) | 78 |
| CLI 스킵 | 1 (`033b_community_view_expand.sql`) |
| 원격 이력 (`supabase_migrations.schema_migrations`) | 부재 (Q9 재확인 결과 42P01) |
| 신규 draft 파일 (docs/03-analysis/learning-profile-migration-draft/) | 8 (084~091) |
| 원격 실제 스키마 적용 | 084~090 확정 (Q1~Q6 결과), 091 seed 전량 롤백, 001~083 잠정 확인 (Q10-a/b/c 대조로 정밀화 필요) |

---

## 1. 원격 확인 없이 확정 가능한 사실

**로컬 파일 스캔만으로 확정** (원격 대조 무관):

- 084~091 draft 파일 안에는 기존 001~083 테이블에 대한 `ALTER`/`DROP`/`INSERT`/`UPDATE`/`DELETE` 명령이 **없다** (전부 `CREATE TABLE IF NOT EXISTS`만).
- 애플리케이션 코드(`src/`)는 084~090 신규 테이블을 참조하지 **않는다** (grep 재확인, 0건).
- 033b 파일은 `CREATE OR REPLACE VIEW public.community_images AS ...` 하나뿐이며, 이후 041 · 077이 같은 뷰를 재정의하며 이 정의를 **덮어썼다** (뷰 lineage §4 참조).
- 087_learning_profile_material_types의 `material_type_code`가 `learning_material_types.code` FK를 갖는데, 후자는 080에서 생성됨 → 순서 의존성 정상.
- 091 seed의 3-h가 존재하지 않는 컬럼 `recommended_scope`를 참조하는 것은 draft 자체 결함 (086 draft와 실 스키마 모두 이 컬럼 없음, 대체 컬럼은 `allowed_scope` JSONB).

**원격 확인 필요**:

- 001~083 각각의 대표 산출물이 원격 public 스키마에 존재하는지 정확히 대조 (§3.2 표 최우측 열).

---

## 2. Migration별 산출물 매핑표

**컬럼 범례**:
- **테이블**: `CREATE TABLE` 또는 `ALTER TABLE ADD COLUMN` 대상
- **컬럼 변경**: 신규 컬럼 · 삭제 컬럼 · 타입 변경 · CHECK/DEFAULT 조정
- **인덱스**: `CREATE INDEX` / `DROP INDEX` (부분 index 조건 포함)
- **RLS**: `CREATE POLICY` (정책명 · cmd) / `DROP POLICY` / `ALTER TABLE ENABLE RLS`
- **함수·트리거**: `CREATE OR REPLACE FUNCTION` (시그니처) / `CREATE TRIGGER`
- **Seed·DML**: `INSERT` / `UPDATE` / `DELETE` (마이그레이션 시점 데이터 조작)
- **DROP·대체**: `DROP TABLE/VIEW/POLICY/FUNCTION/TRIGGER/COLUMN`
- **판정 근거**: 이 마이그레이션이 실제 원격 반영됐는지 확인할 대표 객체 (Q10 대조용)

### 2.1 001~040 (프로필 · 이미지 · 조직 도입)

| # | 파일 | 테이블·컬럼 | 인덱스 | RLS | 함수·트리거 | Seed·DML | DROP·대체 | 판정 근거 |
|---|---|---|---|---|---|---|---|---|
| 001 | 001_profiles.sql | ENUM `account_type_enum`; **CREATE TABLE `profiles`** (id/email/account_type/credits/credits_reset_at/created_at) | `idx_profiles_reset` (partial) | — | FUNCTION `handle_new_user()` v1; TRIGGER `on_auth_user_created` ON auth.users | — | — | `profiles` 존재 + ENUM `account_type_enum` + `handle_new_user` 존재 |
| 002 | 002_school_profiles.sql | ENUM `school_level_enum`; **CREATE TABLE `school_profiles`** | — | — | FUNCTION `touch_school_profile_updated_at()`; TRIGGER `school_profiles_updated_at` | — | — | `school_profiles` 존재 + ENUM 값(elementary/middle/high) |
| 008 | 008_functions_credits.sql | — | — | — | FUNCTION `reserve_credits(UUID,INT)`; `refund_credits(UUID,INT)`; `monthly_credit_reset(INT)` | — | — | 3개 함수 시그니처 존재 |
| 009 | 009_rls_auth.sql | — | — | POLICY `profiles_select_own`, `profiles_update_own`, `sp_select_own`, `sp_insert_own`, `sp_update_own`, `sp_delete_own`; ENABLE RLS on profiles, school_profiles | — | — | — | 위 6개 정책 존재 + 두 테이블 rowsecurity=true |
| 010 | 010_grants.sql | — | — | — | — | — | — | GRANT (has_table_privilege('authenticated','profiles','SELECT')=true) |
| 011 | 011_images.sql | ENUM `image_status_enum`, `generation_mode_enum`; **CREATE TABLE `images`** (18 컬럼) + `search_vector` GENERATED | 6개 (`idx_images_user_status`, `_public`, `_pending_expires`, `_parent`, `_batch`, `_search` GIN) | — | — | — | — | `images` 테이블 + `search_vector` GENERATED 컬럼 |
| 012 | 012_image_tags.sql | **CREATE TABLE `image_tags`** | `idx_tags_tag` | — | — | — | — | `image_tags` 존재 |
| 013 | 013_image_categories.sql | **CREATE TABLE `image_categories`** | `idx_categories_category` | — | — | — | — | `image_categories` 존재 |
| 014 | 014_generation_jobs.sql | ENUM `job_status_enum`; **CREATE TABLE `generation_jobs`** | `idx_jobs_active_per_user` (unique partial), `idx_jobs_user_created` | — | — | — | — | `generation_jobs` + `job_status_enum` 존재 |
| 015 | 015_download_events.sql | **CREATE TABLE `download_events`** (event_type CHECK 3종) | `idx_events_user_created`, `idx_events_image` | — | — | — | — | `download_events` 존재 (event_type CHECK는 077에서 확장) |
| 016 | 016_rls_images_jobs.sql | — | — | POLICY `images_select_own_or_public` (later dropped 032), `images_insert_own`, `images_update_own` (later dropped 034), `images_delete_own`; `tags_select` (dropped 032/034), `categories_select` (dropped 032/034); `jobs_own`; `dl_select_own`; ENABLE RLS | — | — | — | GRANT 존재 확인 |
| 017 | 017_pending_cleanup.sql | — | — | — | EXTENSION pg_cron; FUNCTION `cleanup_pending_images()`; cron.schedule 'cleanup-pending-images-hourly' | — | — | (**019에서 완전 제거됨**) — 판정 방법: 019 적용 여부로 판정 |
| 018 | 018_service_role_grants.sql | — | — | — | — | — | — | GRANT service_role on images 계열 |
| 019 | 019_no_pending_lifecycle.sql | — | — | — | — | UPDATE images SET status='saved' WHERE 'pending'; cron.unschedule 'cleanup-pending-images-hourly' | DROP FUNCTION `cleanup_pending_images()` | 함수 부재 확인 + cron.job 부재 |
| 020 | 020_community_images_view.sql | **CREATE VIEW `community_images`** v1 (author_type, author_school_name) | — | — | — | — | — | 뷰 존재 (후속 재정의로 이 정의는 남지 않음) |
| 021 | 021_community_download_count.sql | REPLACE VIEW `community_images` v2 (+ download_count) | — | — | — | — | — | (후속 재정의로 이 정의는 남지 않음) |
| 022 | 022_monthly_credit_reset.sql | — | — | — | FUNCTION `monthly_credit_reset()` (인자 0개 오버로드 추가); cron.schedule 'monthly-credit-reset-daily' | — | — | 함수 `monthly_credit_reset()` 인자 0개 오버로드 존재 |
| 023 | 023_admin_settings.sql | **CREATE TABLE `admin_settings`** | — | POLICY `admin_settings_read_all` | — | INSERT id=1 default system_prompt | (**031에서 DROP CASCADE**) | 031 적용 여부로 판정 |
| 024 | 024_aspect_ratio.sql | ENUM `aspect_ratio_enum`; ADD COLUMN `generation_jobs.aspect_ratio`, `images.width`, `images.height` | — | — | — | — | REPLACE VIEW `community_images` v3 (+ width/height) | ENUM 존재 + images.width/height 컬럼 + generation_jobs.aspect_ratio |
| 025 | 025_reference_images.sql | **CREATE TABLE `reference_images`**; ADD COLUMN `generation_jobs.custom_reference_r2_key` | `idx_reference_images_user` | POLICY `reference_images_select_own`, `_insert_own`, `_delete_own`; ENABLE RLS | FUNCTION `enforce_reference_image_limit()`; TRIGGER `trg_enforce_reference_image_limit` | — | — | 테이블 + 함수 + 컬럼 |
| 026 | 026_reference_images_grants.sql | — | — | — | — | — | — | GRANT authenticated/service_role on reference_images |
| 027 | 027_batch_size_range.sql | ALTER TABLE `generation_jobs` DROP + ADD CONSTRAINT `generation_jobs_batch_size_range` (1..50) | — | — | — | — | (기존 batch_size CHECK 대체) | constraint명 `generation_jobs_batch_size_range` 존재 |
| 028 | 028_prompt_rules.sql | **CREATE TABLE `prompt_rules`** | 2개 | POLICY `prompt_rules_read_all` | FUNCTION `touch_prompt_rules_updated_at`; TRIGGER `trg_prompt_rules_touch_updated_at` | INSERT '레거시 시스템 프롬프트' 조건부 | (**031에서 DROP CASCADE**) | 031 적용으로 부재 확인. 아카이브 테이블 `prompt_rules_archive_2026_07_15` 존재 (Q10-a에서 확인됨) |
| 029 | 029_knowledge.sql | **CREATE TABLE `knowledge`**, `knowledge_images` | 4개 (partial + GIN + unique per_type) | ENABLE RLS (정책 0개) | FUNCTION `enforce_knowledge_image_limit`; TRIGGER; FUNCTION `touch_knowledge_updated_at`; TRIGGER | — | — | 두 테이블 + 두 함수 존재 |
| 030 | 030_knowledge_grouping.sql | ADD COLUMN `knowledge.category`, `.sort_order` + 2 CHECK | `idx_knowledge_category_sort` | — | — | UPDATE knowledge SET sort_order (재계산) | — | knowledge.category · sort_order 컬럼 존재 |
| 031 | 031_drop_prompt_rules.sql | — | — | — | — | — | **DROP TABLE `prompt_rules` CASCADE, `admin_settings` CASCADE** | 두 테이블 부재. Q10-a 결과 `prompt_rules` 부재 확인됨 (`prompt_rules_archive_2026_07_15`만 존재, 이건 아카이브 사본) |
| 032 | 032_image_shareable.sql | ADD COLUMN `images.is_shareable` | — | DROP POLICY `images_select_own_or_public`; CREATE `images_select_own_public_or_shareable`; DROP `tags_select`; CREATE 재정의; DROP `categories_select`; CREATE 재정의 | — | — | (**034에서 컬럼 자체 삭제**) | 034 적용 여부로 판정 (034에서 is_shareable 컬럼 DROP) |
| 033 | 033_organizations_expand.sql | ENUM `organization_role`, `image_visibility`, `org_activity_type`; **CREATE TABLE `organizations`, `organization_members`, `organization_invites`, `image_organization_shares`, `organization_activity_logs`**; ADD COLUMN `images.visibility`, `.is_on_community`; CONSTRAINT `images_community_requires_public_or_auth` | 다수 (idx_organizations_owner/slug, org_members, invites unique partial, ios 2개, activity 3개, images_on_community, images_visibility) | ENABLE RLS on 5개 신규 테이블 + 정책 다수 (orgs 4개, members 4개, invites 4개, ios 3개, activity_logs 1개); CREATE POLICY `images_select_v4`, `images_update_v2`, `tags_select_v2`, `categories_select_v2` | FUNCTION `is_org_member(UUID,UUID)`, `org_role(UUID,UUID)`, `image_visible_via_org(UUID,UUID)`, `set_updated_at()`; TRIGGER `organizations_set_updated_at` | UPDATE images 백필 (visibility/is_on_community) | — | 5개 조직 테이블 + 3개 helper 함수 + `image_visibility` enum. Q10-a에 5개 테이블 모두 존재 확인 |
| **033b** | **033b_community_view_expand.sql** | **CLI 스킵** — REPLACE VIEW `community_images` v4 (visibility · is_on_community 두 컬럼 추가, WHERE 완화) | — | — | — | — | — | **판정 곤란**: 이 정의는 041 · 077로 완전 대체됨. 실행 여부 확인 불가 (§4 별도 분석) |
| 034 | 034_organizations_contract.sql | **DROP COLUMN `images.is_public`, `.is_shareable`** | — | DROP POLICY 다수 (`images_select_own_or_public`, `_public_or_shareable`, `_v3`, `images_update_own`, `tags_select`, `categories_select`) | — | — | DROP VIEW `community_images` + REPLACE without is_public | Q2 결과: `images` 테이블에 `is_public`, `is_shareable` 컬럼 부재 확인 (Q10-a 미포함, 필요시 Q11-b로 재확인) |
| 035 | 035_grant_service_role_org_tables.sql | — | — | — | — | — | — | GRANT service_role on 5개 조직 테이블 |
| 036 | 036_consolidate_admin_role.sql | — | — | — | — | UPDATE members SET role='editor' WHERE 'admin'; UPDATE invites 동일 | — | **판정 불가** (데이터 상태만 변경). 확인: `SELECT COUNT(*) FROM organization_members WHERE role='admin'` = 0 |
| 037 | 037_images_select_via_org_share.sql | — | — | DROP `images_select_v4`; CREATE `images_select_v5` (+ shares 관계) | — | — | — | 정책 `images_select_v5` 존재 (동시에 v4 부재) |
| 038 | 038_community_curation.sql | ADD COLUMN `images.community_published_by`, `.community_published_at`, `.community_source_organization_id`; CONSTRAINT `images_community_curated_ck` | `idx_images_community_source`, `idx_images_community_published_at` | DROP `images_update_v2`; CREATE `images_update_v3` (owner-only) | FUNCTION `unshare_org_clears_community()`; TRIGGER `trg_unshare_org_clears_community` | — | — | 3개 신규 컬럼 + 함수 + 트리거 존재 |
| 039 | 039_drop_community_visibility_constraint.sql | DROP CONSTRAINT `images_community_requires_public_or_auth` | — | — | — | — | (033에서 만든 CHECK) | constraint 부재 확인 |
| 040 | 040_reset_grandfather_community_flags.sql | — | — | — | — | UPDATE images SET is_on_community=FALSE WHERE (grandfather) | — | **판정 불가** (데이터 상태만). 참고: Q10-a에 `backup_grandfather_reset_040` 테이블 확인 → 040 실행 전 백업이 남아있다는 흔적 (그러나 이 백업 테이블은 040 파일 본문에 없음 → 관리자 수동 조작으로 추정) |

### 2.2 041~077 (조직·토큰·큐레이션 완성)

| # | 파일 | 테이블·컬럼 | 인덱스 | RLS | 함수·트리거 | Seed·DML | DROP·대체 | 판정 근거 |
|---|---|---|---|---|---|---|---|---|
| 041 | 041_community_source_and_tag_rls.sql | ALTER TYPE `org_activity_type` ADD 'community_published', 'community_unpublished' | — | DROP `tags_select_v2`; CREATE `tags_select_v3` (+ shares); DROP `categories_select_v2`; CREATE `categories_select_v3` (+ shares) | — | — | DROP VIEW `community_images` + REPLACE v5 (source_organization_slug/name) | 정책 `tags_select_v3` · `categories_select_v3` 존재; enum 값 두 개 존재 |
| 042 | 042_pre_org_delete_community_cleanup.sql | — | — | — | FUNCTION `pre_org_delete_clear_community()`; TRIGGER `trg_pre_org_delete_clear_community` BEFORE DELETE ON organizations | — | — | 함수 + 트리거 존재 |
| 043 | 043_organization_settings_and_references.sql | **CREATE TABLE `organization_school_settings`**, `organization_reference_images` | `idx_org_reference_images_org` | 정책 다수 (org_school_settings 4개, org_reference_images 4개); ENABLE RLS | FUNCTION `touch_org_school_settings_updated_at`; TRIGGER; FUNCTION `enforce_org_reference_image_limit`; TRIGGER | — | — | `organization_reference_images` 존재 (`organization_school_settings`는 044에서 DROP) |
| 044 | 044_merge_school_settings_into_organizations.sql | ADD COLUMN `organizations.school_level`, `.base_prompt`, `.style_enabled` | — | — | — | — | DROP TRIGGER; **DROP FUNCTION `touch_org_school_settings_updated_at`**; **DROP TABLE `organization_school_settings`** | 함수·테이블 부재 확인 + organizations 3개 컬럼 존재. Q10-a: `organization_school_settings` 부재 확인됨, `organization_reference_images` 존재 |
| 045 | 045_school_level_extend.sql | ALTER TYPE `school_level_enum` ADD 'kindergarten', 'other' | — | — | — | — | — | enum 값 5개 존재 |
| 046 | 046_generation_jobs_org_id.sql | ADD COLUMN `generation_jobs.org_id` | — | — | — | — | — | 컬럼 존재 |
| 047 | 047_grant_service_role_profiles.sql | — | — | — | — | — | — | GRANT service_role on profiles, school_profiles |
| 048 | 048_home_hero_images.sql | **CREATE TABLE `home_hero_images`** | `idx_home_hero_enabled_order` | ENABLE RLS (정책 없음 → authenticated 차단) | — | — | — | 테이블 존재 |
| 049 | 049_generation_jobs_canceled_status.sql | ALTER TYPE `job_status_enum` ADD 'canceled' | — | — | — | — | — | enum 값 존재 |
| 050 | 050_home_hero_source_image.sql | ADD COLUMN `home_hero_images.source_image_id` | `idx_home_hero_source_image` | — | — | — | — | 컬럼 존재 |
| 051 | 051_generation_jobs_slot_prompts.sql | ADD COLUMN `generation_jobs.slot_prompts` JSONB + CHECK | — | — | — | — | — | 컬럼 + constraint 존재 |
| 052 | 052_generation_jobs_package.sql | ENUM `job_kind_enum` ('single','package'); ADD COLUMN `generation_jobs.kind`, `.package_plan` + CHECK | — | — | — | — | — | enum + 컬럼 존재 |
| 053 | 053_generation_job_slots.sql | ENUM `slot_status_enum`; **CREATE TABLE `generation_job_slots`** | `idx_generation_job_slots_job/status` | POLICY `generation_job_slots_select_own`; ENABLE RLS | FUNCTION `tg_generation_job_slots_touch_updated_at`; TRIGGER `trg_generation_job_slots_updated_at` | — | — | 테이블 + enum 존재 (Q10-a 확인됨) |
| 054 | 054_images_package_slot.sql | ADD COLUMN `images.package_slot_id` | `idx_images_package_slot` | — | — | — | — | 컬럼 존재 |
| 055 | 055_generation_job_slots_final_prompt_category_order.sql | ADD COLUMN `generation_job_slots.final_prompt`, `.category_order` | — | — | — | UPDATE gs SET category_order (backfill); UPDATE gj SET package_plan (버전 명시) | — | 두 컬럼 존재 |
| 056 | 056_organizations_type_and_reserved_slugs.sql | ENUM `organization_type_enum`; ADD COLUMN `organizations.type`; DROP + ADD CONSTRAINT `organizations_slug_not_reserved` | `idx_organizations_personal_owner` (unique partial), `idx_organizations_type` (partial) | — | — | — | 옛 예약 slug 목록 대체 | organizations.type + enum + 두 인덱스 |
| 057 | 057_token_pools.sql | **CREATE TABLE `token_pools`** | `idx_token_pools_organization` | POLICY `token_pools_select_member`; ENABLE RLS; REVOKE INSERT/UPDATE/DELETE from authenticated | FUNCTION `tg_token_pools_touch_updated_at`; TRIGGER | — | — | 테이블 + 함수 존재 (Q10-a 확인됨) |
| 058 | 058_token_ledger.sql | ENUM `token_ledger_type_enum`; **CREATE TABLE `token_ledger`** | 4개 (`idx_ledger_pool_created`, `_transaction`, `_type_created`, `_job` partial) | POLICY `token_ledger_select_member`; ENABLE RLS; REVOKE INSERT | FUNCTION `tg_token_ledger_append_only`; TRIGGER × 2 (no_update, no_delete) | — | — | 테이블 + enum + 함수 존재 |
| 059 | 059_generation_jobs_openai_cost.sql | ADD COLUMN `generation_jobs.provider`, `.model`, `.usage_input_tokens`, `.usage_output_tokens`, `.image_count`, `.provider_cost_usd`, `.provider_cost_krw`, `.usage_raw` | `idx_jobs_provider_completed` (partial) | — | — | — | — | 8개 신규 컬럼 존재 |
| 060 | 060_credit_service_rpcs.sql | — | — | — | FUNCTION `_credit_pool_personal_owner(UUID)`, `_credit_sync_profile_cache(UUID,INT)`, `allocate_tokens(UUID,UUID,INT,TEXT,UUID)`, `use_tokens(UUID,INT,UUID,UUID)`, `refund_tokens(UUID,INT,UUID,TEXT,JSONB)`, `adjust_tokens(UUID,INT,TEXT,UUID)`, `transfer_tokens(UUID,UUID,INT,TEXT,UUID)`, `get_balance(UUID)` | — | — | 8개 함수 시그니처 존재 (Q10-c에서 6개 확인, 나머지 2개 helper 재확인 필요) |
| 061 | 061_profiles_credits_write_guard_function.sql | — | — | — | FUNCTION `tg_profiles_credits_write_guard()` (트리거 부착은 066) | — | — | 함수 존재 (트리거 부착 여부는 066에서 별도) |
| 062 | 062_provision_my_organization.sql | — | — | — | FUNCTION `provision_my_organization(UUID)` v1 | — | — | 함수 존재 (074에서 v2로 대체됨 → 존재 확인만 유효) |
| 063 | 063_handle_new_user_v2.sql | — | — | — | FUNCTION `handle_new_user()` v2 (본문 대체) | — | (v1 대체) | 함수 본문에 `provision_my_organization` 호출 포함 여부 (071/072에서 다시 대체) |
| 064 | 064_backfill_my_organizations.sql | — | — | — | — | DO 블록: 전 auth.users 순회 → provision_my_organization | — | **판정 불가** (backfill 로그만 남음). 대체 근거: `SELECT COUNT(*) FROM organizations WHERE type='personal'` vs `COUNT(*) FROM auth.users` |
| 065 | 065_migrate_personal_data_to_my_org.sql | ADD COLUMN `images.organization_id`, `reference_images.organization_id` | `idx_images_organization_created`, `idx_reference_images_organization` (partial) | — | — | UPDATE images/reference_images/generation_jobs SET organization_id | — | 두 컬럼 존재 |
| 066 | 066_profiles_credits_write_guard_trigger.sql | — | — | — | TRIGGER `profiles_credits_write_guard` BEFORE UPDATE OF credits ON profiles | — | — | 트리거 존재 |
| 067 | 067_token_pools_auto_provision.sql | — | — | — | FUNCTION `tg_organizations_provision_pool`; TRIGGER `organizations_provision_pool` AFTER INSERT ON organizations | INSERT token_pools (backfill) | — | 함수 + 트리거 존재 |
| 068 | 068_organization_requests.sql | ENUM `organization_request_status`; **CREATE TABLE `organization_requests`** | 2개 | POLICY `org_req_select_own`, `_insert_own`; ENABLE RLS | FUNCTION `tg_org_requests_updated_at`; TRIGGER `organization_requests_updated_at`; FUNCTION `approve_organization_request(UUID,UUID)` | — | — | 테이블 + enum + 함수 존재 (Q10-a에서 `organization_requests` 확인됨) |
| 069 | 069_organization_requests_grants.sql | — | — | — | — | — | — | GRANT authenticated |
| 070 | 070_organization_requests_service_role_grants.sql | — | — | — | — | — | — | GRANT service_role |
| 071 | 071_initial_credits_to_20.sql | ALTER `profiles.credits` SET DEFAULT 20 | — | — | — | FUNCTION `handle_new_user()` v3 (fallback 20) | — | (v4는 072에서) | column_default = '20' |
| 072 | 072_app_settings.sql | **CREATE TABLE `app_settings`** | — | ENABLE RLS (정책 없음) | FUNCTION `tg_app_settings_updated_at`; TRIGGER `app_settings_updated_at`; FUNCTION `handle_new_user()` v4 (app_settings 우선 조회) | INSERT ('initial_signup_credits','20',...) | — | 테이블 + seed row + `handle_new_user` 최신 본문 존재 |
| 073 | 073_image_trash.sql | ENUM `image_trash_status_enum`, `image_trash_action_enum`, `image_trash_actor_type_enum`; ADD COLUMN `images.trash_status`, `.trashed_at`, `.trashed_by`, `.trash_reason`, `.trash_actor_type`; **CREATE TABLE `image_trash_logs`** | `idx_images_trash_active/trashed` (partial), `idx_image_trash_logs_image/actor` | POLICY `image_trash_logs_select_own_or_admin`; ENABLE RLS | FUNCTION `tg_image_trash_logs_readonly`; TRIGGER × 2 (no_update, no_delete) | — | — | 3개 enum + 5개 신규 컬럼 + `image_trash_logs` 존재 (Q10-a 확인됨) |
| 074 | 074_provision_my_organization_idempotent_pool.sql | — | — | — | FUNCTION `provision_my_organization(UUID)` v2 (ON CONFLICT DO NOTHING) | — | — | 함수 본문에 `ON CONFLICT (organization_id) DO NOTHING` 포함 여부 |
| 075 | 075_conversations_and_messages.sql | ENUM `conversation_status_enum`, `conversation_message_role_enum`, `conversation_message_status_enum`; **CREATE TABLE `conversations`**, `conversation_messages` | `idx_conversations_sidebar/org_status` (partial), `idx_conversation_messages_order/job` (partial) | POLICY (conversations 3개, messages 3개); ENABLE RLS | FUNCTION × 3 (`tg_conversations_touch_updated_at`, `tg_conversation_messages_touch_updated_at`, `tg_conversation_messages_touch_conversation`); TRIGGER × 3 | — | — | 두 테이블 + 3 enum + 3 함수 존재 (Q10-a 확인됨) |
| 076 | 076_generation_jobs_link_conversation.sql | ADD COLUMN `generation_jobs.conversation_id`, `.message_id` | `idx_generation_jobs_conversation/message` (partial) | — | — | — | — | 두 컬럼 존재 |
| 077 | 077_community_view_count.sql | ALTER `download_events` DROP + ADD CONSTRAINT (event_type 4종: +view); ALTER `download_events.user_id` DROP NOT NULL | — | — | — | — | DROP VIEW `community_images` + REPLACE v6 (+ view_count) | `download_events.user_id` nullable + event_type CHECK 4종 포함 + view `community_images` 정의에 `view_count` 컬럼 존재 |

### 2.3 078~083 (learning-helper Phase 1 M1)

| # | 파일 | 테이블·컬럼 | 인덱스 | RLS | 함수·트리거 | Seed·DML | DROP·대체 | 판정 근거 |
|---|---|---|---|---|---|---|---|---|
| 078 | 078_learning_subjects.sql | **CREATE TABLE `learning_subjects`** (code PK TEXT) | — | — (RLS 미적용) | — | INSERT ('KOR','국어',1,TRUE), ('MATH','수학',2,TRUE) | — | 테이블 + 2 rows (KOR, MATH) 존재 (Q10-a 확인됨) |
| 079 | 079_learning_common_topics.sql | **CREATE TABLE `learning_common_topics`** (grade + subject_code + unit + topic + keywords TEXT[], UNIQUE (grade,subject_code,unit,topic)) | `idx_learning_common_topics_grade_subject` (partial) | — | — | 40 rows INSERT (1·2학년 국·수 각 10건) | — | 테이블 + row_count = 40 (성공 시). Q10-a 확인됨 |
| 080 | 080_learning_material_types.sql | **CREATE TABLE `learning_material_types`** (code PK TEXT + default_format CHECK) | — | — | — | INSERT 5 rows (multiple_choice, individual_activity, ox_quiz, concept_summary, reading_material) | — | 테이블 + 5 rows 존재 (Q10-a 확인됨) |
| 081 | 081_learning_documents.sql | **CREATE TABLE `learning_documents`** (조직·유저·주제·문서 JSON) | `idx_learning_documents_org_created/user_created` | POLICY `learning_documents_select_by_org_member`, `_insert_by_org_member`, `_delete_by_owner`; ENABLE RLS | — | — | — | 테이블 + 3 정책 존재 (Q10-a 확인됨) |
| 082 | 082_generation_jobs_kind_enum_add.sql | ALTER TYPE `job_kind_enum` ADD 'learning_doc' | — | — | — | — | — | enum 값 존재: `SELECT enum_range(NULL::job_kind_enum)` |
| 083 | 083_generation_jobs_learning_doc_wiring.sql | ADD COLUMN `generation_jobs.learning_document_id` | `idx_jobs_active_per_user_image/learning` (unique partial), `idx_generation_jobs_kind_status` | — | — | — | DROP INDEX `idx_jobs_active_per_user` | 컬럼 + 두 신규 partial unique index 존재 + 기존 인덱스 부재 |

### 2.4 084~091 (learning-profile draft, Studio 수동 실행)

| # | 파일 | 위치 | 상태 | 근거 |
|---|---|---|---|---|
| 084 | learning_profile_sets.draft.sql | docs/03-analysis/… | **적용 확인** | Q1/Q2/Q4 결과 draft 100% 일치 |
| 085 | learning_domains.draft.sql | docs/03-analysis/… | **적용 확인** | Q1/Q2/Q3/Q4/Q5 결과 draft 100% 일치 |
| 086 | learning_profiles.draft.sql | docs/03-analysis/… | **적용 확인** | Q2 결과: 28 컬럼 · Q3: 6 FK · Q4: 8 인덱스 (NULLS NOT DISTINCT 포함) · Q5 정책 일치 |
| 087 | learning_profile_material_types.draft.sql | docs/03-analysis/… | **적용 확인** | Q1~Q5 draft 일치 |
| 088 | learning_evaluations.draft.sql | docs/03-analysis/… | **적용 확인** | Q1~Q5 draft 일치 (profile_snapshot JSONB · is_org_member RLS) |
| 089 | learning_evaluation_items.draft.sql | docs/03-analysis/… | **적용 확인** | Q1~Q5 draft 일치 |
| 090 | learning_repair_attempts.draft.sql | docs/03-analysis/… | **적용 확인** | Q1~Q5 draft 일치 (failed_item_ids ARRAY · attempt=1 CHECK) |
| 091 | learning_profile_minimum_seed.draft.sql | docs/03-analysis/… | **미적용 (전량 롤백)** | Q6: 모든 신규 테이블 row_count = 0 · Q7: 0 rows · 원인: 3-h `recommended_scope` 컬럼 부재 → Studio 암시적 트랜잭션 전체 ROLLBACK |

---

## 3. 원격 대조 결과 요약 (Q1~Q10 기준, 잠정)

### 3.1 신규 084~090

- **7개 신규 테이블 전부 존재 + RLS ON + draft 100% 일치** (§2.4)
- 091 seed 전량 롤백 (Q6/Q7)
- 서비스 참조 0건 → 서비스 영향 0

### 3.2 기존 001~083 (Q10-a/b/c 기준)

Q10-a 원격 public 테이블 37건과 로컬 매핑 대조:

**존재 확인** (Q10-a 매핑):
- `profiles` (001), `school_profiles` (002), `images` (011), `image_tags` (012), `image_categories` (013), `generation_jobs` (014), `download_events` (015)
- `reference_images` (025), `knowledge`+`knowledge_images` (029), `organizations`+`organization_members`+`organization_invites`+`image_organization_shares`+`organization_activity_logs` (033)
- `organization_reference_images` (043, 044 후 잔존), `home_hero_images` (048), `generation_job_slots` (053), `token_pools` (057), `token_ledger` (058), `organization_requests` (068)
- `app_settings` (072), `image_trash_logs` (073), `conversations`+`conversation_messages` (075)
- **learning_subjects (078), learning_common_topics (079), learning_material_types (080), learning_documents (081)** → M1 실적용 근거
- `backup_grandfather_reset_040` — 040 실행 전 관리자가 수동 백업한 것으로 추정 (040 파일 본문에 없음, `-- 실행 전 프로덕션에서는 backup_grandfather_reset_040 로 스냅샷을 남긴 뒤` 주석 참조)
- `prompt_rules_archive_2026_07_15` — 031 DROP TABLE 이전에 관리자가 수동으로 아카이브한 사본 (031 파일 본문에 없음, 그러나 이름이 `2026_07_15` → 실제 적용 근거)

**부재 확인 (예상대로 후속 마이그레이션이 DROP)**:
- `prompt_rules` (028 생성 → 031 DROP) — 부재 확인됨 → 031 적용 근거
- `admin_settings` (023 생성 → 031 DROP) — 부재 확인됨 → 031 적용 근거
- `organization_school_settings` (043 생성 → 044 DROP) — 부재 확인됨 → 044 적용 근거

Q10-b 뷰: **community_images** 하나만 → 020/021/024/033b/034/041/077 뷰 lineage 최종 상태 (§4)

Q10-c 함수 40개 (Q10 첨부):
- `handle_new_user` (001, 063/071/072에서 재정의) ✓
- `reserve_credits`, `refund_credits`, `monthly_credit_reset` (008) ✓ (`monthly_credit_reset` 022에서 인자 없는 오버로드 추가 → Q10-c에 `monthly_credit_reset` 두 줄 확인됨: 두 오버로드 모두 존재하는 근거)
- `touch_school_profile_updated_at` (002) ✓
- `enforce_reference_image_limit` (025), `enforce_org_reference_image_limit` (043), `enforce_knowledge_image_limit` (029) ✓
- `touch_knowledge_updated_at` (029), `touch_prompt_rules_updated_at` (028) ✓ (028 실행됨을 시사, 031이 함수는 DROP 안 함)
- `is_org_member`, `org_role`, `image_visible_via_org` (033) ✓
- `pre_org_delete_clear_community` (042), `unshare_org_clears_community` (038) ✓
- `set_updated_at` (033) ✓
- `tg_*` 계열 (053, 057, 058, 067, 068, 072, 073, 075) ✓ 대부분 존재
- `allocate_tokens`, `use_tokens`, `refund_tokens`, `adjust_tokens`, `transfer_tokens`, `get_balance` (060) ✓ 6개 확인
- `provision_my_organization` (062, 074) ✓
- `approve_organization_request` (068) ✓
- **_credit_pool_personal_owner`, `_credit_sync_profile_cache** (060 helper) ✓ Q10-c 상단 2건 확인

**함수 관점 근거만으로 잠정 판정**:
- 001~083 대부분이 **적용됐다는 방향성**을 지지 (누락 없음)
- 다만 다음은 함수·테이블만으로는 판정 불가 → Q11에서 별도 확인 필요:
  - **컬럼 추가·삭제** (024/032/034/038/044/046/050/051/052/054/055/056/059/065/073/076/083)
  - **인덱스** (다수)
  - **RLS 정책 명칭·조건 변경** (016/032/034/037/038/041)
  - **CHECK constraint** (027/033/038/039/077)
  - **ENUM 값 추가** (041/045/049/056/068/082)
  - **DML/backfill** (019/023/028/030/036/039/040/055/062/064/065/067/071/072/078/079/080)

---

## 4. 033b 별도 분석

### 4.1 파일 원본

- **파일**: `supabase/migrations/033b_community_view_expand.sql`
- **CLI 상태**: `Skipping migration 033b_...` (파일명 규칙 위반)
- **크기**: 60줄
- **본문**: `CREATE OR REPLACE VIEW public.community_images AS SELECT ... i.visibility, i.is_on_community FROM ...` 하나뿐
- **DDL/DML 아님**: `CREATE OR REPLACE VIEW`만 있고 테이블·컬럼·정책 변경 없음. 실행되든 안 되든 데이터 손실 없음.

### 4.2 뷰 lineage (`community_images`)

| # | 마이그레이션 | 정의 유형 | 컬럼 (요약) | WHERE |
|---|---|---|---|---|
| 020 | 020_community_images_view.sql | CREATE OR REPLACE VIEW | id ~ created_at, author_type, author_school_name | `is_public=TRUE AND status='saved'` |
| 021 | 021_community_download_count.sql | CREATE OR REPLACE VIEW | 020 + `download_count` | 020 동일 |
| 024 | 024_aspect_ratio.sql | CREATE OR REPLACE VIEW | 021 + `width, height` | 021 동일 |
| **033b** | 033b_community_view_expand.sql | CREATE OR REPLACE VIEW | 024 + `visibility, is_on_community` | `(is_public=TRUE OR is_on_community=TRUE) AND status='saved'` |
| 034 | 034_organizations_contract.sql | DROP VIEW + CREATE | is_public 제거, visibility · is_on_community를 중간에 삽입 | `is_on_community=TRUE AND status='saved'` |
| 041 | 041_community_source_and_tag_rls.sql | DROP VIEW + CREATE | 034 + `community_published_at/by/source_organization_id`, `source_organization_slug/name` | 034 동일 |
| 077 | 077_community_view_count.sql | DROP VIEW + CREATE | 041 + `view_count` | 041 동일 |

### 4.3 033b의 현재 유효성

- **033b의 정의는 남아 있지 않다**. 034에서 `DROP VIEW` 후 재정의, 이후 041 · 077에서도 각각 `DROP VIEW`로 재정의.
- **033b 본문 자체가 원격에서 실행됐는지 판정 불가**. 다음 이유:
  - 034 이후 뷰는 완전히 새로 생성됨
  - 033b의 특징(당시 시점의 `is_public=TRUE OR is_on_community=TRUE` OR 조건)은 034 이후 사라짐
  - 034 → 041 → 077 순서로 여러 번 재정의되었고, 최종 정의(077 결과)에는 034 이후에 추가된 컬럼만 있음
- **원격에 뷰가 존재한다는 사실(Q10-b `community_images` 1건)** 은 034/041/077 중 하나가 실행됐음을 의미할 뿐, 033b가 실행됐는지는 알 수 없음.

### 4.4 033b 재작성 필요성 판단

**결론: 재작성 불필요**

이유:
1. **최종 상태 확인**: Q11-e (아래 §5) 로 `pg_views.definition` 을 조회하면 077 결과와 일치하는지 확인 가능. 일치하면 뷰 자체는 정확히 077 정의로 존재.
2. **033b의 의도는 이미 사라짐**: 034에서 `is_public` 컬럼 자체가 DROP되므로 033b의 하위 호환 목적 (옛 앱과 새 앱 병존)이 원래부터 임시적. 034 실행 이후 033b의 존재 이유가 사라짐.
3. **신규 환경 재현 불가 부분은 없음**: `supabase db reset` 이나 새 스테이징 배포 시 CLI는 033b를 스킵하고 034를 실행한다. 034가 곧바로 `is_public` 없는 정의로 뷰를 만든다. 결과가 정확히 077 상태와 같도록 041 · 077이 순차 재정의한다. 즉 **033b가 없어도 최종 뷰는 동일하게 재현됨**.

### 4.5 옵션 대안 (선호도 순, 승인 대기)

- **옵션 X (권장, 무변경)**: 033b 그대로 두고 아무것도 안 함. CLI는 계속 스킵. 파일은 문서용으로 남음. 뷰 lineage 이해에 도움. 재실행되지 않으므로 실행 리스크 0. `supabase db reset` 등에서도 CLI가 자동 무시.
- **옵션 Y (파일 최상단에 주석 추가)**: 파일에 `-- LEGACY: 034 이후 완전히 대체됨. CLI는 스킵. 신규 환경에서 재실행되지 않음.` 헤더 추가. 파일 rename 없음. 순수 문서 개선.
- **옵션 Z (파일 삭제)**: 뷰 lineage 이해가 어려워지므로 비권장. 다만 CLI 스킵 로그가 신경 쓰이면 선택 가능.

Q11 결과로 뷰 정의가 077 정의와 정확히 일치함을 확인한 뒤 **옵션 X** 로 남기는 것을 권장.

---

## 5. 원격 대조를 위한 통합 SELECT 쿼리 팩 (Q11)

**목적**: §2 매핑표의 "판정 근거" 열을 원격 실 스키마와 대조. 전부 SELECT · 각각 독립 실행 가능.

### Q11-a: public 스키마 모든 컬럼 (매핑표의 `is_public`, `is_shareable`, `organization_id`, `visibility`, `trash_status`, `learning_document_id` 등 대조)

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, ordinal_position;
```

### Q11-b: public 스키마 모든 CHECK constraint

```sql
SELECT conrelid::regclass AS table_name,
       conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype IN ('c','u','f')
  AND connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, contype, conname;
```

### Q11-c: public 스키마 모든 인덱스

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
ORDER BY tablename, indexname;
```

### Q11-d: public 스키마 모든 RLS 정책

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;
```

### Q11-e: `community_images` 뷰 현재 정의 (033b 최종 검증)

```sql
SELECT pg_get_viewdef('public.community_images'::regclass, true);
```

### Q11-f: 모든 public 함수 시그니처 (060 helper 두 개 · monthly_credit_reset 두 오버로드 등)

```sql
SELECT p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
       pg_catalog.pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
ORDER BY p.proname, args;
```

### Q11-g: 모든 트리거

```sql
SELECT event_object_table AS table_name,
       trigger_name,
       action_timing,
       string_agg(event_manipulation, ',') AS events,
       action_statement
FROM information_schema.triggers
WHERE trigger_schema='public'
GROUP BY event_object_table, trigger_name, action_timing, action_statement
ORDER BY event_object_table, trigger_name;
```

### Q11-h: 모든 ENUM 값 (024/033/041/045/049/052/053/056/058/068/073/075/082 검증)

```sql
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname='public'
ORDER BY t.typname, e.enumsortorder;
```

### Q11-i: DML/backfill 결과 검증 (036 admin→editor, 040 grandfather reset, 064 backfill, 078/079/080 seed)

```sql
-- 036 검증: admin role 없어야 함
SELECT COUNT(*) FROM public.organization_members WHERE role='admin';

-- 040 검증: grandfather (source_org NULL AND is_on_community TRUE) 없어야 함
SELECT COUNT(*) FROM public.images
WHERE is_on_community=TRUE
  AND community_source_organization_id IS NULL
  AND community_published_by IS NULL
  AND community_published_at IS NULL;

-- 064 검증: personal org 수 vs auth users 수
SELECT
  (SELECT COUNT(*) FROM public.organizations WHERE type='personal' AND deleted_at IS NULL) AS personal_orgs,
  (SELECT COUNT(*) FROM auth.users) AS auth_users;

-- 078 seed 검증
SELECT code, name_ko FROM public.learning_subjects ORDER BY display_order;
-- 예상: (KOR, 국어), (MATH, 수학)

-- 079 seed 검증 (40건)
SELECT COUNT(*) FROM public.learning_common_topics;
SELECT grade, subject_code, COUNT(*) FROM public.learning_common_topics
GROUP BY grade, subject_code ORDER BY grade, subject_code;
-- 예상: (1,KOR,10), (1,MATH,10), (2,KOR,10), (2,MATH,10)

-- 080 seed 검증 (5건)
SELECT code, name_ko FROM public.learning_material_types ORDER BY display_order;

-- 067 backfill 검증: 모든 organization에 pool 존재
SELECT COUNT(*) FROM public.organizations o
LEFT JOIN public.token_pools p ON p.organization_id = o.id
WHERE p.id IS NULL AND o.deleted_at IS NULL;
-- 예상: 0

-- 072 seed 검증
SELECT key, value FROM public.app_settings WHERE key='initial_signup_credits';
-- 예상: (initial_signup_credits, 20)

-- 071 검증
SELECT column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='credits';
-- 예상: 20
```

### Q11-j: pg_cron 상태 (017/019/022 검증)

```sql
SELECT jobid, jobname, schedule, command
FROM cron.job
ORDER BY jobname;
-- 예상: 'monthly-credit-reset-daily' 존재, 'cleanup-pending-images-hourly' 부재
```

### 실행 순서 및 안전 지침

- Q11-a ~ Q11-j 순서로 실행. 각각 개별 SQL Editor 탭에서 실행 · Export.
- **전부 SELECT만 포함**. DDL/DML 없음. `pg_get_viewdef` 함수 호출도 순수 조회.
- Q11-a는 큰 결과 (컬럼 200개 이상 가능) — CSV export 권장.
- Q11-i는 8개 소단위 SELECT가 세미콜론으로 구분. Studio가 마지막 결과만 표시하므로 **개별 실행 권장** (또는 각 SELECT별 별도 탭).

결과 수신 후:
1. §2 판정 근거 열과 대조
2. §3.2 잠정 판정을 확정으로 승격
3. §7 repair 후보 표에 라벨 채움

---

## 6. 기존 서비스 및 078~083 영향 재확인

- **084~090 CREATE**: 기존 001~083 테이블에 어떤 변경도 없음 (§1)
- **091 seed**: 전량 롤백. 데이터 오염 0
- **애플리케이션 코드**: 신규 7개 테이블 참조 0건. 런타임 동작 무변화
- **RLS 정책**: 신규 테이블 정책은 `authenticated`용 SELECT 뿐. 기존 정책 무영향
- **FK 방향**: 신규 → 기존만. 기존 테이블에 트리거·정책 추가 없음
- **serial/sequence·pg_cron·enum**: 신규 마이그레이션에서 추가된 것만 있고 기존 것 제거 없음

결론: **084~091 실행으로 인한 기존 서비스·데이터 영향 없음이 확정**.

---

## 7. Repair 후보 표 (판정 대기)

**아래 표는 Q11 결과 수신 후에 확정. 현재는 잠정 라벨만 채움.**

| Migration 구간 | 잠정 라벨 | Repair 후보 | 근거 | 미해결 위험 |
|---|---|---|---|---|
| 001~002 | 적용 확인 (잠정) | Q11 후 확정 | Q10-a에 profiles/school_profiles 존재, Q10-c에 handle_new_user·touch_school_profile_updated_at 존재 | Q11-a로 profiles.credits DEFAULT=20(071) 반영 확인 필요 |
| 008~019 | 적용 확인 (잠정) | Q11 후 확정 | Q10-a/c에 관련 객체 존재; 019는 pg_cron.job 부재로 검증 (Q11-j) | 017 함수·019 DROP FUNCTION 순서 정확한지 Q11-j 확인 |
| 020~022 | 적용 확인 (잠정) | Q11 후 확정 | 뷰 존재 (020~021 → 077에서 대체) + monthly_credit_reset 두 오버로드 (Q10-c) | 022 cron.job 'monthly-credit-reset-daily' Q11-j 확인 |
| 023 | **부재 확인 (031이 DROP)** | 판단 대기 (repair 필요) | Q10-a에 admin_settings 부재 = 031 실행 근거이자 023 실행 근거 | 023을 repair해도 후속 031이 DROP하므로 무해. 다만 CLI는 두 개를 순차 apply했다고 봐야 함 |
| 024 | 적용 확인 (잠정) | Q11 후 확정 | aspect_ratio_enum 존재 (Q11-h) · images.width/height (Q11-a) | 뷰 정의가 077 결과와 일치하는지 Q11-e |
| 025~027 | 적용 확인 (잠정) | Q11 후 확정 | reference_images 테이블 · enforce_reference_image_limit 함수 · generation_jobs_batch_size_range constraint (Q11-b) | — |
| 028~031 | 적용 확인 (잠정) | 판단 대기 (repair 필요) | 028 실행 근거: `touch_prompt_rules_updated_at` 함수 잔존 (Q10-c), `prompt_rules_archive_2026_07_15` 테이블 존재. 031 실행 근거: prompt_rules/admin_settings 부재 | 028 실행됐다면 함수는 왜 안 지워졌나? 031이 CASCADE로 트리거는 삭제하지만 함수 자체는 남음 (설계 의도) |
| 032 | **부재 확인 (034가 컬럼 DROP)** | 판단 대기 | Q11-a로 images.is_shareable 컬럼 부재 확인 필요. 부재하면 034 실행 근거 겸 032 흔적 소실 → 032 실행 여부는 pg_policies로 판정 어려움 (034가 정책도 DROP) | 032 실행 여부 판정 불가. **판정 불가 라벨 후보**. 다만 repair는 여전히 필요 (CLI 관점 정합) |
| 033 | 적용 확인 (잠정) | 판단 대기 | 5개 조직 테이블 존재 (Q10-a), 3 helper 함수 존재 (Q10-c), `image_visibility` · `organization_role` enum (Q11-h) | — |
| **033b** | **판정 불가 (뷰만 재정의, 이후 완전 대체)** | **repair 대상 아님** | CLI 스킵 대상. 원격 이력 등록 자체가 불가 (CLI가 파일을 못 봄) | 신규 환경에서도 CLI가 스킵 → 034가 대체 → 최종 뷰는 동일. **repair 시도 자체가 CLI 명령 오류** |
| 034 | 적용 확인 (잠정) | Q11 후 확정 | Q11-a로 images.is_public · is_shareable 컬럼 부재 확인 필요 → 부재하면 034 실행 확정 | 034가 실행되지 않았다면 apply해도 CASCADE로 뷰가 사라지므로 위험. Q11-a 확인 후에만 repair |
| 035 | 적용 확인 (잠정) | 판단 대기 | GRANT 존재 여부는 `has_table_privilege('service_role','organizations','SELECT')` 로 별도 확인 가능 | — |
| 036 | **판정 곤란 (DML만)** | 판단 대기 | Q11-i의 admin count = 0 확인 시 실행 근거 성립 | admin=0 라도 원래 admin이 없었을 가능성도 있음 → 강한 근거 아님. 관리자 판단 필요 |
| 037 | 적용 확인 (잠정) | Q11 후 확정 | Q11-d로 `images_select_v5` 정책 존재 + `images_select_v4` 부재 확인 | — |
| 038 | 적용 확인 (잠정) | Q11 후 확정 | images 3개 신규 컬럼 (Q11-a), `unshare_org_clears_community` 함수 (Q10-c), `images_community_curated_ck` constraint (Q11-b) | — |
| 039 | 적용 확인 (잠정) | Q11 후 확정 | Q11-b에서 `images_community_requires_public_or_auth` **부재** 확인 시 039 실행 근거 | — |
| 040 | 판정 곤란 (DML만, backup 테이블 존재) | 판단 대기 | Q10-a `backup_grandfather_reset_040` 존재 + Q11-i grandfather count = 0 확인 시 실행 근거 | — |
| 041 | 적용 확인 (잠정) | Q11 후 확정 | enum 값 `community_published/unpublished` (Q11-h), `tags_select_v3`/`categories_select_v3` 정책 (Q11-d), 뷰에 `source_organization_slug` (Q11-e) | — |
| 042 | 적용 확인 (잠정) | Q11 후 확정 | `pre_org_delete_clear_community` 함수 (Q10-c) + `trg_pre_org_delete_clear_community` 트리거 (Q11-g) | — |
| 043~044 | 적용 확인 (잠정) | Q11 후 확정 | `organization_reference_images` 존재 · `organization_school_settings` 부재 (Q10-a) + organizations 3개 컬럼 (Q11-a) | — |
| 045 | 적용 확인 (잠정) | Q11 후 확정 | `school_level_enum` 값 5개 확인 (Q11-h) | — |
| 046~056 | 적용 확인 (잠정) | Q11 후 확정 | generation_jobs 다수 컬럼 (Q11-a), 관련 enum (Q11-h), organizations.type/type_enum, unique partial index (Q11-c) | — |
| 057~060 | 적용 확인 (잠정) | Q11 후 확정 | token_pools/token_ledger 테이블 (Q10-a), 8개 credit 함수 (Q11-f, Q10-c에서 6개 확인) | Q11-f로 helper 2개 (`_credit_pool_personal_owner`, `_credit_sync_profile_cache`) 존재 재확인 |
| 061 | 적용 확인 (잠정) | Q11 후 확정 | `tg_profiles_credits_write_guard` 함수 존재 (Q10-c) | — |
| 062~064 | 적용 확인 (잠정) | Q11 후 확정 | `provision_my_organization` 함수 (Q10-c), 064 검증은 Q11-i (personal_orgs vs auth_users) | 062 v1이 074 v2로 대체됨 → 함수 본문에 `ON CONFLICT` 있는지 Q11-f로 판정 |
| 065 | 적용 확인 (잠정) | Q11 후 확정 | images/reference_images 각각 organization_id 컬럼 (Q11-a), 관련 인덱스 (Q11-c) | — |
| 066 | 적용 확인 (잠정) | Q11 후 확정 | 트리거 `profiles_credits_write_guard` 존재 (Q11-g) | — |
| 067 | 적용 확인 (잠정) | Q11 후 확정 | `tg_organizations_provision_pool` 함수 (Q10-c에는 등록됨) + `organizations_provision_pool` 트리거 (Q11-g) + Q11-i pool 부재 개수 = 0 | — |
| 068~070 | 적용 확인 (잠정) | Q11 후 확정 | `organization_requests` 테이블 (Q10-a), `approve_organization_request` 함수 (Q10-c), enum `organization_request_status` (Q11-h) | — |
| 071~072 | 적용 확인 (잠정) | Q11 후 확정 | profiles.credits DEFAULT=20 (Q11-a) + app_settings 존재 (Q10-a) + seed row (Q11-i) | — |
| 073 | 적용 확인 (잠정) | Q11 후 확정 | 3개 신규 enum (Q11-h), images 5 컬럼 (Q11-a), `image_trash_logs` 테이블 (Q10-a) | — |
| 074 | 적용 확인 (잠정) | Q11 후 확정 | Q11-f로 provision_my_organization 함수 본문에 `ON CONFLICT (organization_id) DO NOTHING` 포함 확인 (pg_get_functiondef) | — |
| 075~076 | 적용 확인 (잠정) | Q11 후 확정 | conversations/conversation_messages 테이블 (Q10-a), 관련 enum · 함수 · 트리거, generation_jobs 2 컬럼 | — |
| 077 | 적용 확인 (잠정) | Q11 후 확정 | download_events.event_type CHECK에 'view' 포함 (Q11-b), user_id NULLABLE (Q11-a), 뷰 정의에 `view_count` (Q11-e) | — |
| 078~083 | **적용 확인** | 판단 대기 (repair 필요) | 4개 learning 테이블 (Q10-a), M1 seed 확인 (Q11-i), job_kind_enum 'learning_doc' (Q11-h), 신규 partial unique index (Q11-c) | 083의 인덱스 교체 (신규 2개 생성 + 기존 1개 DROP) 완료 여부 Q11-c로 확인 |
| 084~090 | **적용 확인** | 판단 대기 (repair 필요) | §2.4 참조. Q1~Q5 draft 100% 일치 | 파일이 `docs/` 아래에 있으므로 repair 전에 `supabase/migrations/`로 이동 필요 (§8 별도 판단) |
| 091 | **미적용 (전량 롤백)** | repair 대상 아님 | Q6/Q7. seed 데이터 0건. 파일 자체 결함 (`recommended_scope` 미존재 컬럼) | seed 재적용은 파일 수정 + 별도 승인 후 |

---

## 8. 정합성 복구 방식 후보 (판정 대기)

Q11 결과 도착 후 다음 3가지 옵션 중 하나를 승인 요청:

### 옵션 α — 파일 이동 + 전체 repair (외부 앱 무영향)

1. `git mv docs/03-analysis/learning-profile-migration-draft/084~090_*.draft.sql supabase/migrations/084~090_*.sql`
2. `npx supabase migration repair --status applied 001 002 008 ... 083 084 ... 090` (총 85건, 033b 제외)
3. 091은 `docs/03-analysis/…`에 draft 상태로 유지, 컬럼명 수정만 별도 커밋
4. 033b는 그대로 두거나 옵션 Y로 헤더 주석만 추가

**장점**: CLI 이력이 로컬 파일과 완전 일치. 앞으로 `supabase db pull` / `supabase db diff` / `supabase db push` 모두 정상 동작.
**단점**: 85건의 개별 repair 명령. 스크립트 필요.
**리스크**: repair는 원격 스키마 무영향. 명령 오류가 나도 되돌리기 안전 (§9).

### 옵션 β — 최소 repair (084~090만)

1. 파일 이동은 동일
2. 084~090만 repair (7건)
3. 001~083은 현재처럼 이력 없이 방치

**장점**: 명령 수 최소.
**단점**: 사용자 우려대로 001~083 이력 부재 그대로 → 향후 `supabase db push` 시 CLI가 001~083을 재실행하려 시도 → 이미 존재하는 객체에서 실패. 즉 이 옵션은 향후 `db push`를 영원히 사용하지 못하게 만듦.

### 옵션 γ — 이력 정합 미실시 (현상 유지)

1. 파일 이동 안 함
2. repair 안 함
3. 지금까지처럼 사용자가 필요할 때만 Studio SQL Editor에서 직접 실행

**장점**: 아무 명령도 실행하지 않음. 리스크 0.
**단점**: 로컬 파일과 원격 이력 불일치 지속. 새 마이그레이션 관리자가 혼란. 스테이징/개발 환경 재현 시 매번 수동.

**잠정 권장: 옵션 α** (사용자 우려 완전 해소). 단, 실행 명령 스크립트를 사전 리뷰 후 승인.

---

## 9. 롤백 방법

**A-1 (파일 이동) 롤백**:
```
git mv supabase/migrations/084~090_*.sql docs/03-analysis/learning-profile-migration-draft/084~090_*.draft.sql
```
원격 무관.

**A-3 (repair) 롤백**:
```
npx supabase migration repair --status reverted 090
npx supabase migration repair --status reverted 089
... (역순)
```
원격 `supabase_migrations.schema_migrations` rows만 삭제. **실제 스키마·데이터·RLS 손상 없음**.

**주의**: 실제 테이블·컬럼을 되돌리려면 `DROP TABLE`이 필요하지만, 이는 사용자 지시로 금지. 090까지의 스키마는 그대로 유지됨.

---

## 10. 대기 사항 (재확인)

**진행 안 함**:
- migration repair (모든 version)
- 이력 테이블 직접 생성 · INSERT
- 033b rename / 파일 이동 / 삭제
- 084~090 파일 이동
- 091 수정 · 재실행
- commit / push / db push
- draft SQL 실행

**진행 승인 요청** (사용자 결정 대기):
- **[요청 1]** Q11-a ~ Q11-j 실행 (읽기 전용, 원격 대조 확정)
- **[요청 2]** 이 문서 커밋 (`docs/03-analysis/migration-history-mapping.md`)
- **[요청 3]** Q11 결과 후 옵션 α/β/γ 중 선택
- **[요청 4]** 033b 옵션 X/Y/Z 중 선택

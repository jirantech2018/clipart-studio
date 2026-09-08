# Learning Profile 설계안 (M2-1.8 착수 전 사전 검토, 2026-09-09)

> **상태**: DRAFT — 사용자 승인 대기.
> 원격 Supabase apply 금지. 애플리케이션 구현 금지. Legacy guards 삭제 금지.
> 1~6학년 대량 seed 금지. M2-2 표본 생성 금지. 프로덕션 배포 금지.
>
> 이 문서는 사용자 지시 (2026-09-09) 에 따라 M2-1.8 (§learning-helper.plan.md v0.6) 을 실제 DB 구조와 정합시키기 위한 **분석·설계 초안**입니다. 승인 후에만 실 마이그레이션·구현으로 이동합니다.

---

## ① 기존 DB 사전 확인 결과

실 Supabase 마이그레이션 (078~083 apply 완료) 을 코드에서 확인한 결과:

| 테이블 | PK / 주요 FK | 실 스키마 특징 | 새 명세 대비 |
|---|---|---|---|
| `learning_subjects` | `code TEXT PRIMARY KEY` ('KOR', 'MATH', 'INT', 'SOC', …) | uuid **아님** | 새 명세의 `subject_id uuid REFERENCES learning_subjects(id)` 는 **부적합** → `subject_code TEXT` 로 조정 |
| `learning_material_types` | `code TEXT PRIMARY KEY` ('multiple_choice', 'individual_activity', …) | uuid 아님 | `material_type_id uuid` → `material_type_code TEXT` |
| `learning_common_topics` | `id UUID PRIMARY KEY`, `(grade, subject_code, unit, topic)` UNIQUE | **unit + topic 두 필드 하이브리드** — 같은 unit 이 여러 topic 행으로 반복. 즉 3항 옵션 중 **"3. 단원과 세부 주제를 함께 저장"** | 새 명세의 `unit_id uuid REFERENCES learning_common_topics(id)` 는 unit 하나가 여러 row 로 흩어져 있어 **의미 왜곡** → §⑧ 권장안 참조 |
| `learning_documents` | `id UUID`, `user_id UUID` (profiles.id 참조), `organization_id UUID`, `subject_code TEXT`, `material_type_code TEXT` | 정상 | `document_id UUID` 참조 그대로 |
| `generation_jobs` | `id UUID`, `kind` enum ('single', 'package', 'learning_doc') | 정상 | 변경 없음 |
| **RLS 헬퍼** | `public.is_org_member(org_id UUID, uid UUID) RETURNS BOOLEAN` (033, SECURITY DEFINER STABLE) | 조직 활성 멤버 여부 캐시 | 신규 테이블 RLS 에서 재사용 (인라인 EXISTS 대신) |
| **최신 Migration 번호** | **083** | 084 부터 사용 가능 | draft 파일도 084~091 로 잡음 |
| **`profiles.id`** | UUID (auth.users 미러) | `user_id` FK 대상 | `created_by / approved_by` FK 는 `profiles(id)` 로 (auth.users 직접 참조는 실 스키마와 불일치) |

**요약**: 새 명세가 uuid FK 를 가정한 부분은 **모두 TEXT code FK 로 재작성**이 필요합니다. 이건 draft SQL 에 반영 완료.

---

## ② §M2-1.8 (plan v0.6) vs 새 명세 — 차이 · 누락 · 충돌

| 항목 | v0.6 §M2-1.8 | 새 명세 | 조치 |
|---|---|---|---|
| 교육과정·프로필 버전 관리 | 없음 | `learning_profile_sets` (draft/active/archived) | **신규 추가** — plan v0.7 §M2-1.8 반영 |
| 과목 아래 영역 구조 | 없음 (subject 만) | `learning_domains` | **신규 추가** |
| LearningProfile 계층 구조 | 단일 flat 인터페이스 (grade + subject + domain + unit 필드) | 5 계층 scope (curriculum / grade_subject / domain / unit / exception) + parent_profile_id + priority + version | **확장** — 계층 병합 규칙 §⑩ 신설 |
| 프로필 병합 | 언급 없음 | 명세 §13 "curriculum → grade_subject → domain → unit → exception" + JSONB 필드별 병합 규칙 | **신설** |
| 자료유형별 권장/허용/비권장 | recommendedQuestionTypes / unsuitableQuestionTypes (문자열 배열) | 별도 테이블 `learning_profile_material_types` + suitability enum + priority + guidance JSONB | **테이블 분리** |
| 문서 단위 검수 결과 저장 | Layer 3 결과를 handler 리턴만, 저장 없음 | `learning_evaluations` (stage/attempt/passed/profile_snapshot/tokens/duration) | **신규 저장** |
| item_id 기반 문항별 결과 | failedItemIndexes (숫자 배열) | `learning_evaluation_items` + LearningDocument 에 `itemId` 부여 | **item 식별자 신규 필드** — orchestrator 에서 발급 |
| 실패 문항 부분 재생성 기록 | 언급만, 저장 없음 | `learning_repair_attempts` (원본/재생성/실패사유 감사) | **신규 저장** — 이번 단계 필수 여부 판단 필요 (§⑮ 커밋 분리 참조) |
| 프로필 snapshot | 언급 없음 | `learning_evaluations.profile_snapshot JSONB` — 프로필이 나중에 개정돼도 당시 판정 근거 재확인 가능 | **신설** |
| RLS · 조직 권한 재사용 | 없음 (learning_documents 만 있음) | 기존 `is_org_member` 헬퍼 재사용 명시 | **draft SQL 에 반영 완료** |
| 최소 seed vs 전체 seed 분리 | 언급만 | 스키마 파일 (084~090) 과 seed 파일 (091) 분리, seed 는 draft 로만 | **분리 완료** |
| Legacy guards 격리·제거 조건 | plan v0.6 §M2-1.8 ⑤ 에 이미 있음 | 명세와 정합 | **유지** |

**충돌 없음**. 새 명세는 v0.6 의 인터페이스를 실제 DB 테이블로 구체화하는 방향. 다만 uuid vs TEXT code FK 는 실 스키마 준수로 조정 (§①).

---

## ③ plan.md 에서 수정할 항목

`docs/01-plan/features/learning-helper.plan.md` v0.7 로 다음 수정:

- v0.6 § M2-1.8 **② LearningProfile 최소 스키마**: `subject: SubjectCode` (uuid 아님, TEXT code) + `unit: string` (uuid 아님, learning_common_topics.unit 매칭 문자열)
- 새 섹션 **⑪ 프로필 병합 규칙** — 명세 §13 을 그대로 반영
- **⑦ 파일 목록** 에 신규 테이블 7개 (`learning_profile_sets` / `learning_domains` / `learning_profiles` / `learning_profile_material_types` / `learning_evaluations` / `learning_evaluation_items` / `learning_repair_attempts`) 추가
- **⑨ 완료 기준** 에 "프로필 버전 관리 (draft → active → archived) 동작", "프로필 병합 규칙 코드 구현" 추가
- Migration 번호 예상: 084~091 (draft 상태로 이 문서 하위에 위치)

승인 후 별도 커밋으로 반영.

---

## ④ 최종 테이블 관계와 책임

```
┌────────────────────────┐
│ learning_profile_sets  │  교육과정 · 프로필 세트 버전 (KR_ELEM_2022_V1)
└──────────┬─────────────┘
           │ 1:N
┌──────────▼─────────────┐            ┌──────────────────────┐
│ learning_profiles      │──── FK ────│ learning_subjects    │ (기존, TEXT PK)
│  · scope_type 5종      │            └──────────────────────┘
│  · JSONB 프로필 필드    │            ┌──────────────────────┐
│  · parent + version    │──── FK ────│ learning_domains     │ (신규, 국어→읽기 등)
│  · draft/active/arch.  │            └──────────────────────┘
└─────┬─────────┬────────┘            (unit 은 uuid FK 아니라 unit_name TEXT 튜플 매칭)
      │         │
      │ 1:N     │ 1:N
      │         ▼
      │   ┌────────────────────────────────┐
      │   │ learning_profile_material_types│ 프로필 × 자료유형 (권장/허용/비권장)
      │   └────────────────────────────────┘
      │
      │ (선택적 · Layer 3 검수 시 사용된 프로필 링크)
      │
┌─────▼──────────────────┐
│ learning_evaluations   │  문서 단위 검수 결과 (stage=structure/deterministic/semantic/final)
│  · profile_snapshot     │  당시 병합된 프로필 스냅샷
└─────┬──────────────────┘
      │ 1:N
┌─────▼──────────────────────┐
│ learning_evaluation_items  │  item_id 별 (criterion_key, passed, reason)
└─────┬──────────────────────┘
      │
      │ (실패 시 부분 재생성)
      │
┌─────▼──────────────────────┐
│ learning_repair_attempts   │  감사 로그 (attempt=1 CHECK)
└────────────────────────────┘

기존:
┌─────────────────────────┐
│ learning_documents      │  ← learning_evaluations.document_id
│  · org_id → is_org_member │
│  · user_id → profiles(id) │
└─────────────────────────┘
```

**책임**:
- **learning_profile_sets**: 교육과정 세트의 버전 관리. 신규 curriculum 개정이나 실험 세트를 별도 트랙으로 관리.
- **learning_domains**: 과목 하위 영역. 프로필 계층의 3번째 층.
- **learning_profiles**: 프로필의 실체. scope_type 으로 어느 층인지 판별.
- **learning_profile_material_types**: 프로필과 자료유형의 결합. "이 학년·과목·단원 프로필에서 개별활동지는 권장" 같은 매핑.
- **learning_evaluations**: 3계층 검증의 stage 별 결과. profile_snapshot 으로 감사 가능.
- **learning_evaluation_items**: 문항·활동·표 등 재생성 가능 블록 단위 실패.
- **learning_repair_attempts**: 부분 재생성 시도 감사. 최대 1회 CHECK 제약.

---

## ⑤ 신규 Migration 파일 목록

`docs/03-analysis/learning-profile-migration-draft/` (draft 위치 — supabase/migrations/ 밖에 있어 자동 apply 안 됨):

1. `084_learning_profile_sets.draft.sql`
2. `085_learning_domains.draft.sql`
3. `086_learning_profiles.draft.sql`
4. `087_learning_profile_material_types.draft.sql`
5. `088_learning_evaluations.draft.sql`
6. `089_learning_evaluation_items.draft.sql`
7. `090_learning_repair_attempts.draft.sql` — 이번 단계 보류 가능
8. `091_learning_profile_minimum_seed.draft.sql` — 스키마 apply 검증 후 별도

## ⑥ 각 Migration draft SQL

각 파일은 별도로 저장됨. 링크:
- [084_learning_profile_sets.draft.sql](./learning-profile-migration-draft/084_learning_profile_sets.draft.sql)
- [085_learning_domains.draft.sql](./learning-profile-migration-draft/085_learning_domains.draft.sql)
- [086_learning_profiles.draft.sql](./learning-profile-migration-draft/086_learning_profiles.draft.sql)
- [087_learning_profile_material_types.draft.sql](./learning-profile-migration-draft/087_learning_profile_material_types.draft.sql)
- [088_learning_evaluations.draft.sql](./learning-profile-migration-draft/088_learning_evaluations.draft.sql)
- [089_learning_evaluation_items.draft.sql](./learning-profile-migration-draft/089_learning_evaluation_items.draft.sql)
- [090_learning_repair_attempts.draft.sql](./learning-profile-migration-draft/090_learning_repair_attempts.draft.sql)
- [091_learning_profile_minimum_seed.draft.sql](./learning-profile-migration-draft/091_learning_profile_minimum_seed.draft.sql)

새 명세 §15 안전성 원칙 (CREATE ... IF NOT EXISTS, seed 재실행 안전, RLS 정책 pg_policies 확인) 모두 준수.

---

## ⑦ RLS 정책과 기존 권한 헬퍼 재사용

**재사용**: `public.is_org_member(org_id UUID, uid UUID)` (033 에 정의된 SECURITY DEFINER STABLE 헬퍼) — 조직 활성 멤버 여부.

**신규 정책**:
- `learning_profile_sets` / `learning_domains` / `learning_profiles` / `learning_profile_material_types`: 마스터 데이터. `authenticated` 는 `status='active'` (또는 `is_active=TRUE`) 만 SELECT. INSERT/UPDATE/DELETE 는 service_role.
- `learning_evaluations` / `learning_evaluation_items` / `learning_repair_attempts`: 사용자 데이터. `is_org_member` 를 통해 자기 문서의 평가만 SELECT. INSERT/UPDATE 는 service_role.

**anon**: 마스터 데이터 (`learning_domains`) 는 `anon` SELECT 허용 (도메인·과목은 로그인 전에도 표시할 수 있게), 나머지는 authenticated 이상.

## ⑧ `learning_common_topics` 호환성 분석 · 권장안

**현재 구조**: `(id, grade, subject_code, unit, topic, keywords)` — unit + topic 하이브리드. 사용자 §1 확인 결과 옵션 **3 (단원과 추천 세부 주제를 함께 저장)**.

**옵션 비교**:

| 안 | 방식 | 장점 | 단점 |
|---|---|---|---|
| **A안** | `learning_profiles.unit_name TEXT` 로 (grade + subject_code + unit) 튜플 매칭. 기존 테이블 그대로. | 데이터 이전 없음. 최소 변경. | uuid FK 무결성 없음. unit 이름 오타 시 프로필 매칭 실패. |
| **B안** | 신규 `learning_units` (unit 별 1행) + `learning_topic_suggestions` (unit 하위 세부 주제) 분리. 기존은 view 로 유지. | 의미 명확. FK 무결성. 확장 유리. | 이전 작업 필요. API/UI 재작업. 이번 스코프 초과. |

**저의 권장**: **A안 (unit_name TEXT 튜플 매칭)** — M2-1.8 에서. 이유:

1. 사용자 지시 "기존 데이터 이전 X". A안은 이전 없이 즉시 사용 가능.
2. `learning_profiles.unit_name` 을 `(grade_min, subject_code, unit_name)` 인덱스로 조회하면 성능 문제 없음.
3. 오타 방지는 seed 삽입 시 `EXISTS(SELECT 1 FROM learning_common_topics WHERE unit = 'X')` 사전 검사로 대응 가능.
4. 향후 B안으로 이전할 때 `unit_name` → `unit_id` 컬럼 추가 후 backfill 하면 됨. A안이 B안 전환의 이행 경로에 부담 없음.

draft SQL (086) 은 A안으로 작성됨. B안이 낫다는 판단이 서면 승인 시 알려주시면 draft 재작성.

---

## ⑨ 최소 Seed 목록 (`091_...draft.sql`)

**scope**: 초등 공통 + 1~2학년 국·수 + 대표 영역 2개 + 대표 단원 2개 = **총 9개 프로필 (모두 draft)**.

| # | scope | 대상 | 목적 |
|---|---|---|---|
| 1 | curriculum | 초등 공통 프로필 | 자기완결성 · 힌트 정책 등 공통 원칙 |
| 2 | grade_subject | 1학년 국어 | 어휘·문장 15자 이내 등 |
| 3 | grade_subject | 2학년 국어 | 어휘·문장 25자 이내 |
| 4 | grade_subject | 1학년 수학 | (수 세기 위주, deterministic_rules) |
| 5 | grade_subject | 2학년 수학 | (연산 위주) |
| 6 | domain | 국어 읽기 영역 | topicAlignment: 낱말·짧은 글 |
| 7 | domain | 수학 수와 연산 영역 | allowsNegative=false, allowsDecimal=false |
| 8 | unit | 1학년 국어 "낱말과 문장" | 자모 식별로 대체 금지 (unit_name 정확 매칭) |
| 9 | unit | 2학년 수학 "덧셈과 뺄셈" | operationSet=['addition','subtraction'], requiresCarry=true, digitRange 10~99 |

**정책**:
- 모두 `status='draft'` — active 전환은 회귀 테스트 통과 후 별도 UPDATE.
- profile_set 도 `status='draft'` — active 전환은 최소 seed 검증·회귀 통과 후.
- 반복 실행 안전 (ON CONFLICT DO NOTHING / NOT EXISTS 서브쿼리).
- Seed 삽입 전 `learning_common_topics` 에 해당 unit_name 이 실제 존재하는지 확인 필요 (draft SQL 파일 상단 주석 참조).

## ⑩ 프로필 조회·병합 규칙

**조회 (Resolve)**:
```
사용자 입력: { grade=2, subject='MATH', unit='덧셈과 뺄셈' }
  ↓
active profile_set 에서:
  1. curriculum scope (있으면)
  2. grade_subject scope (subject='MATH', grade=2)
  3. domain scope (subject='MATH', domain 이 unit 을 포함하면)
  4. unit scope (subject='MATH', grade=2, unit_name='덧셈과 뺄셈')
  5. exception scope (해당 시)
  ↓ 위에서 아래로 병합 (하위가 우선)
ResolvedLearningProfile
```

**병합 규칙 (필드별)**:

| 필드 | 병합 방식 |
|---|---|
| `learning_goals` | code 기준 dedup + union |
| `prerequisites` | dedup + union |
| `allowed_scope` | union |
| `excluded_scope` | union, 하위 기준 추가 |
| `vocabulary_guidance` | 깊은 병합 (deep merge), 하위 우선 |
| `content_guidance` | 깊은 병합, 하위 우선 |
| `deterministic_rules` | 깊은 병합, 하위 우선 |
| `semantic_criteria` | key 기준 dedup + 하위 우선 |
| 자료유형 guidance | 하위 프로필 우선 완전 대체 |

**exception scope**: 일반 오류 대응 수단으로 남용 X. 교육적으로 특수한 경우 (예: 특정 단원의 개념적 예외) 에만. change_note 필수.

---

## ⑪ TypeScript / Zod 스키마 변경안

**신규 파일**:
- `src/features/learning-helper/domain/learning-profile.ts` — Zod 스키마 + TS 타입
- `src/services/learning-validators/types.ts` — EvaluationResult 등

**핵심 스키마 (요약)**:

```typescript
export const LearningGoalSchema = z.object({
  code: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
});

export const ScopeRuleSchema = z.object({
  category: z.string(),
  values: z.array(z.string()),
});

export const VocabularyGuidanceSchema = z.object({
  readingLevel: z.string(),
  maxSentenceLength: z.number().int().positive().optional(),
  useConcreteVocabulary: z.boolean().optional(),
  avoid: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export const DeterministicRulesSchema = z.object({
  math: z.object({
    operationSet: z.array(z.enum(['addition','subtraction','multiplication','division','count','compare'])).optional(),
    numberRange: z.object({ min: z.number(), max: z.number() }).optional(),
    requiresCarry: z.boolean().optional(),
    allowsNegative: z.boolean().optional(),
    allowsDecimal: z.boolean().optional(),
  }).optional(),
  multipleChoice: z.object({
    choiceCount: z.number().int().min(2).max(6).optional(),
    requiredCorrectAnswerCount: z.number().int().min(1).optional(),
    allowDuplicateChoices: z.boolean().optional(),
  }).optional(),
}).catchall(z.unknown()); // 확장 필드 허용

export const SemanticCriterionSchema = z.object({
  key: z.enum(['topicAlignment','gradeSuitability','hintLeakage','selfContained','naturalness']),
  label: z.string().optional(),
  required: z.boolean().default(true),
  instruction: z.string(),
});

export const LearningProfileSchema = z.object({
  id: z.string().uuid(),
  profileSetId: z.string().uuid(),
  subjectCode: z.string().nullable(),
  domainId: z.string().uuid().nullable(),
  unitName: z.string().nullable(),
  scopeType: z.enum(['curriculum','grade_subject','domain','unit','exception']),
  gradeMin: z.number().int().min(1).max(6),
  gradeMax: z.number().int().min(1).max(6),
  title: z.string(),
  learningGoals: z.array(LearningGoalSchema),
  prerequisites: z.array(z.string()),
  allowedScope: z.array(ScopeRuleSchema),
  excludedScope: z.array(ScopeRuleSchema),
  vocabularyGuidance: VocabularyGuidanceSchema,
  deterministicRules: DeterministicRulesSchema,
  semanticCriteria: z.array(SemanticCriterionSchema),
  priority: z.number().int(),
  status: z.enum(['draft','active','archived']),
  version: z.number().int().min(1),
});

export const ResolvedLearningProfileSchema = LearningProfileSchema.extend({
  merged: z.boolean(),
  sourceProfileIds: z.array(z.string().uuid()),
});

export const EvaluationResultSchema = z.object({
  pass: z.boolean(),
  criteria: z.array(z.object({
    key: z.enum(['topicAlignment','gradeSuitability','hintLeakage','selfContained','naturalness']),
    pass: z.boolean(),
    reason: z.string(),
    failedItemIndexes: z.array(z.number().int().nonnegative()),
  })),
  failedItemIndexes: z.array(z.number().int().nonnegative()),
});

export const EvaluationItemResultSchema = z.object({
  itemId: z.string(),
  itemIndex: z.number().int().nonnegative(),
  itemType: z.enum(['question','activity','table','blank_space','reading_passage','other']),
  criterionKey: z.string(),
  passed: z.boolean(),
  reason: z.string().optional(),
  severity: z.enum(['warning','error']).default('error'),
  repairAction: z.enum(['none','rewrite_item','replace_item','recalculate','manual_review']).optional(),
});
```

**LearningDocument 스키마 확장 (services/learning-renderer/schema.ts)**:
- 각 재생성 가능 블록 (question / activity / table / blank_space) 에 `itemId?: string` 추가 (선택 필드, 기존 데이터 호환).
- orchestrator 가 신규 생성 시 UUID 또는 짧은 stable ID 부여.

**Zod 검증 실패 시**: AI 호출은 시도하지 않고 내부 설정 오류 로그로 처리 (사용자에게는 일반 오류).

---

## ⑫ 롤백 방법

**Migration 단위 롤백**:
- 각 신규 테이블에 대해 `DROP TABLE IF EXISTS public.learning_XXX CASCADE;` 스크립트 별도 준비 (docs draft 위치에 `rollback/` 하위).
- 순서 역순: 090 → 089 → 088 → 087 → 086 → 085 → 084.
- Seed (091) 롤백은 `DELETE FROM learning_profile_sets WHERE code='KR_ELEM_2022_V1';` (CASCADE 로 하위 자동 삭제) — 하지만 실제로는 원격 db push 후 SQL Editor 로 직접 실행.

**부분 롤백**: `learning_repair_attempts` (090) 만 이번 스코프 밖으로 미룰 경우 `DROP TABLE learning_repair_attempts CASCADE;` 로 개별 제거.

**애플리케이션 롤백**: 3계층 orchestrator 도입 커밋을 revert. handler 는 legacy guards 로 fall through 되므로 서비스 자체는 계속 동작.

---

## ⑬ 기존 기능 회귀 위험

| 영역 | 위험 | 완화 |
|---|---|---|
| 이미지 생성 (기존) | 없음 | 신규 테이블·헬퍼는 별개 이름 공간 |
| 학습자료 생성 (M2-1.7 상태) | Legacy guards 유지로 위험 없음 | 신규 3계층은 legacy 와 병행 실행 |
| RLS | 신규 정책이 기존 정책과 이름 충돌 X | pg_policies 조건부 CREATE POLICY 사용 |
| 마이그레이션 순서 | 084~090 은 서로 참조. 잘못된 순서로 apply 시 FK 실패 | supabase CLI 는 파일명 순서로 apply. draft 파일명이 순서 유지 |
| Seed 파일 실패 | 스키마 apply 후 seed 파일에서 unit_name 오탈자로 실패 가능 | 사전 검증 SQL (§⑮) 로 확인 |
| 프로필 성능 | 조회 시 여러 스코프 순회 → N+1 우려 | 인덱스 (idx_learning_profiles_resolve) + 서버 캐시 (선택) |

## ⑭ 구현 커밋 분리 계획

승인 후 아래 커밋 순서 (각 커밋마다 tsc/build/회귀 통과 후 다음 진행):

| Commit | 범위 |
|---|---|
| C1 | plan.md v0.7 (본 문서 반영) — docs 만 |
| C2 | Migration 084 (profile_sets) draft → supabase/migrations/ 이동. `supabase db push`. 검증 쿼리. |
| C3 | 085 (domains). |
| C4 | 086 (profiles). |
| C5 | 087 (profile_material_types). |
| C6 | 088 (evaluations). |
| C7 | 089 (evaluation_items). |
| C8 | 090 (repair_attempts) — 이번 단계 보류 시 skip. |
| C9 | 091 (minimum seed). Seed 후 검증 쿼리. |
| C10 | Zod/TS 스키마 (learning-profile.ts, validators/types.ts). |
| C11 | Layer 1 (structural). Regression fixture 시작. |
| C12 | Layer 2 (deterministic + 수학 검산). Fixture 확장. |
| C13 | Layer 3 (semantic LLM 검수). Fixture. |
| C14 | Orchestrator + 부분 재생성. 회귀 전체 통과. |
| C15 | Legacy guards 격리 (기존 code → learning-validators/legacy-guards.ts). |
| C16 | handler 를 새 orchestrator 로 교체 (legacy 병행). |
| C17 | 회귀 통과 확인 후 사용자에게 M2-2 재개 승인 요청. |

## ⑮ Migration 적용 후 검증 쿼리 · 예상 결과

승인 후 각 apply 단계에서 아래 쿼리로 확인:

**A. 테이블 존재**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN (
  'learning_profile_sets','learning_domains','learning_profiles',
  'learning_profile_material_types','learning_evaluations',
  'learning_evaluation_items','learning_repair_attempts'
) ORDER BY table_name;
```
기대: 7행 (또는 090 보류 시 6행).

**B. RLS 활성화**
```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname LIKE 'learning_%' AND relnamespace='public'::regnamespace
ORDER BY relname;
```
기대: 신규 7개 모두 `rls_enabled=true`.

**C. 정책 존재**
```sql
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename LIKE 'learning_%' ORDER BY tablename, policyname;
```
기대: 각 테이블에 최소 1개 SELECT 정책.

**D. Seed row count**
```sql
SELECT status, COUNT(*) FROM learning_profile_sets GROUP BY status;
SELECT scope_type, status, COUNT(*) FROM learning_profiles GROUP BY scope_type, status ORDER BY scope_type;
```
기대: profile_set 1 draft. profiles 총 9 draft (curriculum 1, grade_subject 4, domain 2, unit 2).

**E. FK 무결성**
```sql
SELECT COUNT(*) FROM learning_profiles p
LEFT JOIN learning_profile_sets ps ON ps.id = p.profile_set_id
WHERE ps.id IS NULL;
```
기대: 0.

**F. Unit 매칭 검증 (Seed 무결성)**
```sql
-- learning_profiles.unit_name 값이 실제 learning_common_topics 에 존재하는지
SELECT p.subject_code, p.grade_min, p.unit_name
FROM learning_profiles p
WHERE p.scope_type='unit'
  AND NOT EXISTS (
    SELECT 1 FROM learning_common_topics t
    WHERE t.subject_code = p.subject_code
      AND t.grade = p.grade_min
      AND t.unit = p.unit_name
  );
```
기대: 0행 (매칭 안 되면 seed 오탈자).

**G. 기존 기능 회귀**
```sql
-- 최근 이미지 job 정상 흐름 유지
SELECT COUNT(*) FROM generation_jobs
WHERE kind IN ('single','package') AND created_at > NOW() - INTERVAL '7 days';
-- 최근 학습자료 job 정상 흐름 유지
SELECT COUNT(*), status FROM generation_jobs
WHERE kind='learning_doc' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY status;
```
기대: 이미지 job 수 유지. 학습자료 job 정상 status 분포.

---

## 쉬운 요약 (개발자가 아닌 사람 판단용)

**무엇이 바뀌나요?**
- 학년·과목·단원별로 "무엇을 가르치고 무엇은 피해야 하는지" 규칙을 **코드에 조건문으로 박아 넣던 방식**에서, **DB 테이블에 데이터로 저장**하는 방식으로 바꿉니다.
- 예: 지금은 "수학 자료에 자모 문항 금지" 라는 규칙이 코드 안에 있어서, 새 과목·단원이 늘어날 때마다 코드를 고쳐야 합니다. 앞으로는 그 규칙을 **프로필 데이터** 로 저장해서, 새 학년·과목·단원을 추가할 때는 **DB에 한 줄 추가하면 끝**.

**어떤 값이 코드에서 DB 로 이동하나요?**
- 학년별 어휘 수준 (예: 1학년은 문장 15자 이내)
- 자료 범위 (예: 받아올림 덧셈은 두 자리 수, 곱셈 금지)
- 문항 유형 권장·비권장
- 검수 기준 (제목 일치·힌트 노출·자연스러움 등)

**새 학년·과목·단원을 코드 수정 없이 추가할 수 있나요?**
- **네**. 프로필 데이터만 DB에 추가하면 생성·검수 로직이 그대로 사용됩니다. 3학년·4학년 확대 시 코드 변경 없이 프로필만 삽입.
- 다만 "수학 계산이 맞는지" 같은 코드 검산 로직은 공통 검증기로 유지 (프로필로 뺄 수 없는 부분).

**DB만 만들고 끝나는 건가요?**
- **아닙니다**. 아래 흐름이 실제 애플리케이션에 연결됩니다:
  ```
  사용자 입력 → 프로필 조회·병합 → 생성 AI 에 병합 프로필 전달 →
  구조 검증 → 결정적 검증 (수학 검산) → 교육적 AI 검수 →
  실패한 문항만 최대 1회 재생성 → 재검수 → 저장
  ```

**이번 단계에서 적용하는 것 vs 보류하는 것**

| 이번 단계 (승인 후) | 보류 |
|---|---|
| DB 스키마 (084~090) 신설 | 1~6학년 전체 프로필 대량 입력 |
| 1~2학년 국·수 최소 프로필 9개 seed (draft) | 프로필 active 전환 |
| Zod/TS 스키마 확정 | 기존 legacy guards 삭제 |
| Layer 1/2/3 구현 + 회귀 fixture | M2-2 표본 생성 재개 |
| Legacy guards 격리 (병행 실행) | 프로덕션 배포 |

**언제 실제로 원격 DB에 적용되나요?**
- 사용자 승인 → C1 부터 순차 apply.
- 각 커밋 apply 후 검증 쿼리 통과 확인.
- 회귀 fixture (R1~R12) 전체 통과.
- 사용자 최종 승인 → 프로덕션 배포 + M2-2 재개.

**지금 만들어진 것**
- 이 설계 문서 (본 파일)
- Migration draft SQL 7개 (docs 하위, 원격 apply 안 됨)

**지금 만들어지지 않은 것**
- 애플리케이션 코드 (Zod 스키마·Layer 구현·orchestrator·legacy 격리 모두 미구현)
- 원격 DB 변경
- 프로덕션 배포

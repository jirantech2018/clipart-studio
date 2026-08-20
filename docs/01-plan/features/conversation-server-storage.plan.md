# Conversation Server Storage — Plan (v0.2)

**Feature**: 대화 히스토리 서버 저장 (Source of Truth 이관)
**Status**: PLAN (착수 승인 대기)
**Author**: 지시서 2026-08-20 반영
**Depends on**: 001_profiles, 033_organizations_expand, 057_token_pools, 060_credit_service_rpcs, 067_token_pools_auto_provision, 073_image_trash

---

## 1. 목표

Zustand + localStorage 로 저장돼 있던 Conversation / Block 데이터를 **Supabase 서버**로 이관해 다음을 달성한다.

- 프롬프트 작성만 하고 생성 안 한 대화도 유실되지 않음
- 브라우저 재실행 · 다른 기기 로그인에서도 동일 계정의 대화 복원
- Soft Delete 로 실수 삭제 복구 가능
- 조직(workspace) 단위 격리 유지

**Non-Goals** (이번 스코프 밖)
- `generations` / `generation_assets` 신설 (기존 `generation_jobs` / `images` 재사용)
- Realtime 실시간 동기화 (polling / invalidation 로 충분)
- 오프라인 편집·동기화 (localStorage 는 캐시 · 마이그레이션 원본으로만)
- 관리자용 대화 조회 UI (별도 Feature)

---

## 2. 최종 데이터 모델

지시서 §3 4단계 구조를 클립아트스튜디오 기존 스키마에 맞춰 축소.

```
conversations                       ← [신설]
    ↓ 1:N
conversation_messages               ← [신설]
    ↓ 1:N (message_id FK)
generation_jobs (기존)              ← 재사용, message_id 컬럼만 추가
    ↓ 1:N
images (기존)                       ← 무변경, generation_jobs.id = images.batch_id
```

**핵심 결정**  
지시서의 `generations` = 기존 `generation_jobs`,  `generation_assets` = 기존 `images`. 신설하지 않는다. 이유:
- 기존 Job Pipeline (SSE, 크레딧 원자 차감, 슬롯 원자 claim, 재실행, 환불) 이 이 두 테이블에 이미 견고히 안착
- 지시서 §11 "기존 구조 재사용" 원칙과 §13 "기존 이미지 생성 기능 유지" 원칙에 부합
- `generation_jobs.prompt` 는 이미 저장 중 → Message 와의 연결만 추가하면 됨

### 2.1 `conversations` (신설)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK DEFAULT gen_random_uuid() | 클라이언트에서 미리 생성 (upsert · idempotency) |
| `user_id` | UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE | 소유자 |
| `organization_id` | UUID NOT NULL REFERENCES organizations ON DELETE RESTRICT | 워크스페이스 격리 |
| `title` | TEXT | NULL = 미확정. 첫 이미지 생성 성공 시 서버 트리거 아닌 앱 코드가 세팅 |
| `status` | conversation_status_enum NOT NULL DEFAULT 'active' | `active` \| `archived` \| `deleted` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | 트리거 자동 갱신 |
| `last_activity_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | 사이드바 정렬 기준 |
| `deleted_at` | TIMESTAMPTZ | Soft Delete 시각 (status=deleted 와 동시 세팅) |

**Indexes**
- `(user_id, organization_id, last_activity_at DESC) WHERE deleted_at IS NULL` — 사이드바 조회
- `(organization_id, status) WHERE deleted_at IS NULL` — 관리 통계

**RLS** (다른 사용자 소유 조회 완전 차단)
- SELECT: `auth.uid() = user_id`
- INSERT: `auth.uid() = user_id`
- UPDATE: `auth.uid() = user_id`
- DELETE: 없음 (Soft Delete 만)
- service_role: ALL (마이그레이션·관리 백필용)

### 2.2 `conversation_messages` (신설)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK DEFAULT gen_random_uuid() | 클라이언트 pre-generated |
| `conversation_id` | UUID NOT NULL REFERENCES conversations ON DELETE CASCADE | |
| `role` | conversation_message_role_enum NOT NULL | `user` \| `assistant` \| `system` (1차 배포는 `user` 만 사용) |
| `prompt` | TEXT NOT NULL DEFAULT '' | 사용자 입력 텍스트. draft 중 debounce 업서트 |
| `options` | JSONB | BlockOptions (batchSize, aspectRatio, seeds, style, ref imageIds 등) 스냅샷. Block.options 그대로 |
| `package_plan` | JSONB | 패키지 모드 스냅샷 (해당 시) |
| `status` | conversation_message_status_enum NOT NULL DEFAULT 'draft' | `draft` \| `submitted` \| `completed` \| `failed` |
| `job_id` | UUID REFERENCES generation_jobs ON DELETE SET NULL | 이 message 로 실행된 최신 job |
| `order_index` | INT NOT NULL DEFAULT 0 | 같은 conversation 안 순서 |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | 트리거 자동 갱신 |

**Indexes**
- `(conversation_id, order_index)` — 대화 열기 시 순서 로드
- `(job_id) WHERE job_id IS NOT NULL` — Job → Message 역참조

**RLS**
- SELECT: `EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_messages.conversation_id AND c.user_id = auth.uid())`
- INSERT / UPDATE: 위와 동일
- DELETE: 없음 (CASCADE via conversation delete)

### 2.3 `generation_jobs` (기존, 컬럼만 추가)

```sql
ALTER TABLE public.generation_jobs
  ADD COLUMN conversation_id UUID REFERENCES conversations ON DELETE SET NULL,
  ADD COLUMN message_id     UUID REFERENCES conversation_messages ON DELETE SET NULL;

CREATE INDEX idx_generation_jobs_conversation
  ON public.generation_jobs(conversation_id)
  WHERE conversation_id IS NOT NULL;
```

기존 job 은 두 컬럼이 NULL 로 남고, 신규 job 부터 필수적으로 채워진다. Backfill 은 하지 않는다 (구 job 은 대화 컨텍스트 없이 만들어졌음).

### 2.4 `images` (기존, 변경 없음)

`images.batch_id = generation_jobs.id` 연결 유지. 이미지 → 대화 조회는 `images → generation_jobs.conversation_id` join 으로 처리.

---

## 3. Migration 목록

| # | 파일 | 내용 |
|---|---|---|
| 075 | `conversations_and_messages.sql` | 두 enum + 두 테이블 + 인덱스 + RLS + updated_at 트리거 |
| 076 | `generation_jobs_link_conversation.sql` | `generation_jobs` 에 conversation_id / message_id 컬럼 추가 |

---

## 4. API 표면

기존 `apiOk` / `apiError` 패턴, `createSupabaseServerClient()` 인증 그대로 따른다.

| Method + Path | 역할 |
|---|---|
| `GET /api/conversations?organizationSlug=xxx&limit=20&cursor=xxx` | 사이드바 목록 (soft-deleted 제외, last_activity_at DESC) |
| `POST /api/conversations` | 새 대화 생성. Body: `{ id?, organizationSlug }` (id 는 클라이언트 pre-gen 가능) |
| `GET /api/conversations/:id` | 대화 상세 + messages 배열 (blocks 대체) |
| `PATCH /api/conversations/:id` | 제목·status 수정 |
| `DELETE /api/conversations/:id` | Soft delete (status=deleted, deleted_at=NOW()) |
| `POST /api/conversations/:id/messages` | 메시지 신규 upsert. Body: `{ id?, prompt, options, order_index }` |
| `PATCH /api/messages/:id` | draft 프롬프트/옵션 debounce 저장 |

**Job 생성 API 확장**
- `POST /api/jobs` body 에 `conversationId`, `messageId` 필드 추가 (선택). 넘어오면 `generation_jobs` INSERT 에 그대로 저장. 없으면 NULL (구 클라이언트 호환).

---

## 5. 클라이언트 전략 — 점진적 전환

### 5.1 conversationStore 리팩터링 원칙

- **기존 인터페이스 최대한 유지** (지시서 §13 점진적 전환). GenerateV2Client · ConversationBlock 등이 쓰는 mutation 함수 시그니처는 변경하지 않음.
- **원칙 (v0.2 명확화)**:
  - **Supabase = 유일한 Source of Truth**
  - **Zustand / localStorage = UI 상태 · optimistic 반영 · 오프라인 임시 보관용 캐시**
  - 서버와 로컬이 충돌하면 **항상 서버 값 기준으로 복구** (마운트 시 서버 조회 결과가 로컬을 덮어씀; 로컬 pending write 는 서버 반영 후 clear)
- 내부 persistence layer 만 교체:
  - **write**: 각 mutation 이 로컬 상태 갱신 (optimistic) + 서버 API 호출 (debounce)
  - **read**: 마운트 시 서버 조회. TanStack Query 결과가 UI 원천. Zustand 는 즉시성만 담당하고 refetch 로 정정
- 서버 실패 시 로컬 상태 유지 · 재시도 큐 (오프라인 방어). 단 다음 성공한 서버 응답이 오면 로컬 pending 은 무효화

### 5.2 debounce 저장

- 프롬프트 입력 · 옵션 변경 → Zustand 즉시 반영 → **1.5초 debounce** 후 `PATCH /api/messages/:id`
- 페이지 이탈 방어 (v0.2 보강):
  - `visibilitychange` (document.hidden=true 시) → pending 있으면 즉시 flush
  - `pagehide` (모바일 · bfcache 안전) → 동일
  - `beforeunload` (데스크톱 fallback) → 동일
  - 이 세 이벤트에서는 **`fetch(url, { method: 'PATCH', body, keepalive: true })`** 로 종료 상황에서도 전송 시도 (fire-and-forget 이 아니라 브라우저가 페이지 종료 후에도 요청 완료 보장)
  - 오프라인 큐/재시도는 이번 스코프 밖 (지시서 §13 "지나치게 복잡한 오프라인 동기화 제외")

### 5.3 사이드바 (ConversationSidebar)

- 현재 `useConversationStore` 로컬 조회 → **`useConversations(organizationSlug)` TanStack Query** 로 전환
- Query key: `['conversations', organizationSlug]`
- 새 대화 · 삭제 · 제목 변경 시 invalidation
- Optimistic add: `+ 새로운 대화` 클릭 즉시 UI 에 추가 → 서버 응답 실패 시 rollback

### 5.4 removeEmptyConversation 제거

- 서버가 SoT 이므로 "빈 대화 자동 삭제" 정책 폐기
- 사용자가 명시적 삭제 UI 로만 삭제 (Soft Delete)
- localStorage 캐시 정리는 hydration 시 서버 목록에 없는 항목을 제거하는 방식으로 대체

### 5.5 confirmConversationTitle

- 첫 이미지 생성 성공 시 호출되던 title 세팅 로직 유지
- 로컬 store + `PATCH /api/conversations/:id { title }` 병행

---

## 6. Legacy 데이터 이관 (1회성)

**흐름**
1. 로그인 후 GenerateV2Client 마운트
2. `useConversationMigration()` 훅 진입 (idempotent 플래그 체크)
3. localStorage `clipart-conversation-v2` 로드
4. `POST /api/conversations/migrate` — 서버가 upsert (id 는 로컬 UUID 그대로 → 재실행 시 중복 없음)
5. 성공 시 사용자별 `localStorage.setItem('clipart-conversation-migrated-v1', '<timestamp>')` 마킹
6. **localStorage 데이터는 삭제하지 않음** (지시서 §6 안전장치)

**서버 처리 (`POST /api/conversations/migrate`)**
- Body: `{ conversations: [{ id, title, blocks, organizationSlug, createdAt, updatedAt }] }`
- 각 conversation 에 대해:
  - `ON CONFLICT (id) DO NOTHING` INSERT
  - 각 block → conversation_message 변환 후 `ON CONFLICT (id) DO NOTHING` INSERT
  - block.jobId 가 있고 그 job 이 이 유저 소유면 `job.conversation_id / message_id` UPDATE (없으면 스킵)

---

## 7. 삭제 정책 (Soft Delete)

- UI: 사이드바 각 항목에 `⋯` 메뉴 → "대화 삭제" (기본 hover 상태에서 노출)
- 클라: `DELETE /api/conversations/:id` → status=deleted, deleted_at=NOW()
- 서버 반환: 성공 시 200. 목록 재조회는 deleted 제외
- Hard delete: 별도 cron (30일 이상 경과 항목 하드 삭제). 이번 스코프 밖. 마이그레이션 문서화만.

---

## 8. 완료 조건 (지시서 §14)

- [ ] 테스트 A — 새 대화 → 프롬프트 → 이미지 생성 X → 다른 대화 이동 → 돌아옴 → 프롬프트 유지
- [ ] 테스트 B — 프롬프트 작성 → 새로고침 → 복원
- [ ] 테스트 C — 브라우저 종료 → 재접속 → 복원
- [ ] 테스트 D — 이미지 생성 실패 → Conversation · Message 유지
- [ ] 테스트 E — Conversation → Message → Generation(=job) → 결과 이미지 관계 유지
- [ ] 테스트 F — 다른 기기 로그인 → 기존 대화 조회
- [ ] 테스트 G — 삭제 → Soft Delete (deleted_at 세팅, 목록 미노출)
- [ ] 테스트 H — 기존 localStorage 대화 이관 → 재실행 시 중복 없음

---

## 9. 착수 순서 (제안)

**Phase 1 — DB (0.5일)**
- Migration 075, 076 작성 · 로컬 실행 · Supabase 프로덕션 실행

**Phase 2 — Server API (0.5일)**
- `/api/conversations/*`, `/api/messages/*`, `/api/conversations/migrate`
- `/api/jobs` body 확장 (conversationId · messageId)

**Phase 3 — Client Sync (0.5일)**
- `useConversations` · `useConversationMutations` 훅
- conversationStore 내부 persistence layer 교체 (인터페이스 유지)
- debounce 저장 훅 (`useMessageDraftAutosave`)

**Phase 4 — UI (0.3일)**
- ConversationSidebar 서버 조회 전환 + 삭제 메뉴 · optimistic add
- ConversationBlock 프롬프트 저장 debounce 연결
- removeEmptyConversation 호출 제거

**Phase 5 — Migration (0.2일)**
- 1회성 이관 훅 · 서버 처리
- 완료 마킹 · idempotency 테스트

**Phase 6 — Verification (0.2일)**
- 완료 조건 8개 수동 · 자동 검증
- 프로덕션 배포 (Migration → Server → Client 순서 엄수)

**총 예상: 2~2.5일**

---

## 10. Open Decisions (착수 전 확인 필요)

- **D-1**: `conversation_messages.role` 은 1차 배포 `user` 만? 지금 클라이언트에는 assistant 개념이 없으므로 컬럼만 두고 값은 `user` 로 고정 예정
- **D-2**: 사이드바 개수 상한 — 지금 20건 (localStorage 시절). 서버 조회 후에도 20건 유지할지, 무한 스크롤로 확장할지
- **D-3**: 조직 관리자의 조직 내 대화 목록 조회 권한 — 지시서 §8 "별도 설계" 라 이번 스코프 밖으로 보되, 향후 확장 열어둘지 (RLS 컬럼만 미리 둘지)
- **D-4**: `PATCH /api/messages/:id` 의 draft 저장 최소 debounce 간격 — 1.5초 제안. 낮추면 서버 부담 · 높이면 유실 위험
- **D-5**: legacy 이관 시점 — 첫 로그인 후 마운트 즉시(백그라운드)로 제안. Progress UI 노출 없이 조용히

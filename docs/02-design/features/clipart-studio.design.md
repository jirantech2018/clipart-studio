# ClipArt Studio Design Document

> **Summary**: Pragmatic 아키텍처 기반 계정 자산형 클립아트 서비스 설계. features/* 모듈 격리 + services/* 어댑터로 AI 모델 교체 대응.
>
> **Project**: ClipArt Studio
> **Version**: 0.1.0 (MVP)
> **Author**: sbtmxk20
> **Date**: 2026-07-09
> **Status**: Draft
> **Planning Doc**: [clipart-studio.plan.md](../../01-plan/features/clipart-studio.plan.md)

---

## Context Anchor

> Copied from Plan document. Propagated to Do/Analysis documents.

| Key | Value |
|-----|-------|
| **WHY** | 클립아트가 계정에 축적되지 않는 문제 — 소비형 아닌 자산형 라이브러리 |
| **WHO** | 초/중/고 교사·학생·학교·학교관계자·일반 5개 유형, 기능 동일. School Profile Optional |
| **RISK** | Community 콜드 스타트, AI 비용 폭주, 학교 정체성 희석 |
| **SUCCESS** | 재사용률 ≥30%, 체이닝 재사용률 ≥20%, 배치 선택률 ≥30%, 4주 재방문율 ≥40%, Community 기여율 ≥15% |
| **SCOPE** | P1 Foundation → P2 Generation → P3 Library&Search → P4 Chaining → P5 Community → P6 Polish |

---

## 1. Overview

### 1.1 Design Goals

1. **모델 교체 대응**: gpt-image-1 서비스 중단 시 24시간 이내 FLUX로 fallback 가능한 어댑터 인터페이스
2. **크레딧 정합성**: 30장 배치 중 일부 실패 시 원자적 환불 보장 (재고 관리 수준의 트랜잭션)
3. **저작권 안전지대**: AI 생성 라벨 + Private 기본값 + RLS 강제로 저작권 리스크 최소화
4. **콜드 스타트 회피**: 공식 컬렉션이 첫 사용자에게 항상 결과를 보여주는 안전망
5. **재사용 KPI 측정성**: download_events + parent_image_id로 재사용률·체이닝률 자동 산출

### 1.2 Design Principles

- **Feature Isolation**: features/* 안에서만 도메인 로직 완결. 다른 feature 참조 금지 (services 경유)
- **Adapter Segregation**: 외부 서비스(AI/R2/Tagging)는 인터페이스 뒤로. 구현체 교체가 features에 영향 없음
- **RLS-First Security**: 모든 접근 제어는 DB 레벨 RLS로. 서버 코드 실수해도 데이터 유출 없음
- **Optimistic UI for Search, Pessimistic for Credit**: 검색은 낙관적 캐싱, 크레딧은 서버 확정 후 갱신
- **Server-first for AI Cost**: 이미지 생성은 100% 서버 라우트. 클라이언트 SDK 직접 호출 금지 (API 키 노출 방지)

---

## 2. Architecture Options (v1.7.0)

### 2.0 Architecture Comparison

| Criteria | Option A: Minimal | Option B: Clean | **Option C: Pragmatic** |
|----------|:-:|:-:|:-:|
| **Approach** | Least change, max reuse | Best separation, most maintainable | Good boundaries, balanced |
| **New Files** | ~40 | ~90 | **~60** |
| **Modified Files** | 0 (신규 프로젝트) | 0 | 0 |
| **Complexity** | Low | High | Medium |
| **Maintainability** | Medium | High | High |
| **Effort** | Low | High | Medium |
| **Risk** | Medium (coupled) | Low (clean) | Low (balanced) |
| **Recommendation** | Quick wins, hotfixes | Long-term projects | **✅ Selected** |

**Selected**: **Option C: Pragmatic** — **Rationale**: features/* 모듈 격리로 팀 확장 대응 + services/* 어댑터 격리로 AI 모델 교체 대응. MVP 규모에서 파일 폭발(Clean) 없이 유지보수성 확보.

### 2.1 Component Diagram

```
┌───────────────────────────────────────────────────────────────┐
│                        Client (Next.js 14)                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │  app/*/     │ │ features/*  │ │ components/ │              │
│  │  page.tsx   │ │             │ │ ui (shadcn) │              │
│  │  (routes)   │ │  (domain)   │ │             │              │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘              │
│         │               │               │                     │
│         │        ┌──────▼──────┐        │                     │
│         │        │ lib/store   │        │                     │
│         │        │ (Zustand)   │        │                     │
│         │        └──────┬──────┘        │                     │
│         │               │               │                     │
│         │        ┌──────▼──────┐        │                     │
│         └───────▶│ TanStack    │◀───────┘                     │
│                  │ Query       │                              │
│                  └──────┬──────┘                              │
└─────────────────────────┼─────────────────────────────────────┘
                          │ HTTP + SSE
┌─────────────────────────▼─────────────────────────────────────┐
│                    Server (Next.js Route Handlers)             │
│  ┌─────────────────────────────────────────────┐              │
│  │  app/api/*  (Route Handlers)                │              │
│  │  - jobs (POST + SSE)                        │              │
│  │  - images / search / community / upload     │              │
│  │  - profile / school-profile                 │              │
│  └────────────────────┬────────────────────────┘              │
│                       │                                       │
│  ┌────────────────────▼────────────────────────┐              │
│  │  services/  (Adapter Layer)                 │              │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │              │
│  │  │image-gen │ │    r2    │ │  tagging    │  │              │
│  │  │(iface +  │ │(upload/  │ │(gpt-4o-mini)│  │              │
│  │  │  impl)   │ │  CDN)    │ │             │  │              │
│  │  └──────────┘ └──────────┘ └─────────────┘  │              │
│  │  ┌──────────┐ ┌──────────┐                  │              │
│  │  │  credit  │ │  supabase│                  │              │
│  │  │ (tx)     │ │ (server) │                  │              │
│  │  └──────────┘ └──────────┘                  │              │
│  └────────────────────┬────────────────────────┘              │
└───────────────────────┼───────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┬─────────────────┐
        │               │               │                 │
   ┌────▼─────┐   ┌─────▼──────┐  ┌────▼──────┐  ┌───────▼────────┐
   │ Supabase │   │Cloudflare  │  │  OpenAI   │  │   Replicate    │
   │(Auth +   │   │    R2      │  │gpt-image-1│  │ FLUX schnell   │
   │DB + RLS) │   │ (Storage)  │  │+ 4o-mini  │  │  (fallback)    │
   └──────────┘   └────────────┘  └───────────┘  └────────────────┘
```

### 2.2 Data Flow — 배치 생성 (Killer Flow)

```
[User] "이순신" + 5장 + 학교 스타일 ON
   │
   ▼
[Client] POST /api/jobs
   │  { prompt, batch_size: 5, school_profile_applied: true }
   │
   ▼
[Server] jobs/route.ts
   │  1. Supabase Auth 검증
   │  2. profiles.credits >= 5 확인
   │  3. TX: credits -= 5, generation_jobs INSERT (reserved_credits=5)
   │  4. Job ID 반환 → Client
   │
   ▼
[Client] EventSource(/api/jobs/{id}/stream) 연결
   │
   ▼
[Server] jobs/[id]/stream/route.ts (SSE)
   │  1. school_profiles 조회 (applied=true일 때)
   │  2. 프롬프트 병합: base_prompt + user_prompt + style_desc
   │  3. loop for 5개 (또는 청크 단위 병렬):
   │       a. image-gen adapter 호출 (gpt-image-1)
   │       b. 성공 → R2 업로드 → images INSERT (status='pending')
   │       c. 태깅 서비스 호출 (백그라운드 큐)
   │       d. SSE: {event: 'image_ready', image_id, thumb_url}
   │       e. 실패 → refunded_credits += 1
   │  4. 완료 → TX: refund 적용, job.status='done'
   │  5. SSE: {event: 'done', summary}
   │
   ▼
[Client] TanStack Query invalidate + Zustand batch store 갱신
   │
   ▼
[User] 카드 그리드에 완성 순서대로 카드 등장 → [저장] 선택
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `app/api/jobs` | `services/credit`, `services/image-gen`, `services/r2`, `services/tagging`, `services/supabase` | 배치 생성 오케스트레이션 |
| `services/image-gen` | OpenAI SDK, Replicate SDK | 어댑터 인터페이스 + 구현체 2종 |
| `services/r2` | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | R2 업로드 + Presigned URL |
| `services/credit` | Supabase (SERVICE_ROLE_KEY) | 크레딧 원자적 차감/환불 트랜잭션 |
| `services/tagging` | OpenAI SDK (gpt-4o-mini) | 이미지 자동 태그·카테고리 추출 |
| `features/generation` | `services/image-gen`, `lib/store/generation`, TanStack Query | 배치 생성 UI + SSE 스트림 소비 |
| `features/library` | `services/r2`, PostgreSQL FTS | 라이브러리 조회 + 검색 UI |
| `features/chaining` | `features/library`, `services/image-gen` (i2i 모드) | 부모→자식 재생성 |
| `features/community` | Supabase RLS (community_images View) | 공개 이미지 조회 + 배지 렌더링 |

---

## 3. Data Model

### 3.1 Entity Definition (TypeScript)

```typescript
// src/types/domain.ts

export type AccountType = 'teacher' | 'student' | 'school' | 'school_staff' | 'general';
export type SchoolLevel = 'elementary' | 'middle' | 'high';
export type ImageStatus = 'pending' | 'saved' | 'discarded';
export type GenerationMode = 'text2img' | 'img2img' | 'upscale';
export type JobStatus = 'queued' | 'running' | 'partial' | 'done' | 'failed';
export type ImageModel = 'gpt-image-1' | 'flux-schnell';

export interface Profile {
  id: string;                     // UUID (= auth.users.id)
  email: string;
  accountType: AccountType;
  credits: number;                // default 50
  creditsResetAt: string | null;  // ISO timestamp
  createdAt: string;
}

export interface SchoolProfile {
  userId: string;                 // FK profiles.id
  schoolName: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  mascotDesc: string | null;
  mascotRefUrl: string | null;
  buildingRefUrl: string | null;
  styleDesc: string | null;
  basePrompt: string | null;
  schoolLevel: SchoolLevel | null;
  updatedAt: string;
}

export interface Image {
  id: string;
  userId: string;
  prompt: string;
  negativePrompt: string | null;
  model: ImageModel;
  seed: number | null;
  r2Key: string;
  thumbnailR2Key: string | null;
  isPublic: boolean;
  isUpscaled: boolean;
  upscaledFromId: string | null;
  parentImageId: string | null;    // 이미지 계보
  batchId: string | null;
  generationMode: GenerationMode;
  referenceImageId: string | null;
  schoolProfileApplied: boolean;
  status: ImageStatus;
  pendingExpiresAt: string | null; // 24h 자동 삭제
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  userId: string;
  prompt: string;
  batchSize: number;              // 5, 10, 15, 20, 25, 30
  diversityLevel: number;         // 0~5 (몇 청크가 다양성 강화)
  referenceImageId: string | null;
  schoolProfileApplied: boolean;
  reservedCredits: number;
  refundedCredits: number;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DownloadEvent {
  id: string;
  userId: string;
  imageId: string;
  eventType: 'download' | 'copy_link' | 'chain_source';
  createdAt: string;
}

// Community 조회용 (View)
export interface CommunityImage extends Image {
  authorType: AccountType;
  authorSchoolName: string | null;
}
```

### 3.2 Entity Relationships

```
[auth.users] 1 ─── 1 [profiles]
                        │
                        │ 1
                        ├─── 0..1 [school_profiles]
                        │
                        │ 1
                        └─── N [images]
                                 │
                                 ├─── N [image_tags]
                                 ├─── N [image_categories]
                                 ├─── parent_image_id ──▶ [images] (self-ref)
                                 └─── upscaled_from_id ─▶ [images] (self-ref)

[profiles] 1 ─── N [generation_jobs]
[profiles] 1 ─── N [download_events]

[seed_library] (독립, 사용자 미노출)
[official_collection] N ─── 1 [images] (Seed 중 공개된 것만)
```

### 3.3 Database Schema (PostgreSQL — Supabase)

```sql
-- ============ profiles ============
CREATE TYPE account_type_enum AS ENUM ('teacher','student','school','school_staff','general');

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  account_type account_type_enum NOT NULL DEFAULT 'general',
  credits INT NOT NULL DEFAULT 50 CHECK (credits >= 0),
  credits_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 트리거: auth.users INSERT → profiles 자동 생성
CREATE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, credits_reset_at)
  VALUES (NEW.id, NEW.email, NOW() + INTERVAL '1 month');
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============ school_profiles ============
CREATE TYPE school_level_enum AS ENUM ('elementary','middle','high');

CREATE TABLE school_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  homepage_url TEXT,
  logo_url TEXT,
  primary_color TEXT,
  mascot_desc TEXT,
  mascot_ref_url TEXT,
  building_ref_url TEXT,
  style_desc TEXT,
  base_prompt TEXT,
  school_level school_level_enum,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ images ============
CREATE TYPE image_status_enum AS ENUM ('pending','saved','discarded');
CREATE TYPE generation_mode_enum AS ENUM ('text2img','img2img','upscale');

CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model TEXT NOT NULL,
  seed BIGINT,
  r2_key TEXT NOT NULL,
  thumbnail_r2_key TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  is_upscaled BOOLEAN NOT NULL DEFAULT FALSE,
  upscaled_from_id UUID REFERENCES images(id) ON DELETE SET NULL,
  parent_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  batch_id UUID,
  generation_mode generation_mode_enum NOT NULL DEFAULT 'text2img',
  reference_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  school_profile_applied BOOLEAN NOT NULL DEFAULT FALSE,
  status image_status_enum NOT NULL DEFAULT 'pending',
  pending_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_images_user_status ON images(user_id, status);
CREATE INDEX idx_images_public ON images(is_public) WHERE is_public = TRUE;
CREATE INDEX idx_images_pending_expires ON images(pending_expires_at) WHERE status = 'pending';
CREATE INDEX idx_images_parent ON images(parent_image_id) WHERE parent_image_id IS NOT NULL;
CREATE INDEX idx_images_batch ON images(batch_id) WHERE batch_id IS NOT NULL;

-- ============ image_tags (FTS 대상) ============
CREATE TABLE image_tags (
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (image_id, tag)
);

-- images 테이블에 tsvector 컬럼 (검색 최적화)
ALTER TABLE images ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(prompt, '')), 'A')
  ) STORED;

CREATE INDEX idx_images_search ON images USING GIN (search_vector);

-- ============ image_categories ============
CREATE TABLE image_categories (
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (image_id, category)
);

CREATE INDEX idx_categories_category ON image_categories(category);

-- ============ generation_jobs ============
CREATE TYPE job_status_enum AS ENUM ('queued','running','partial','done','failed');

CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  batch_size INT NOT NULL CHECK (batch_size IN (5,10,15,20,25,30)),
  diversity_level INT NOT NULL DEFAULT 0 CHECK (diversity_level BETWEEN 0 AND 5),
  reference_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  school_profile_applied BOOLEAN NOT NULL DEFAULT FALSE,
  reserved_credits INT NOT NULL,
  refunded_credits INT NOT NULL DEFAULT 0,
  status job_status_enum NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 사용자당 활성 Job 1개 강제
CREATE UNIQUE INDEX idx_jobs_active_per_user
  ON generation_jobs(user_id)
  WHERE status IN ('queued','running');

-- ============ download_events ============
CREATE TABLE download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('download','copy_link','chain_source')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_user_created ON download_events(user_id, created_at DESC);
CREATE INDEX idx_events_image ON download_events(image_id);

-- ============ official_collection ============
CREATE TABLE official_collection (
  image_id UUID PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  curator_note TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ seed_library (내부용, 사용자 미노출) ============
CREATE TABLE seed_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_key TEXT NOT NULL,
  tags TEXT[],
  category TEXT,
  source TEXT,
  license_status TEXT CHECK (license_status IN ('unknown','clear','restricted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ community_images (View) ============
CREATE VIEW community_images AS
SELECT
  i.*,
  p.account_type AS author_type,
  sp.school_name AS author_school_name
FROM images i
JOIN profiles p ON i.user_id = p.id
LEFT JOIN school_profiles sp ON i.user_id = sp.user_id
WHERE i.is_public = TRUE AND i.status = 'saved';

-- ============ RLS 정책 ============

-- profiles: 본인만 조회/수정
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id);

-- school_profiles: 본인만
ALTER TABLE school_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY sp_select_own ON school_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sp_insert_own ON school_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY sp_update_own ON school_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY sp_delete_own ON school_profiles FOR DELETE USING (auth.uid() = user_id);

-- images: 본인 이미지 OR 공개 이미지
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
CREATE POLICY images_select_own_or_public ON images
  FOR SELECT USING (auth.uid() = user_id OR is_public = TRUE);
CREATE POLICY images_insert_own ON images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY images_update_own ON images FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY images_delete_own ON images FOR DELETE USING (auth.uid() = user_id);

-- image_tags / image_categories: images 조회 가능한 것만
ALTER TABLE image_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_select ON image_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM images WHERE id = image_tags.image_id
          AND (user_id = auth.uid() OR is_public = TRUE))
);

-- generation_jobs: 본인만
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_own ON generation_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- download_events: 본인 것만 조회, INSERT는 서버(SERVICE_ROLE)
ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY dl_select_own ON download_events FOR SELECT USING (auth.uid() = user_id);

-- official_collection: 로그인 사용자 전체 조회
ALTER TABLE official_collection ENABLE ROW LEVEL SECURITY;
CREATE POLICY official_read_all ON official_collection FOR SELECT USING (auth.role() = 'authenticated');

-- seed_library: 사용자 접근 불가 (SERVICE_ROLE만)
ALTER TABLE seed_library ENABLE ROW LEVEL SECURITY;
-- (정책 없음 = 아무도 접근 불가)
```

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/profile` | 내 프로필 조회 | Required |
| PUT | `/api/profile` | 계정 유형 변경 | Required |
| GET | `/api/school-profile` | School Profile 조회 | Required |
| POST | `/api/school-profile` | School Profile 생성 | Required |
| PUT | `/api/school-profile` | School Profile 수정 | Required |
| DELETE | `/api/school-profile` | School Profile 삭제 | Required |
| POST | `/api/jobs` | 배치 생성 요청 (사전 크레딧 차감) | Required |
| GET | `/api/jobs/:id/stream` | 배치 진행률 SSE 스트림 | Required |
| GET | `/api/jobs/:id` | Job 상태 조회 | Required |
| GET | `/api/images` | 내 라이브러리 조회 (pagination) | Required |
| GET | `/api/images/:id` | 이미지 상세 (계보 포함) | Required |
| PATCH | `/api/images/:id` | 저장 확정 or 공개 토글 | Required |
| DELETE | `/api/images/:id` | 이미지 삭제 | Required |
| POST | `/api/images/:id/download` | 다운로드 이벤트 로깅 + Presigned URL 반환 | Required |
| POST | `/api/images/:id/upscale` | 고화질 업스케일 (1 크레딧) | Required |
| GET | `/api/search` | 통합 검색 (FTS) | Required |
| GET | `/api/community` | Community 공개 이미지 조회 | Required |
| GET | `/api/official-collection` | 공식 컬렉션 조회 | Required |
| POST | `/api/upload` | 참조 이미지 업로드 (Presigned) | Required |

### 4.2 Detailed Specification (핵심 3개)

#### `POST /api/jobs` — 배치 생성 요청

**Request:**
```json
{
  "prompt": "이순신 장군이 갑옷을 입고 서 있는 모습",
  "batchSize": 5,
  "diversityLevel": 0,
  "referenceImageId": null,
  "schoolProfileApplied": true,
  "generationMode": "text2img"
}
```

**Response (201 Created):**
```json
{
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "reservedCredits": 5,
    "remainingCredits": 45,
    "streamUrl": "/api/jobs/550e8400.../stream"
  }
}
```

**Error Responses:**
- `400 VALIDATION_ERROR`: batchSize가 5의 배수가 아님
- `401 UNAUTHORIZED`: 세션 없음
- `402 INSUFFICIENT_CREDITS`: 크레딧 부족 → `{ error: { code, message, remainingCredits, requiredCredits } }`
- `409 ACTIVE_JOB_EXISTS`: 이미 활성 Job 있음
- `503 UPSTREAM_UNAVAILABLE`: AI 서비스 장애 → 사전 차감 안 함

#### `GET /api/jobs/:id/stream` — SSE 진행률

**Response**: `text/event-stream`

```
event: image_ready
data: {"imageId":"...","thumbnailUrl":"https://r2.../thumb.webp","order":1}

event: image_ready
data: {"imageId":"...","thumbnailUrl":"https://r2.../thumb.webp","order":2}

event: chunk_failed
data: {"order":3,"error":"UPSTREAM_RATE_LIMIT","refundedCredits":1}

event: done
data: {"jobId":"...","completed":4,"failed":1,"refundedCredits":1,"finalRemainingCredits":46}
```

**Client 처리**:
- `image_ready` → TanStack Query cache append + Zustand batch store insert
- `chunk_failed` → 토스트 알림 + credit UI 갱신
- `done` → EventSource close, invalidate `['jobs', id]`, `['profile']`

#### `POST /api/images/:id/download` — 다운로드 로깅

**Request:** (body 없음)

**Response (200 OK):**
```json
{
  "data": {
    "downloadUrl": "https://r2.../full.webp?X-Amz-...",
    "expiresIn": 300
  }
}
```

**Side Effects**:
- `download_events` INSERT (event_type='download')
- 재사용률 KPI 원천 데이터

### 4.3 Error Response Format

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "이번 달 크레딧이 부족합니다.",
    "details": {
      "remainingCredits": 3,
      "requiredCredits": 5,
      "nextResetAt": "2026-08-01T00:00:00+09:00"
    }
  }
}
```

---

## 5. UI/UX Design

### 5.1 Screen Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Header: [Logo] [Search Bar]      [🪙 45] [👤 Profile Menu]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Left Sidebar (240px)  │  Main Content                       │
│  ───────────────────   │  ─────────────                      │
│  🏠 홈                 │  {Route Content}                    │
│  📚 내 라이브러리      │                                     │
│  🌐 Community          │                                     │
│  ⭐ 공식 컬렉션        │                                     │
│  🏫 School Profile     │                                     │
│                        │                                     │
│  (only if logged in)   │                                     │
│                        │                                     │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 User Flow (4 Golden Paths from Plan)

```
[A] 검색 → 재사용
    Home → Search "이순신" → Result Cards → Download

[B] 배치 생성 → 저장
    Home → No Result → [+ AI 생성] → Prompt + Toggles →
    [기본 5장] → SSE Stream (5 Cards) →
    Optional [+ 다양성 강화 5장] → [저장] → Library

[C] 이미지 체이닝 (킬러)
    Library → Image Click → [이 이미지로 생성] →
    Prompt Auto-fill + Preset Chips → Edit → [기본 5장] →
    5 Cards with parent_image_id → [저장]

[D] 공개 → Community 기여
    Library → Image Detail → [공개] Toggle ON →
    Community 풀 노출 → 타 계정 검색/재사용 시 기여도 카운트
```

### 5.3 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `AppHeader` | `src/components/layout/` | 로고 + 검색바 + 크레딧 잔량 + 프로필 메뉴 |
| `AppSidebar` | `src/components/layout/` | 네비게이션 (홈/라이브러리/Community/공식/School) |
| `SearchBar` | `src/features/library/components/` | 통합 검색 입력 + 자동 완성 |
| `ImageCard` | `src/features/library/components/` | 카드 하나 (썸네일 + 프롬프트 + 배지) |
| `ImageGrid` | `src/features/library/components/` | 무한 스크롤 카드 그리드 |
| `AuthorBadge` | `src/features/community/components/` | 🏫/🎒/👤 배지 + 학교명 |
| `GenerationForm` | `src/features/generation/components/` | 프롬프트 + 배치 크기 + 토글들 |
| `SchoolStyleToggle` | `src/features/generation/components/` | 🏫 학교 스타일 적용 스위치 (조건부 렌더링) |
| `BatchProgressPanel` | `src/features/generation/components/` | SSE 스트리밍 + 실시간 카드 등장 |
| `PresetChips` | `src/features/chaining/components/` | 다른 포즈/표정/의상 원클릭 칩 |
| `LineageTree` | `src/features/chaining/components/` | 이미지 계보 3단계 시각화 |
| `PublishToggle` | `src/features/community/components/` | 공개/비공개 토글 (with 저작권 안내) |
| `CreditBadge` | `src/features/auth/components/` | 헤더 크레딧 잔량 + 리셋일 툴팁 |
| `OnboardingWizard` | `src/features/auth/components/` | 계정 유형 선택 + School Profile 등록 분기 |
| `SchoolProfileForm` | `src/features/profile/components/` | School Profile CRUD 폼 (react-hook-form + Zod) |
| `AIGeneratedBadge` | `src/components/ui/` | "AI 생성" 라벨 배지 (모든 이미지 상세) |

### 5.4 Page UI Checklist (v2.1.0) — Gap Detector Reference

#### Home Page (`/`)

- [ ] SearchBar: 중앙 배치, placeholder "찾고 싶은 이미지를 검색해보세요"
- [ ] Section: "공식 컬렉션" 카드 그리드 (초기 방문 시 첫 화면)
- [ ] Section: "최근 인기 Community" 카드 그리드 (is_public=TRUE 최신 24개)
- [ ] Button: [+ AI 생성] 하단 우측 Floating Action Button
- [ ] Empty State: 검색 결과 없을 때 "원하는 이미지가 없나요? AI로 만들어보세요" + [생성] 버튼

#### Search Result Page (`/search?q=...`)

- [ ] SearchBar: 상단 sticky
- [ ] Filter Tab: [전체] [내 라이브러리] [Community] [공식 컬렉션]
- [ ] Result Card: 썸네일 + 프롬프트 (2줄 ellipsis) + AuthorBadge
- [ ] Empty State: "결과 없음" + [AI 생성] CTA
- [ ] Pagination: 무한 스크롤 (20개씩)

#### Generation Page (`/generate`)

- [ ] Textarea: 프롬프트 입력 (min 5자, max 500자)
- [ ] Toggle: 🏫 학교 스타일 적용 (School Profile 등록자만 렌더링)
- [ ] File Upload: 참조 이미지 (Optional, i2i 모드 자동 활성화)
- [ ] Consent Checkbox: 참조 이미지 업로드 시 "본인 권리 이미지만" 동의 (Required)
- [ ] Segmented Control: 배치 크기 [5] [10] [15] [20] [25] [30]
- [ ] Toggle: 다양성 강화 (5장 단위 스텝)
- [ ] Button: [생성 시작 (5 크레딧 소진)] — 잔량 부족 시 disabled + 안내
- [ ] Empty State (batch panel): 생성 전 "결과가 이 영역에 표시됩니다"

#### Batch Progress Panel (Generation Page 내)

- [ ] Progress Bar: 완성 개수 / 배치 크기
- [ ] Card Stream: 완성 이미지 순서대로 등장 (fade-in)
- [ ] Card Action: [저장] [삭제]
- [ ] Chunk Failed Toast: 실패 시 "N장 생성 실패, N 크레딧 환불"
- [ ] Done Banner: "완료: {성공}/{총} · {환불} 크레딧 환불"

#### Library Page (`/library`)

- [ ] Filter Bar: [전체] [저장됨] [Pending (24h)] [공개 중]
- [ ] Sort: [최신순] [오래된순] [체이닝 많은 순]
- [ ] Image Grid: 카드 (썸네일 + 상태 배지 + 공개 여부 표시)
- [ ] Card Action: [상세 보기] [공개/비공개 토글] [삭제]
- [ ] Pending Badge: 만료까지 남은 시간 (예: "23시간 남음")

#### Image Detail Page (`/image/:id`)

- [ ] Full Image: R2 CDN URL
- [ ] AIGeneratedBadge: 우상단 필수 노출
- [ ] Metadata: prompt, model, seed, created_at
- [ ] Tags: 자동 추출된 태그 chip 리스트
- [ ] Category: 카테고리 chip 리스트
- [ ] Button: [다운로드] → Presigned URL
- [ ] Button: [이 이미지로 생성] (체이닝 진입)
- [ ] Button: [고화질 업스케일 (1 크레딧)]
- [ ] Toggle: [공개] (Private/Community 전환) + 저작권 안내 텍스트
- [ ] LineageTree: 부모/자식 이미지 3단계 시각화, 그 이상은 "조상 보기" 링크

#### Chaining Page (Image Detail의 [이 이미지로 생성] 클릭 시)

- [ ] Reference Image: 원본 표시 (썸네일)
- [ ] Textarea: 프롬프트 자동 채움 (편집 가능)
- [ ] Preset Chips: [다른 포즈] [다른 표정] [겨울옷] [뛰는 모습] [계절 버전] — 원클릭 프롬프트 자동 변형
- [ ] Toggle: 🏫 학교 스타일 적용 (조건부)
- [ ] Batch Size Control: 5장 스텝 (Generation과 동일)
- [ ] Button: [생성 시작]

#### Community Page (`/community`)

- [ ] SearchBar: Community 전용 검색
- [ ] Filter: 카테고리 chip 리스트 (동적)
- [ ] Card Grid: 공개 이미지들
- [ ] Card 위 AuthorBadge: 🏫 학교명 / 🎒 학생 / 👤 일반
- [ ] Card Action: [다운로드] [체이닝으로 시작]

#### Profile Page (`/profile`)

- [ ] Info Card: email, account_type, credits, credits_reset_at
- [ ] Section: School Profile
  - 등록된 경우: 수정 폼 노출
  - 미등록: [School Profile 추가하기] CTA
- [ ] Section: 통계 (내 라이브러리 개수, 총 재사용된 횟수, Community 기여 개수)

#### School Profile Form

- [ ] Input: school_name (필수)
- [ ] Input: homepage_url (Optional)
- [ ] Select: school_level (elementary/middle/high)
- [ ] File Upload: logo_url, mascot_ref_url, building_ref_url
- [ ] Color Picker: primary_color
- [ ] Textarea: mascot_desc, style_desc, base_prompt
- [ ] Button: [저장] / [삭제]

#### Onboarding Wizard (신규 가입 후)

- [ ] Step 1: 계정 유형 선택 (5개 라디오 + 아이콘)
- [ ] Step 2: "학교 컨텍스트가 있으신가요?" (예/아니오)
- [ ] Step 3 (예 선택 시): School Profile 등록 폼 (School Profile Form과 동일)
- [ ] Step 3 (아니오): 바로 홈으로
- [ ] Skip Button: 각 단계에서 "나중에 설정" 가능

---

## 6. Error Handling

### 6.1 Error Code Definition

| Code | HTTP | Cause | User Message | Handling |
|------|:----:|-------|--------------|----------|
| VALIDATION_ERROR | 400 | Zod 검증 실패 | "입력값을 확인해주세요" | fieldErrors 표시 |
| UNAUTHORIZED | 401 | 세션 만료 | "다시 로그인해주세요" | Login 페이지로 리다이렉트 |
| FORBIDDEN | 403 | RLS 위반 | "권한이 없습니다" | 홈으로 리다이렉트 |
| NOT_FOUND | 404 | 리소스 없음 | "찾을 수 없어요" | 404 페이지 |
| INSUFFICIENT_CREDITS | 402 | 크레딧 부족 | "이번 달 크레딧 소진, 다음 리셋: YYYY-MM-01" | 크레딧 UI + 리셋일 표시 |
| ACTIVE_JOB_EXISTS | 409 | 이미 활성 Job | "이전 생성이 진행 중입니다" | 진행 Job 화면 이동 |
| UPSTREAM_UNAVAILABLE | 503 | AI API 장애 | "AI 서비스 일시 장애, 잠시 후 재시도" | 자동 FLUX fallback 시도 |
| RATE_LIMITED | 429 | 사용자 rate limit | "너무 잦은 요청" | Exponential backoff |
| INTERNAL_ERROR | 500 | 서버 오류 | "일시적 오류, 다시 시도해주세요" | Sentry 로깅 |

### 6.2 SSE 에러 처리 (특수)

SSE 스트림 중 오류 → HTTP 상태 코드 대신 이벤트 채널로 전달:

```
event: error
data: {"code":"UPSTREAM_UNAVAILABLE","order":3,"refundedCredits":1}
```

**Client**: `event: error` 수신 시 토스트 + Job 진행 계속 (전체 실패 아님)

### 6.3 Known Limitations / Architecture Limitations (Phase 2 시점)

Phase 3 이후에 다뤄야 하는 사항을 두 축으로 분리해 기록한다.

- **Known Limitation** — 현재 스코프에서 의도적으로 다루지 않는 항목. 다음
  phase 에서 정상적인 기능 확장으로 해소된다.
- **Architecture Limitation** — 현재 구조 자체의 제한. 해결하려면 아키텍처
  변경 (별도 마이그레이션 · 실행 모델 재설계) 이 필요하며, 단순 추가로는
  풀리지 않는다. 후속 phase 에서 Package 구조가 충분히 안정화된 이후 검토.

#### Architecture Limitation

- **Single job SSE 재접속 시 중복 생성 가능성**
  `handleSingle` 은 batch 을 chunk 단위로 순차 생성하며 chunk 별 원자적 claim
  이 없다. 클라이언트가 job 실행 중 새로고침 → 브라우저가 `/api/jobs/:id/stream`
  에 재접속하면 서버는 남은 chunk 를 다시 시작한다. 완료된 chunk 는 SSE 이벤트
  로 이미 발행됐지만 아직 실행 중이던 chunk 는 이론상 중복 실행될 수 있다.
  현실적으로는 (a) 활성 Job 은 사용자당 1개 unique partial index 로 제한되고,
  (b) 새로고침 사이 간격이 짧으면 중복 확률이 낮아 실제 관측된 사례는 없으나,
  구조적으로 완전히 방지되지는 않는다. Package job 은 slot 단위 원자 claim
  (`UPDATE ... WHERE status='pending' RETURNING`) 으로 이미 해결. 후속 phase
  에서 Package 구조가 안정화된 이후 single 도 동일한 slot claim 패턴으로
  통합 검토. 이번 Phase 2 범위에서는 Single Job Pipeline 을 변경하지 않는다.

---

## 7. Security Considerations

### 7.1 Checklist

- [x] **Input validation**: Zod 스키마 (모든 Route Handler)
- [x] **Auth**: Supabase Auth JWT, 모든 API에서 세션 검증
- [x] **RLS**: 8개 테이블 전체 RLS 적용, Private 이미지 타 계정 조회 차단
- [x] **Credit integrity**: PostgreSQL 트랜잭션으로 원자성 보장
- [x] **API Key protection**: OpenAI/Replicate 키는 Server only, `NEXT_PUBLIC_` 접두사 금지
- [x] **HTTPS**: Vercel 기본
- [x] **Rate Limiting**: 사용자당 활성 Job 1개 제한 (unique partial index)
- [x] **Presigned URL**: R2 다운로드 URL 만료 5분
- [x] **AI-generated label**: 모든 이미지 상세에서 강제 노출 (프로덕트 라벨 규정)
- [x] **Reference Image consent**: 업로드 시 동의 체크박스 강제

### 7.2 Credit Integrity Pattern (핵심)

크레딧 차감/환불은 반드시 PostgreSQL 함수로:

```sql
CREATE FUNCTION reserve_credits(p_user_id UUID, p_amount INT)
RETURNS INT AS $$
DECLARE v_remaining INT;
BEGIN
  UPDATE profiles SET credits = credits - p_amount
    WHERE id = p_user_id AND credits >= p_amount
    RETURNING credits INTO v_remaining;
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;
  RETURN v_remaining;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION refund_credits(p_user_id UUID, p_amount INT)
RETURNS INT AS $$
BEGIN
  UPDATE profiles SET credits = credits + p_amount WHERE id = p_user_id;
  RETURN (SELECT credits FROM profiles WHERE id = p_user_id);
END; $$ LANGUAGE plpgsql;
```

Route Handler에서 이 함수만 호출. 절대 `credits - X` 를 서버 코드에서 계산 후 UPDATE 하지 않음 (race condition).

---

## 8. Test Plan (v2.3.0)

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|-------|
| L0: Unit | credit/adapter 순수 함수 | Vitest | Do |
| L1: API | 19개 endpoint | Playwright request | Do |
| L2: UI Action | 페이지 상호작용 | Playwright | Do |
| L3: E2E | 4개 골든 패스 | Playwright | Do |

### 8.2 L1: API Test Scenarios

| # | Endpoint | Method | Test Description | Expected Status | Expected Response |
|---|----------|--------|-----------------|:--------------:|-------------------|
| 1 | `/api/profile` | GET | 로그인 사용자 프로필 반환 | 200 | `.data.id`, `.data.credits` 존재 |
| 2 | `/api/profile` | GET | 미로그인 차단 | 401 | `.error.code = UNAUTHORIZED` |
| 3 | `/api/school-profile` | POST | Optional 프로필 생성 | 201 | `.data.userId` 존재 |
| 4 | `/api/school-profile` | POST | 잘못된 school_level 거부 | 400 | `.error.details.fieldErrors.schoolLevel` 존재 |
| 5 | `/api/jobs` | POST | 5장 배치 요청 → 5 크레딧 차감 | 201 | `.data.reservedCredits = 5`, `.data.remainingCredits = 45` |
| 6 | `/api/jobs` | POST | batchSize=7 거부 (5의 배수 아님) | 400 | `.error.code = VALIDATION_ERROR` |
| 7 | `/api/jobs` | POST | 크레딧 3 남았을 때 5장 요청 거부 | 402 | `.error.code = INSUFFICIENT_CREDITS`, `.error.details.requiredCredits = 5` |
| 8 | `/api/jobs` | POST | 활성 Job 있는데 새 요청 | 409 | `.error.code = ACTIVE_JOB_EXISTS` |
| 9 | `/api/jobs/:id/stream` | GET | SSE 헤더 확인 | 200 | `content-type: text/event-stream` |
| 10 | `/api/images` | GET | 내 라이브러리 반환 | 200 | `.data` 배열, `.pagination.total` |
| 11 | `/api/images/:id` | GET | 타인 Private 이미지 접근 차단 | 404 | `.error.code = NOT_FOUND` (RLS로 존재 미노출) |
| 12 | `/api/images/:id` | GET | 타인 Public 이미지 접근 허용 | 200 | `.data.id` 존재 |
| 13 | `/api/images/:id` | PATCH | is_public=TRUE 토글 | 200 | `.data.isPublic = true` |
| 14 | `/api/images/:id/download` | POST | Presigned URL 반환 + 이벤트 로깅 | 200 | `.data.downloadUrl`, DB에 download_events 1건 추가 |
| 15 | `/api/search?q=이순신` | GET | FTS 검색 결과 | 200 | `.data` 배열, prompt에 "이순신" 포함 |
| 16 | `/api/community` | GET | 공개 이미지 + AuthorBadge 데이터 | 200 | `.data[0].authorType` 존재 |
| 17 | `/api/upload` | POST | Presigned URL 반환 | 200 | `.data.uploadUrl`, `.data.r2Key` |
| 18 | `/api/images/:id/upscale` | POST | 1 크레딧 차감 + 새 이미지 생성 | 201 | `.data.upscaledFromId` 원본 참조 |
| 19 | `/api/official-collection` | GET | 로그인 사용자 조회 가능 | 200 | `.data` 배열 |

### 8.3 L2: UI Action Test Scenarios

| # | Page | Action | Expected Result | Data Verification |
|---|------|--------|----------------|-------------------|
| 1 | `/` | 로그인 후 방문 | 공식 컬렉션 카드 20개 렌더 | DB `official_collection` count = 렌더된 카드 수 |
| 2 | `/generate` | 프롬프트 없이 [생성 시작] | Button disabled | Zod validation 로컬 확인 |
| 3 | `/generate` | 5장 요청 → SSE 연결 | 카드 1~5 순차 등장 | `image_ready` 이벤트 5회 발생 |
| 4 | `/generate` | Chunk 실패 시나리오 | 토스트 알림 + 크레딧 UI 갱신 | `chunk_failed` 이벤트 처리 |
| 5 | `/generate` (School Profile 없음) | 학교 스타일 토글 | 토글 UI 자체가 렌더되지 않음 | `<SchoolStyleToggle>` DOM 없음 |
| 6 | `/generate` (School Profile 있음) | 학교 스타일 토글 | 토글 렌더 + 기본 ON | `<SchoolStyleToggle>` DOM 존재, checked=true |
| 7 | `/library` | 이미지 클릭 → 상세 | AIGeneratedBadge 노출 | 우상단 배지 DOM 확인 |
| 8 | `/image/:id` | [공개] 토글 ON | Community에서 조회 가능 | 다른 계정 세션에서 `/api/community`에 등장 |
| 9 | `/image/:id` | [이 이미지로 생성] 클릭 | Chaining 페이지 이동 + 프롬프트 자동 채움 | textarea value = 원본 prompt |
| 10 | Chaining | 프리셋 칩 클릭 | 프롬프트에 자동 append | textarea에 "다른 포즈" 등 문구 추가 |
| 11 | `/library` | Pending 이미지 24h 경과 | 자동 삭제 확인 | DB에서 `status='discarded'` 또는 row 없음 |
| 12 | Onboarding | 계정 유형 선택 후 School Profile 스킵 | 홈 진입, 학교 토글 안 뜸 | school_profiles 없음, GenerationForm에서 토글 미노출 |

### 8.4 L3: E2E Scenario Test Scenarios (4 Golden Paths)

| # | Scenario | Steps | Success Criteria |
|---|----------|-------|-----------------|
| 1 | **골든 A: 검색→재사용** | 로그인 → 홈 → 검색 "이순신" → 결과 카드 → 다운로드 | Presigned URL 반환, download_events 1건 추가 |
| 2 | **골든 B: 배치 생성→저장** | 로그인 → 홈 → [+생성] → 프롬프트 입력 → [5장] → SSE 완료 → 저장 | credits 45, images.status='saved' 5건, batch_id 공통 |
| 3 | **골든 C: 이미지 체이닝** | 라이브러리 → 이미지 클릭 → [이 이미지로 생성] → 프리셋 [다른 포즈] → 5장 → 저장 | 새 이미지 parent_image_id=원본, download_events(event_type='chain_source') 1건 |
| 4 | **골든 D: 공개→Community 기여** | 라이브러리 → 이미지 상세 → [공개] ON → 다른 계정 로그인 → Community 검색 → 다운로드 | 원 계정 Community 기여율 카운트 증가 |
| 5 | 크레딧 부족 시나리오 | credits=3인 상태에서 5장 요청 | 402 INSUFFICIENT_CREDITS, 안내 UI |
| 6 | 다양성 강화 | 5장 → 다양성 강화 5장 추가 | 총 10 크레딧 차감, images 10건, 두 번째 5장은 프롬프트 변형됨 |

### 8.5 Seed Data Requirements

| Entity | Minimum Count | Key Fields Required |
|--------|:------------:|---------------------|
| profiles | 3 | 각기 다른 account_type, credits ≥ 50 |
| school_profiles | 1 | school_name, school_level, base_prompt |
| images (saved) | 20 | 다양한 prompt, is_public 반반 |
| official_collection | 30 | category 다양 (학교 카테고리 20 + 일반 10) |
| generation_jobs | 5 | 완료·부분실패·실패 상태 각각 |

**Do phase**: `supabase/seed.sql` 스크립트 작성
**Check phase**: `pnpm supabase db reset --local` 후 seed 자동 적용

---

## 9. Clean Architecture

### 9.1 Layer Structure (Pragmatic Adaptation)

| Layer | Responsibility | Location |
|-------|---------------|----------|
| **Presentation** | UI 컴포넌트, 페이지, 라우트 | `src/app/`, `src/components/`, `src/features/*/components/` |
| **Application** | 훅, TanStack Query, 비즈니스 오케스트레이션 | `src/features/*/hooks/`, `src/features/*/api/` |
| **Domain** | 순수 타입, 도메인 상수 | `src/types/`, `src/lib/domain/` |
| **Infrastructure** | 외부 서비스 어댑터, DB 클라이언트 | `src/services/`, `src/lib/supabase/` |

### 9.2 Dependency Rules

```
┌─────────────────────────────────────────────────────────────┐
│                    Dependency Direction                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Presentation ──→ Application ──→ Domain ←── Infrastructure│
│                          │                                  │
│                          └──→ Infrastructure                │
│                                                             │
│   Rule: features/* 내부에서 다른 feature 참조 금지          │
│         공유 로직은 services/ 또는 lib/ 로 상향 이동        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 File Import Rules (Pragmatic)

| From | Can Import | Cannot Import |
|------|-----------|---------------|
| `app/*/page.tsx` | features, components/ui, lib | services 직접 (server 로직은 route handler) |
| `app/api/*/route.ts` | services, lib | features (features는 클라이언트) |
| `features/{X}/` | services, lib, types, components/ui | `features/{Y}` (타 feature 직접 참조 금지) |
| `services/` | lib, types | features, app |
| `lib/`, `types/` | 자기 자신만 | 다른 모든 계층 |

### 9.4 This Feature's Layer Assignment

| Component | Layer | Location |
|-----------|-------|----------|
| `GenerationForm` | Presentation | `src/features/generation/components/GenerationForm.tsx` |
| `useCreateJob` (TanStack Mutation) | Application | `src/features/generation/hooks/useCreateJob.ts` |
| `useJobStream` (SSE consumer) | Application | `src/features/generation/hooks/useJobStream.ts` |
| `ImageGenAdapter` (interface) | Infrastructure | `src/services/image-gen/adapter.ts` |
| `OpenAIImageGen` (implementation) | Infrastructure | `src/services/image-gen/openai.ts` |
| `FluxImageGen` (implementation) | Infrastructure | `src/services/image-gen/flux.ts` |
| `Profile`, `Image`, `GenerationJob` types | Domain | `src/types/domain.ts` |
| `POST /api/jobs` handler | Application/Infrastructure 경계 | `src/app/api/jobs/route.ts` |

---

## 10. Coding Convention Reference

### 10.1 Naming Conventions

| Target | Rule | Example |
|--------|------|---------|
| Components | PascalCase | `GenerationForm`, `AuthorBadge` |
| Hooks | camelCase with `use` prefix | `useCreateJob`, `useJobStream` |
| Server Route Files | `route.ts` | `app/api/jobs/route.ts` |
| Adapter Interface | PascalCase, suffix `Adapter` | `ImageGenAdapter` |
| Adapter Impl | PascalCase, no suffix | `OpenAIImageGen` |
| Zod Schema | camelCase with `Schema` suffix | `createJobSchema` |
| DB Function | snake_case | `reserve_credits`, `refund_credits` |
| Files (component) | PascalCase.tsx | `GenerationForm.tsx` |
| Files (utility) | camelCase.ts | `parseSSE.ts` |
| Folders | kebab-case | `image-gen/`, `school-profile/` |

### 10.2 Import Order

```typescript
// 1. External
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

// 2. Internal absolute
import { Button } from '@/components/ui/button';
import { imageGenAdapter } from '@/services/image-gen';

// 3. Relative
import { useGenerationStore } from '../store';

// 4. Types
import type { GenerationJob } from '@/types/domain';
```

### 10.3 Environment Variables

| Prefix | Purpose | Scope |
|--------|---------|-------|
| `NEXT_PUBLIC_` | Client-side | Browser |
| `SUPABASE_` | Server DB access | Server only |
| `R2_` | Cloudflare R2 credentials | Server only |
| `OPENAI_API_KEY` | OpenAI | Server only |
| `REPLICATE_API_TOKEN` | Replicate | Server only |

### 10.4 This Feature's Conventions

| Item | Convention Applied |
|------|-------------------|
| Component naming | PascalCase, features/*/components/ 격리 |
| File organization | features/{domain}/{components,hooks,api,types}/ |
| State management | Zustand (UI 로컬) + TanStack Query (서버 상태) |
| Error handling | Server: `{ ok: false, error }` / Client: TanStack `onError` |
| Schema validation | Zod (Server + Client 공유 스키마 `src/types/schemas.ts`) |

---

## 11. Implementation Guide

### 11.1 File Structure (60 신규 파일 대략)

```
clipart-studio/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/page.tsx
│  │  ├─ (auth)/callback/route.ts
│  │  ├─ (main)/page.tsx                # 홈
│  │  ├─ (main)/library/page.tsx
│  │  ├─ (main)/generate/page.tsx
│  │  ├─ (main)/image/[id]/page.tsx
│  │  ├─ (main)/community/page.tsx
│  │  ├─ (main)/profile/page.tsx
│  │  ├─ (main)/onboarding/page.tsx
│  │  ├─ api/
│  │  │  ├─ profile/route.ts
│  │  │  ├─ school-profile/route.ts
│  │  │  ├─ jobs/route.ts
│  │  │  ├─ jobs/[id]/stream/route.ts
│  │  │  ├─ jobs/[id]/route.ts
│  │  │  ├─ images/route.ts
│  │  │  ├─ images/[id]/route.ts
│  │  │  ├─ images/[id]/download/route.ts
│  │  │  ├─ images/[id]/upscale/route.ts
│  │  │  ├─ search/route.ts
│  │  │  ├─ community/route.ts
│  │  │  ├─ official-collection/route.ts
│  │  │  └─ upload/route.ts
│  │  ├─ layout.tsx
│  │  └─ globals.css
│  ├─ features/
│  │  ├─ auth/                          # 로그인, OnboardingWizard
│  │  ├─ profile/                       # School Profile Form
│  │  ├─ generation/                    # GenerationForm, BatchProgressPanel, SchoolStyleToggle
│  │  ├─ library/                       # ImageGrid, ImageCard, SearchBar
│  │  ├─ chaining/                      # PresetChips, LineageTree
│  │  └─ community/                     # AuthorBadge, PublishToggle
│  ├─ services/
│  │  ├─ image-gen/
│  │  │  ├─ adapter.ts                  # 인터페이스
│  │  │  ├─ openai.ts                   # gpt-image-1 구현
│  │  │  ├─ flux.ts                     # Replicate FLUX 구현
│  │  │  └─ index.ts                    # export selectImageGen()
│  │  ├─ r2/
│  │  │  ├─ client.ts                   # S3 SDK 설정
│  │  │  ├─ upload.ts                   # 서버 업로드
│  │  │  └─ presign.ts                  # Presigned URL
│  │  ├─ tagging/
│  │  │  └─ index.ts                    # gpt-4o-mini 태깅
│  │  ├─ credit/
│  │  │  └─ index.ts                    # reserve/refund (RPC 호출)
│  │  └─ supabase/
│  │     ├─ server.ts                   # Server Route Handler용
│  │     └─ client.ts                   # Browser용
│  ├─ components/ui/                    # shadcn/ui
│  │  ├─ button.tsx, input.tsx, card.tsx, ...
│  │  └─ AIGeneratedBadge.tsx           # 재사용 컴포넌트
│  ├─ components/layout/
│  │  ├─ AppHeader.tsx
│  │  └─ AppSidebar.tsx
│  ├─ lib/
│  │  ├─ store/                         # Zustand
│  │  │  ├─ generationStore.ts
│  │  │  └─ authStore.ts
│  │  ├─ query/                         # TanStack Query 설정
│  │  │  └─ client.ts
│  │  └─ utils/
│  │     ├─ parseSSE.ts
│  │     └─ formatCredits.ts
│  └─ types/
│     ├─ domain.ts                      # 도메인 타입
│     └─ schemas.ts                     # Zod 스키마
├─ supabase/
│  ├─ migrations/
│  │  ├─ 001_profiles.sql
│  │  ├─ 002_school_profiles.sql
│  │  ├─ 003_images.sql
│  │  ├─ 004_generation_jobs.sql
│  │  ├─ 005_download_events.sql
│  │  ├─ 006_seed_library.sql
│  │  ├─ 007_official_collection.sql
│  │  ├─ 008_functions_credits.sql
│  │  ├─ 009_rls_policies.sql
│  │  └─ 010_community_view.sql
│  ├─ seed.sql
│  └─ config.toml
├─ tests/
│  ├─ unit/                             # Vitest
│  │  ├─ services/credit.test.ts
│  │  └─ services/image-gen/openai.test.ts
│  └─ e2e/                              # Playwright
│     ├─ golden-a-search.spec.ts
│     ├─ golden-b-batch.spec.ts
│     ├─ golden-c-chaining.spec.ts
│     └─ golden-d-community.spec.ts
├─ .env.local.example
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
├─ package.json
└─ CLAUDE.md
```

### 11.2 Implementation Order (내부 순서)

1. [ ] 프로젝트 스캐폴딩 (Next.js 14 + Tailwind + shadcn/ui + Vitest + Playwright)
2. [ ] Supabase 프로젝트 생성 + 마이그레이션 적용
3. [ ] 크레딧 함수 (RPC) 작성 + 단위 테스트
4. [ ] Auth + Profile 자동 생성 트리거
5. [ ] Onboarding + School Profile CRUD
6. [ ] image-gen 어댑터 인터페이스 + OpenAI 구현
7. [ ] Job Queue API + SSE 스트리밍
8. [ ] R2 업로드 파이프라인
9. [ ] 자동 태깅 서비스
10. [ ] 라이브러리 UI + FTS 검색
11. [ ] 공식 컬렉션 큐레이션 UI (관리자용 or SQL 직접)
12. [ ] 이미지 체이닝 + 프리셋 칩
13. [ ] Community 공개 토글 + 배지
14. [ ] 업스케일 + Polish
15. [ ] E2E 4 골든 패스 통과

### 11.3 Session Guide

> Auto-generated from Design structure. Session split is recommended, not required.
> Use `/pdca do clipart-studio --scope module-N` to implement one module per session.

#### Module Map

| Module | Scope Key | Description | Estimated Turns |
|--------|-----------|-------------|:---------------:|
| **Foundation** | `module-1` | Next.js 스캐폴딩 + Supabase 세팅 + Auth + Profile + School Profile + Onboarding | 45-55 |
| **Generation Core** | `module-2` | image-gen 어댑터 + Job Queue + SSE + Credit RPC + BatchProgressPanel | 50-60 |
| **Library & Search** | `module-3` | R2 파이프라인 + 자동 태깅 + FTS + 라이브러리 UI + 공식 컬렉션 | 40-50 |
| **Image Chaining** | `module-4` | i2i 어댑터 + Preset Chips + LineageTree + parent_image_id 처리 | 30-40 |
| **Community** | `module-5` | 공개 토글 + community_images View + AuthorBadge + RLS 확장 | 20-30 |
| **Polish** | `module-6` | 업스케일 어댑터 + Credit UX + Tutorial + AI 라벨 + 월 리셋 배치 | 25-30 |

#### Recommended Session Plan

| Session | Phase | Scope | Turns |
|---------|-------|-------|:-----:|
| Session 1 | Plan + Design + Do M1 | `--scope module-1` (Foundation) | 60-70 |
| Session 2 | Do M2 | `--scope module-2` (Generation Core) | 50-60 |
| Session 3 | Do M3 | `--scope module-3` (Library & Search) | 40-50 |
| Session 4 | Do M4 | `--scope module-4` (Chaining) | 30-40 |
| Session 5 | Do M5 + M6 | `--scope module-5,module-6` | 45-60 |
| Session 6 | Check + Iterate + QA + Report | 전체 | 40-50 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-09 | 초안 (Pragmatic 아키텍처 선택, Session Guide 6 모듈 분할) | sbtmxk20 |
| 0.2 | 2026-08-03 | §6.3 Known Limitations 추가 — Phase 2 package pipeline 착수에 맞춰 single job SSE 재접속 중복 생성 리스크를 후속 정리 대상으로 명시 | sbtmxk20 |
| 0.3 | 2026-08-05 | §6.3 을 Known Limitations / Architecture Limitations 로 재분류. Single Job SSE 재접속 중복 생성 가능성은 Architecture Limitation 로 표기. Slot 확장 (final_prompt, category_order) 및 package_plan.version=1 은 Migration 055 로 도입, 코드 반영 완료 | sbtmxk20 |
| 0.4 | 2026-08-05 | Phase 3 Package UX 반영. `GET /api/jobs/:id` 응답에 kind='package' 일 때 slots 배열 추가 (camelCase). Package 재진입 복구는 useConversationJobStream (SSE 실시간) + usePackageJobRehydrate (서버 재조회) 두 훅의 병합으로 처리. PackageGeneratingStep / PackageCompletedStep 은 실제 slot 상태 기준 progress + category 그룹핑 (categoryOrder 정렬) + 전체 ZIP 다운로드. Fake progress·예상 시간·새 SSE 이벤트 없음 | sbtmxk20 |

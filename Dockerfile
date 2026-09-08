# Railway 배포용 Dockerfile.
#
# 목적:
#   Nixpacks 기본 이미지에는 Chromium 이 요구하는 shared libs 가 없어
#   @sparticuz/chromium 실행 시 libnspr4.so 로딩 실패가 발생한다. 이 파일은
#   Debian slim 위에 필요한 apt 패키지를 명시적으로 설치해 학습-헬퍼 PDF
#   렌더러가 정상 동작하도록 한다.
#
# 참고:
#   - Railway 는 Dockerfile 이 존재하면 nixpacks.toml 보다 우선 이걸 사용한다.
#   - Node 20 은 puppeteer-core 최신 버전과 호환.
#   - pnpm 9.0.0 은 package.json 의 packageManager 필드와 일치.

# ============================================================
# Stage 1 — deps
# ============================================================
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# pnpm 설치 (packageManager 필드와 일치하는 버전).
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2 — build
# ============================================================
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js 프로덕션 빌드 (public/, .next/ 생성).
RUN pnpm build

# ============================================================
# Stage 3 — runtime (Chromium shared libs + Korean fonts 포함)
# ============================================================
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Chromium 실행에 필요한 15개 shared libs + Noto CJK 폰트.
# @sparticuz/chromium 이 tar.br 로 배포하는 Chromium 바이너리는 시스템의 이
# libs 를 참조하며, 없으면 "error while loading shared libraries: libnspr4.so"
# 로 실행 실패한다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libpango-1.0-0 \
      libcairo2 \
      libasound2 \
      libatspi2.0-0 \
      fonts-noto-cjk \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 빌드 산출물 + 노드 모듈 복사.
COPY --from=build /app/.next            ./.next
COPY --from=build /app/public           ./public
COPY --from=build /app/node_modules     ./node_modules
COPY --from=build /app/package.json     ./package.json
COPY --from=build /app/next.config.mjs  ./next.config.mjs

ENV NODE_ENV=production
# Railway 는 PORT 를 주입. Next.js 는 이걸 자동 인식.
EXPOSE 3000

CMD ["pnpm", "start"]

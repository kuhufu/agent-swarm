# ── Stage 1: Install root dependencies ──
FROM node:20-alpine AS base
RUN npm install -g pnpm@8
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ── Stage 2: Build core ──
FROM base AS core-builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile
COPY packages/core/ ./packages/core/
RUN pnpm --filter @agent-swarm/core build

# ── Stage 3: Build web ──
FROM base AS web-builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/core/ ./packages/core/
COPY packages/web/ ./packages/web/

COPY --from=core-builder /app/packages/core/dist ./packages/core/dist

RUN pnpm --filter @agent-swarm/web build

# ── Stage 4: Nginx production image ──
FROM nginx:alpine
COPY --from=web-builder /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

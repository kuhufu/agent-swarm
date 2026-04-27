# ── Stage 1: Install root dependencies ──
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++
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

# ── Stage 3: Build server ──
FROM base AS server-builder
WORKDIR /app

# Copy pnpm files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# Install dependencies (link core workspace dep)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/core/ ./packages/core/
COPY packages/server/ ./packages/server/

# Copy prebuilt core dist from core-builder
COPY --from=core-builder /app/packages/core/dist ./packages/core/dist

# Build server
RUN pnpm --filter @agent-swarm/server build

# ── Stage 4: Production image ──
FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/agent-swarm.db

# Copy production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=server-builder /app/packages/core/dist ./packages/core/dist
COPY --from=server-builder /app/packages/server/dist ./packages/server/dist
COPY packages/server/src/ ./packages/server/src/

VOLUME /app/data
EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]

# Multi-stage, non-root, Alpine-based image. Builds cleanly under Coolify's
# Dockerfile-based deployment (point Coolify at this repo, it detects and
# builds this file automatically — no extra Coolify-specific directives
# needed here beyond EXPOSE + HEALTHCHECK below).

# ---------- Stage 1: install dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` (not `npm install`) for reproducible builds: it installs exactly
# what's pinned in package-lock.json and fails fast if the lockfile and
# package.json have drifted, instead of silently re-resolving versions.
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: production runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# Security hardening: run as a dedicated non-root user, not the default alpine 'node' UID
# assumptions — explicit UID/GID keeps this predictable across base image updates.
RUN addgroup -g 10001 galaxyswarm && \
    adduser -D -u 10001 -G galaxyswarm galaxyswarm

ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# Drop root privileges before the app ever executes.
USER galaxyswarm

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server/index.js"]

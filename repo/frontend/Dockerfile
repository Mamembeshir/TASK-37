FROM node:20-alpine AS builder

RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY frontend/ ./frontend/
COPY shared/ ./shared/

RUN cd frontend && pnpm build:prod

# ── Serve with nginx ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/frontend/dist/frontend/browser /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

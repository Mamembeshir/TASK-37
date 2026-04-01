FROM node:20-alpine

# Install build tools needed for native modules (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

# Install pnpm (pinned to match local version)
RUN npm install -g pnpm@10

WORKDIR /app

# Copy lockfile + manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/

# Frozen install with BuildKit cache mount so partial downloads survive
# between retries; reduced concurrency avoids overwhelming Docker Desktop's
# network stack.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy full source
COPY backend/ ./backend/
COPY shared/ ./shared/

RUN mkdir -p /app/backend/uploads

EXPOSE 3000

ENTRYPOINT ["sh", "/app/backend/entrypoint.sh"]

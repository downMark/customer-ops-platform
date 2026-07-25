FROM node:22-bookworm-slim AS builder

ENV MASTRA_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests

RUN pnpm typecheck \
    && pnpm test \
    && pnpm build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    PORT=4111

WORKDIR /app

COPY --from=builder /app/.mastra/output ./

USER node

EXPOSE 4111

CMD ["node", "index.mjs"]

FROM node:22-bookworm-slim AS builder

ENV MASTRA_TELEMETRY_DISABLED=1

WORKDIR /app/model-api

RUN corepack enable

COPY apps/model-api/package.json apps/model-api/pnpm-lock.yaml ./
COPY apps/performance/sdk/typescript/package.json /app/performance/sdk/typescript/package.json
COPY apps/performance/sdk/typescript/src /app/performance/sdk/typescript/src
RUN pnpm install --frozen-lockfile

COPY apps/model-api/tsconfig.json apps/model-api/vitest.config.ts ./
COPY apps/model-api/src ./src
COPY apps/model-api/scripts ./scripts
COPY apps/model-api/tests ./tests

RUN pnpm typecheck \
    && pnpm test \
    && pnpm build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0 \
    PORT=4111

WORKDIR /app

COPY --from=builder /app/model-api/.mastra/output ./

USER node

EXPOSE 4111

CMD ["node", "index.mjs"]

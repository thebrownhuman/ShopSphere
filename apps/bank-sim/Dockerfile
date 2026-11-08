# Build context: repo root (see infra/docker-compose.yml).
FROM node:25-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY apps/bank-sim/package.json apps/bank-sim/
RUN pnpm install --frozen-lockfile --filter @shopsphere/bank-sim...
COPY packages/config packages/config
COPY apps/bank-sim apps/bank-sim
RUN pnpm --filter @shopsphere/bank-sim build
ENV NODE_ENV=production PORT=4100 TZ=UTC
EXPOSE 4100
CMD ["node", "apps/bank-sim/dist/main.js"]

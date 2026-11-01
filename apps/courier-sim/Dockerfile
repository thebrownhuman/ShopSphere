# Build context: repo root (see infra/docker-compose.yml).
FROM node:26-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY apps/courier-sim/package.json apps/courier-sim/
RUN pnpm install --frozen-lockfile --filter @shopsphere/courier-sim...
COPY packages/config packages/config
COPY apps/courier-sim apps/courier-sim
RUN pnpm --filter @shopsphere/courier-sim build
ENV NODE_ENV=production PORT=4500 TZ=UTC
EXPOSE 4500
CMD ["node", "apps/courier-sim/dist/main.js"]

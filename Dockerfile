FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/rendezvous/package.json packages/rendezvous/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/protocol packages/protocol
COPY packages/rendezvous packages/rendezvous
RUN pnpm --filter @agentcomms/protocol build && pnpm --filter @agentcomms/rendezvous build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8788
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/rendezvous/package.json packages/rendezvous/package.json
RUN pnpm install --frozen-lockfile --prod --filter @agentcomms/rendezvous...
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/packages/rendezvous/dist packages/rendezvous/dist
EXPOSE 8788
CMD ["node", "packages/rendezvous/dist/index.js"]

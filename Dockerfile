# syntax=docker/dockerfile:1
# Сервер «Крысы крысят». Зависимости чисто JS → ставим на платформе раннера, копируем под целевую.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace packages/sim --workspace apps/server --include-workspace-root
COPY packages/sim packages/sim
COPY apps/server apps/server
RUN npm run build -w packages/sim && npm run build -w apps/server && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 2567
CMD ["node", "apps/server/dist/index.js"]

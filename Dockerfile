# ---- build server ----
FROM node:22-alpine AS server-build
WORKDIR /repo
RUN corepack enable
# better-sqlite3 在 musl (alpine) 无官方预编译产物，install 回退 node-gyp
# 源码编译——需要 python3/make/g++（缺失时 pnpm install 直接失败）
RUN apk add --no-cache python3 make g++
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# shared 需要自己的 devDependencies（tsc）才能构建，故显式把 shared 也纳入安装范围
RUN pnpm install --frozen-lockfile --filter @home-stock/server... --filter @home-stock/shared
COPY apps/server apps/server
COPY packages/shared packages/shared
# shared 必须先构建：server 运行时 main/types 指向 packages/shared/dist
RUN pnpm --filter @home-stock/shared build \
  && pnpm --filter @home-stock/server build

# ---- build web ----
FROM node:22-alpine AS web-build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @home-stock/web...
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @home-stock/web build

# ---- deploy server runtime (self-contained: shared + prod deps) ----
FROM server-build AS server-deploy
WORKDIR /repo
# pnpm v10 默认要求 inject-workspace-packages；legacy 模式无需改 workspace 配置，
# 且会带上 packages/shared（含 dist）与 server 的 dist。
RUN pnpm --filter @home-stock/server deploy --prod --legacy ./out

# ---- runtime ----
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deploy /repo/out ./
COPY --from=web-build /repo/apps/web/dist ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/src/main.js"]

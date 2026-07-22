# Local dev-only image (devdeploy). Runs the real `vite` dev server (HMR
# included) for @streamarr-tv/web, the standalone Web app that also serves
# as the hosted VIDAA client (?platform=tv-vidaa). Not a production image --
# see infra/docker/backend.Dockerfile for the real multi-stage prod build.
#
# Builds packages/* (workspace deps web imports from their dist/) but skips
# web's own "dev"/"build" npm scripts, which shell out to
# scripts/sync-vidaa-store.mjs -- that script copies from
# ../../../../infra/vidaa-gateway/portal/, outside this build context, and
# is unrelated to serving the app's own pages. Invokes vite directly instead.
FROM node:23-slim
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/**" run build
WORKDIR /build/web
EXPOSE 8080
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "8080"]

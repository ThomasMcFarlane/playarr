# Local dev-only image (devdeploy). Runs the real `vite` dev server for
# @playarr-tv/admin, the Playarr Server admin panel. Not a production image,
# see infra/docker/backend.Dockerfile for the real multi-stage prod build
# (the admin app is served by playarr-server itself there, not by vite).
FROM node:23-slim
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/**" run build
WORKDIR /build/admin
EXPOSE 8080
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "8080"]

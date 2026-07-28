# Local development image for the Streamarr marketing site.
#
# Per the workstation's devdeploy convention this runs the project's *dev*
# command inside the cluster rather than a production server, so the site is
# reachable at streamarr-marketing.localhost with Astro's watcher intact.
# The real production deploy path (a static host) is separate and does not use
# this image.
FROM node:24-alpine

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    ASTRO_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app

# Dependencies first so edits to content do not invalidate the install layer.
# pnpm-workspace.yaml carries the esbuild build-script approval and must be
# present before install, or Vite's bundler binary never gets placed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 8080

# --host binds 0.0.0.0 so Emissary can reach the container.
CMD ["pnpm", "exec", "astro", "dev", "--host", "0.0.0.0", "--port", "8080"]

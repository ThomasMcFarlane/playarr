# Local dev-only image (devdeploy). Runs the already-installed host
# node_modules for @playarr-tv/web directly through vite -- no COPY, no
# install. /repo is bind-mounted from the host repo at runtime (see
# k8s/deployment.yaml), so edits made on the host are immediately live.
# Not a production image -- see infra/docker/backend.Dockerfile and
# clients/tv-web/Dockerfile (build-time COPY variant) for those paths.
FROM node:26-slim
EXPOSE 8080
CMD ["sh", "-c", "node node_modules/vite/bin/vite.js --host 0.0.0.0 --port ${PORT:-8080}"]

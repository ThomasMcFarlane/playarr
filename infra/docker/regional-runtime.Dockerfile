# syntax=docker/dockerfile:1.7
#
# ==============================================================================
# Regional runtime base image (`streamarr-runtime`) for playarr-region-a/playarr-region-b
#
# The regional Deployments in infra/kubernetes/helm/playarr-dev run a
# prebuilt release binary that is mounted read-only from the node at
# /opt/streamarr (hostPath, see templates/regional.yaml); the image therefore
# only has to provide the userland the binary needs at runtime. The binary is
# built on the Arch Linux nodes, so this image is Arch-based to keep the glibc
# and shared-library ABI identical. (backend.Dockerfile is Debian-based and
# embeds its own binary; it is not a drop-in replacement for the hostPath
# layout.)
#
# ffmpeg (which also provides ffprobe) is installed because the server shells
# out to both for transcoding, HLS, thumbnails, chapters and audio/subtitle
# track probing (backend/crates/playarr-api/src/media.rs). Without them those
# endpoints return 500 "could not start ffprobe: No such file or directory".
# The two `-version` calls below fail the build if either binary is absent.
#
# Build (no build context is needed, so the file is piped on stdin):
#
#   docker build -t streamarr-runtime:26853ca-ffmpeg1 - < infra/docker/regional-runtime.Dockerfile
#
# See "Regional runtime image" in infra/kubernetes/helm/playarr-dev/README.md
# for the import, rollout and rollback runbook.
# ==============================================================================
FROM archlinux:base

RUN pacman -Syu --noconfirm --needed ca-certificates ffmpeg \
    && pacman -Scc --noconfirm \
    && ffmpeg -hide_banner -version | head -n 1 \
    && ffprobe -hide_banner -version | head -n 1

ENV LANG=C.UTF-8

# Same entrypoint as the previous image: the release binary is supplied by the
# hostPath mount, not baked in.
CMD ["/opt/streamarr/streamarr"]

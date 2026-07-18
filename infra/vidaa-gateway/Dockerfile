FROM python:3.13-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY vidaa_gateway ./vidaa_gateway
COPY portal ./portal
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

RUN addgroup -S -g 10001 gateway && adduser -S -D -H -u 10001 -G gateway gateway
USER gateway

EXPOSE 5353/tcp 5353/udp 8080/tcp 8443/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).read()"]

ENTRYPOINT ["python", "-m", "vidaa_gateway.main"]

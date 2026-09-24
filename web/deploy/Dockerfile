FROM node:22.23.2-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27.1-bookworm AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /tarjama ./cmd/tarjama

FROM debian:bookworm-slim AS api
LABEL org.opencontainers.image.source="https://github.com/mhjd/tarjama-studio"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir /storage && chown 10001:10001 /storage
COPY --from=backend /tarjama /usr/local/bin/tarjama
COPY --from=frontend /src/frontend/dist /app/frontend
USER 10001:10001
ENV FRONTEND_DIR=/app/frontend STORAGE_DIR=/storage
ENTRYPOINT ["/usr/local/bin/tarjama"]
CMD ["api"]

FROM debian:bookworm-slim AS media
LABEL org.opencontainers.image.source="https://github.com/mhjd/tarjama-studio"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-core bubblewrap util-linux python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /usr/local/yt-dlp && /usr/local/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.8.19" && ln -s /usr/local/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=backend /tarjama /usr/local/bin/tarjama
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
USER 10002:10002
ENTRYPOINT ["/usr/local/bin/tarjama"]
CMD ["media"]

# Explicit qualification job, never the image used by the web service or media profiles.
FROM backend AS preview-check-build
RUN CGO_ENABLED=0 go test -c -tags preview_live -o /preview-check ./internal/studio

FROM api AS preview-check
COPY --from=preview-check-build /preview-check /usr/local/bin/preview-check
ENTRYPOINT ["/usr/local/bin/preview-check"]
CMD ["-test.v", "-test.run", "^TestPreviewLive$", "-test.timeout", "12m"]

# Explicit private UI qualification only; not part of api/media release images.
FROM backend AS ui-review-build
RUN CGO_ENABLED=0 go build -trimpath -o /ui-review ./cmd/ui-review
FROM api AS ui-review
COPY --from=ui-review-build /ui-review /usr/local/bin/ui-review
ENTRYPOINT ["/usr/local/bin/ui-review"]
CMD []

FROM frontend AS ui-recorder
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npx playwright install ffmpeg
COPY --chown=10004:10004 review/ /review/
RUN ln -s /src/frontend/node_modules /review/node_modules
USER 10004:10004
ENV HOME=/tmp
ENTRYPOINT ["node", "/review/record.mjs"]

# Standalone real-provider quality benchmark. No app database or web endpoint.
FROM backend AS text-benchmark-build
RUN CGO_ENABLED=0 go build -trimpath -o /text-benchmark ./cmd/text-benchmark
FROM api AS text-benchmark
COPY --from=text-benchmark-build /text-benchmark /usr/local/bin/text-benchmark
COPY --chown=10001:10001 review/translation-lite/*.json /benchmark-inputs/
ENTRYPOINT ["/usr/local/bin/text-benchmark"]
CMD []

# Model/Parallel qualification only. No database, media, or live user data.
FROM backend AS research-check-build
RUN CGO_ENABLED=0 go build -trimpath -o /research-check ./cmd/research-check
FROM debian:bookworm-slim AS research-check
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=research-check-build /research-check /usr/local/bin/research-check
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/research-check"]

# Read-only diagnosis of production or explicitly scoped qualification data.
FROM backend AS media-diagnostic-build
RUN CGO_ENABLED=0 go build -trimpath -o /media-diagnostic ./cmd/media-diagnostic
FROM api AS media-diagnostic
COPY --from=media-diagnostic-build /media-diagnostic /usr/local/bin/media-diagnostic
ENTRYPOINT ["/usr/local/bin/media-diagnostic"]

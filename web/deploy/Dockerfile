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
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir /storage && chown 10001:10001 /storage
COPY --from=backend /tarjama /usr/local/bin/tarjama
COPY --from=frontend /src/frontend/dist /app/frontend
USER 10001:10001
ENV FRONTEND_DIR=/app/frontend STORAGE_DIR=/storage
ENTRYPOINT ["/usr/local/bin/tarjama"]
CMD ["api"]

FROM debian:bookworm-slim AS media
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-core bubblewrap util-linux python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /usr/local/yt-dlp && /usr/local/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.8.19" && ln -s /usr/local/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=backend /tarjama /usr/local/bin/tarjama
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
USER 10002:10002
ENTRYPOINT ["/usr/local/bin/tarjama"]
CMD ["media"]

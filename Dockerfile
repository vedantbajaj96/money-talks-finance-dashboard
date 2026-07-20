# Stage 1: Build Vite frontend (Node only needed at build time)
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim
WORKDIR /app

RUN groupadd -g 1000 appuser && useradd -d /app -u 1000 -g appuser -s /sbin/nologin appuser

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser . .

# Overwrite with the freshly-built frontend
COPY --chown=appuser:appuser --from=frontend-builder /build/dist ./frontend/dist

RUN chown -R appuser:appuser /app
USER appuser

VOLUME /app/data
EXPOSE 8502
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8502').read()" || exit 1
CMD ["python3", "server.py"]

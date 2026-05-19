# ── Stage 1: compile JSX (Node only needed at build time) ──────────
FROM node:20-alpine3.20 AS jsx-builder
WORKDIR /build
COPY moneytalks/package*.json ./
RUN npm ci
COPY moneytalks/ ./
RUN node -e " \
const babel = require('@babel/core'), fs = require('fs'); \
['tweaks-panel.jsx','charts.jsx','tabs.jsx','app.jsx'].forEach(f => { \
  const code = babel.transformSync(fs.readFileSync(f,'utf8'), \
    {presets:['@babel/preset-react']}).code; \
  fs.writeFileSync(f.replace('.jsx','.js.compiled'), code); \
}); \
"

# ── Stage 2: Python runtime ────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Create non-root user for runtime security
RUN groupadd -g 1000 appuser && useradd -d /app -u 1000 -g appuser -s /sbin/nologin appuser

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    find /usr/local/lib/python3.14 -type f -name '*.pyc' -delete && \
    find /usr/local/lib/python3.14 -type d -name '__pycache__' -delete

# Copy application code
COPY --chown=appuser:appuser . .

# Copy pre-compiled JSX from builder (avoids needing Node at runtime)
COPY --chown=appuser:appuser --from=jsx-builder /build/*.js.compiled ./moneytalks/

# Pre-download the embeddings model so first startup is instant
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-base-en-v1.5')" || true && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# data/ is mounted as a volume — don't bake user data into the image
VOLUME /app/data

EXPOSE 8502
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8502').read()" || exit 1
CMD ["python3", "server.py"]

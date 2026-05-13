# ── Stage 1: compile JSX (Node only needed at build time) ──────────
FROM node:20-slim AS jsx-builder
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
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Copy pre-compiled JSX from builder (avoids needing Node at runtime)
COPY --from=jsx-builder /build/*.js.compiled ./moneytalks/

# Pre-download the embeddings model so first startup is instant
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" || true

# data/ is mounted as a volume — don't bake user data into the image
VOLUME /app/data

EXPOSE 8502
CMD ["python3", "server.py"]

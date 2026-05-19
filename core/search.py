"""
core/search.py — Semantic search via sentence-transformers.

The model is loaded eagerly at import time so the first search is instant.
Gracefully degrades to no-op when sentence-transformers isn't installed.

Merchant descriptions are fingerprinted (numbers/punctuation stripped) before
embedding so "UBER *TRIP 1234" becomes "uber trip" — a clean word the model
understands as rideshare — letting queries like "cab" or "taxi" match naturally.
"""
from __future__ import annotations

import re

from core.store import get_conn, data_file

# ---------------------------------------------------------------------------
# Model + caches
# ---------------------------------------------------------------------------

_sem_model = None
_sem_cat_cache: dict = {}   # {cache_key: (cat_list, embeddings_array)}
_sem_txn_cache: dict = {}   # {username: {"mtime": float, "merchants": list, "embs": ndarray}}

try:
    from sentence_transformers import SentenceTransformer
    print("Loading embeddings model (all-MiniLM-L6-v2)…", flush=True)
    _sem_model = SentenceTransformer("all-MiniLM-L6-v2")
    print("Embeddings model ready.", flush=True)
except Exception as _e:
    print(f"sentence-transformers unavailable — semantic search disabled: {_e}", flush=True)


def _get_sem_model():
    return _sem_model


# ---------------------------------------------------------------------------
# Description normalisation
# ---------------------------------------------------------------------------

def _fingerprint(desc: str) -> str:
    """Strip numbers, punctuation and payment suffixes from a raw description.

    "UBER *TRIP 9487"      → "uber trip"
    "EXXONMOBIL GAS #4312" → "exxonmobil gas"
    "WHOLEFDS MKT 00345"   → "wholefds mkt"

    Giving the embedding model clean brand/merchant words means it can apply
    its real-world knowledge (Uber = rideshare, Exxon = gas) without noise.
    """
    s = str(desc).lower()
    s = re.sub(r"\b\d[\d/\-]*\d\b", " ", s)   # remove numeric tokens
    s = re.sub(r"[^a-z ]+", " ", s)            # strip punctuation / special chars
    return " ".join(s.split()[:6])             # keep up to 6 meaningful words


# ---------------------------------------------------------------------------
# Category semantic ranking
# ---------------------------------------------------------------------------

def semantic_rank(query: str, cats: list) -> list:
    """Re-rank cats by a hybrid score: substring match boost + semantic similarity.

    Scoring tiers (so direct text matches always beat purely semantic ones):
      name starts with query  → 2.0 + semantic
      name contains query     → 1.0 + semantic
      no substring match      → semantic only

    Falls back to substring-only ordering when the model is unavailable.
    """
    q = query.strip().lower()
    if not q:
        return cats

    model = _get_sem_model()

    # Compute semantic scores if model is available
    if model is not None:
        import numpy as np
        cache_key = ",".join(c["id"] for c in cats)
        if cache_key not in _sem_cat_cache:
            texts = [c["name"] for c in cats]
            embs  = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            _sem_cat_cache[cache_key] = (cats, embs)
        _, cat_embs = _sem_cat_cache[cache_key]
        q_emb       = model.encode([q], normalize_embeddings=True, show_progress_bar=False)[0]
        sem_scores  = (cat_embs @ q_emb).tolist()
    else:
        sem_scores = [0.0] * len(cats)

    def _score(cat: dict, sem: float) -> float:
        name = cat["name"].lower()
        if name.startswith(q):
            return 2.0 + sem
        if q in name:
            return 1.0 + sem
        return sem

    ranked = sorted(zip(cats, sem_scores), key=lambda x: -_score(x[0], x[1]))
    return [c for c, _ in ranked]


# ---------------------------------------------------------------------------
# Transaction semantic search
# ---------------------------------------------------------------------------

def semantic_txn_search(username: str, q: str) -> dict:
    """Return merchant names semantically matching the query.

    Each unique merchant description is embedded together with its category's
    descriptive keywords (e.g. "UBER *TRIP transport commute ride cab taxi…")
    so that queries like "cab" or "taxi" naturally surface Uber and Lyft
    without any manual synonym tables.
    """
    import numpy as np

    if not q.strip():
        return {"merchants": [], "semantic": False}

    model = _get_sem_model()
    if model is None:
        return {"merchants": [], "semantic": False, "error": "model unavailable"}

    parquet_path = data_file(username)
    if not parquet_path.exists():
        return {"merchants": [], "semantic": False}

    mtime  = parquet_path.stat().st_mtime
    cached = _sem_txn_cache.get(username, {})
    if cached.get("mtime") != mtime:
        conn = get_conn(username)
        rows = conn.execute(
            "SELECT DISTINCT description FROM txns WHERE description IS NOT NULL ORDER BY description"
        ).fetchall()
        merchants = [r[0] for r in rows]
        if not merchants:
            return {"merchants": [], "semantic": False}
        # Fingerprint before embedding: strips noise so the model sees clean
        # brand words ("uber", "exxonmobil") rather than "UBER *TRIP 9487"
        fingerprinted = [_fingerprint(m) for m in merchants]
        embs = model.encode(fingerprinted, normalize_embeddings=True, show_progress_bar=False)
        _sem_txn_cache[username] = {"mtime": mtime, "merchants": merchants, "embs": embs}
        cached = _sem_txn_cache[username]

    merchants = cached["merchants"]
    embs      = cached["embs"]
    q_emb     = model.encode([q.strip()], normalize_embeddings=True, show_progress_bar=False)[0]
    scores    = embs @ q_emb

    # Substring boost: direct keyword hit in merchant name always surfaces
    q_words = q.strip().lower().split()
    boosted_scores = [
        float(s) + (0.2 if any(w in m.lower() for w in q_words) else 0.0)
        for m, s in zip(merchants, scores)
    ]

    threshold = 0.50
    hits = [(m, s) for m, s in zip(merchants, boosted_scores) if s > threshold]
    hits.sort(key=lambda x: -x[1])
    top = hits[:20]
    return {
        "merchants": [m for m, _ in top],
        "scores":    {m: s for m, s in top},
        "semantic":  True,
    }

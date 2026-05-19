"""
core/search.py — Semantic search via sentence-transformers.

The model is loaded eagerly at import time so the first search is instant.
Gracefully degrades to no-op when sentence-transformers isn't installed.
"""
from __future__ import annotations

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
# Query expansion synonyms
# ---------------------------------------------------------------------------

# Maps a search term to a richer phrase for embedding.
# Helps bridge the gap between user intent ("cab") and raw merchant names ("UBER *TRIP").
_QUERY_SYNONYMS: dict[str, str] = {
    "cab":          "cab taxi rideshare uber lyft ride hailing",
    "taxi":         "taxi cab rideshare uber lyft ride",
    "rideshare":    "rideshare uber lyft cab taxi ride",
    "ride":         "ride uber lyft cab taxi rideshare",
    "coffee":       "coffee cafe starbucks dunkin espresso latte",
    "cafe":         "cafe coffee starbucks espresso latte",
    "grocery":      "grocery supermarket whole foods trader joe safeway kroger",
    "groceries":    "groceries grocery supermarket whole foods trader joe safeway",
    "supermarket":  "supermarket grocery whole foods trader joe kroger",
    "streaming":    "streaming netflix hulu spotify disney plus apple tv subscription",
    "delivery":     "delivery doordash grubhub uber eats instacart food",
    "food delivery": "food delivery doordash grubhub uber eats",
    "gas":          "gas station shell chevron bp exxon fuel petrol",
    "fuel":         "fuel gas station shell chevron exxon petrol",
    "pharmacy":     "pharmacy cvs walgreens rite aid drug store",
    "drugstore":    "drugstore pharmacy cvs walgreens rite aid",
    "gym":          "gym fitness planet fitness equinox workout crossfit",
    "fitness":      "fitness gym workout planet fitness equinox",
    "flight":       "flight airline delta united american southwest jetblue",
    "airline":      "airline flight delta united american southwest jetblue",
    "hotel":        "hotel marriott hilton hyatt airbnb lodging accommodation",
    "parking":      "parking garage lot spplus impark",
    "phone":        "phone mobile verizon att tmobile sprint wireless",
    "internet":     "internet broadband comcast xfinity spectrum att fiber",
    "insurance":    "insurance health dental vision auto home geico progressive",
    "rent":         "rent housing apartment lease landlord",
    "dining":       "dining restaurant food bar cafe",
    "shopping":     "shopping amazon walmart target retail store",
}


def _expand_query(q: str) -> str:
    """Expand a short query using synonyms for better embedding coverage."""
    return _QUERY_SYNONYMS.get(q.lower().strip(), q)


# ---------------------------------------------------------------------------
# Transaction semantic search
# ---------------------------------------------------------------------------

def semantic_txn_search(username: str, q: str) -> dict:
    """Return merchant names semantically matching the query."""
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
            "SELECT DISTINCT description FROM txns ORDER BY description"
        ).fetchall()
        merchants = [r[0] for r in rows if r[0]]
        if not merchants:
            return {"merchants": [], "semantic": False}
        embs = model.encode(merchants, normalize_embeddings=True, show_progress_bar=False)
        _sem_txn_cache[username] = {"mtime": mtime, "merchants": merchants, "embs": embs}
        cached = _sem_txn_cache[username]

    merchants = cached["merchants"]
    embs      = cached["embs"]

    # Expand the query to cover synonyms before embedding
    expanded  = _expand_query(q.strip())
    q_emb     = model.encode([expanded], normalize_embeddings=True, show_progress_bar=False)[0]
    scores    = embs @ q_emb

    # Also apply a substring boost: if any word in the original query appears in
    # the merchant name, bump its score (catches "uber" when searching "uber")
    q_words = q.strip().lower().split()
    boosted_scores = []
    for m, s in zip(merchants, scores):
        m_lower = m.lower()
        boost = 0.15 if any(w in m_lower for w in q_words) else 0.0
        boosted_scores.append(float(s) + boost)

    threshold = 0.45
    hits = [(m, s) for m, s in zip(merchants, boosted_scores) if s > threshold]
    hits.sort(key=lambda x: -x[1])
    top = hits[:20]
    return {
        "merchants": [m for m, _ in top],
        "scores":    {m: s for m, s in top},
        "semantic":  True,
    }

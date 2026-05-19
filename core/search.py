"""
core/search.py — Semantic search via sentence-transformers.

The model is loaded eagerly at import time so the first search is instant.
Gracefully degrades to no-op when sentence-transformers isn't installed.

Merchant embeddings are enriched with category keywords at build time so that
queries like "cab" or "taxi" naturally match "UBER *TRIP" (categorized as
transport) without needing a manual synonym list.
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
# Category → descriptive keywords (used to enrich merchant embeddings)
# ---------------------------------------------------------------------------
# Each entry expands a category name/slug into natural-language words that
# a user might type when looking for transactions in that category.
# This is the only place category knowledge needs to live — no per-merchant
# synonym tables required.

_CAT_KEYWORDS: dict[str, str] = {
    # Transport
    "commute-and-transport": "transport commute ride cab taxi rideshare bus subway train metro ferry car",
    "Commute & Transport":   "transport commute ride cab taxi rideshare bus subway train metro ferry car",
    "transport":             "transport commute ride cab taxi rideshare bus subway train metro ferry car",
    # Dining
    "dining-and-drinks":     "dining restaurant food bar drinks coffee cafe lunch dinner brunch",
    "Dining & Drinks":       "dining restaurant food bar drinks coffee cafe lunch dinner brunch",
    "dining":                "dining restaurant food bar drinks coffee cafe lunch dinner brunch",
    # Food delivery
    "food-delivery":         "food delivery doordash grubhub ubereats instacart takeout order",
    "Food Delivery":         "food delivery doordash grubhub ubereats instacart takeout order",
    # Groceries
    "groceries":             "grocery groceries supermarket food market produce",
    "Groceries":             "grocery groceries supermarket food market produce",
    # Shopping
    "shopping-and-retail":   "shopping retail store purchase buy amazon online",
    "Shopping & Retail":     "shopping retail store purchase buy amazon online",
    "shopping":              "shopping retail store purchase buy amazon online",
    # Health / fitness
    "fitness-and-active":    "fitness gym workout exercise yoga crossfit pilates sports active",
    "Fitness & Active":      "fitness gym workout exercise yoga crossfit pilates sports active",
    "health-and-medical":    "health medical doctor pharmacy prescription hospital clinic",
    "Health & Medical":      "health medical doctor pharmacy prescription hospital clinic",
    "health":                "health fitness gym medical doctor pharmacy",
    # Subscriptions
    "connectivity":          "subscription streaming internet phone mobile wireless broadband",
    "Connectivity":          "subscription streaming internet phone mobile wireless broadband",
    "subs":                  "subscription streaming internet phone mobile wireless",
    # Travel
    "travel-and-getaways":   "travel flight airline hotel airbnb vacation trip getaway lodging",
    "Travel & Getaways":     "travel flight airline hotel airbnb vacation trip getaway lodging",
    "travel":                "travel flight airline hotel airbnb vacation trip getaway",
    # Housing / utilities
    "housing-and-utilities": "rent housing apartment utilities electric gas water landlord",
    "Housing & Utilities":   "rent housing apartment utilities electric gas water landlord",
    "rent":                  "rent housing apartment utilities electric gas water landlord",
    # Education
    "education":             "education school tuition course class learning books",
    "Education":             "education school tuition course class learning books",
    # Self development
    "professional-development": "professional development course training certification conference",
    "self-development":      "self development personal growth course coaching",
    "self_dev":              "self development professional course coaching",
    # Personal care
    "personal-care":         "personal care haircut grooming salon spa beauty",
    "Personal Care":         "personal care haircut grooming salon spa beauty",
    "grooming-and-beauty":   "grooming beauty haircut salon spa barber",
    # Entertainment
    "entertainment":         "entertainment movies concert event tickets fun",
    "Entertainment":         "entertainment movies concert event tickets fun",
    # Transfers / financial
    "financial-and-transfers": "transfer payment bank wire zelle venmo",
    "Financial & Transfers": "transfer payment bank wire zelle venmo",
    "transfer":              "transfer payment bank wire zelle venmo",
    # Income
    "paycheck-and-salary":   "salary paycheck income employer direct deposit",
    "Paycheck & Salary":     "salary paycheck income employer direct deposit",
    "income":                "income salary paycheck wages",
}


def _enrich(description: str, category: str) -> str:
    """Append category keywords to a merchant description before embedding."""
    keywords = _CAT_KEYWORDS.get(category, "")
    if keywords:
        return f"{description} {keywords}"
    return description


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
        # Fetch each unique description together with its most common category
        rows = conn.execute("""
            SELECT description, category
            FROM (
                SELECT description, category,
                       ROW_NUMBER() OVER (PARTITION BY description ORDER BY COUNT(*) DESC) AS rn
                FROM txns
                WHERE description IS NOT NULL
                GROUP BY description, category
            )
            WHERE rn = 1
            ORDER BY description
        """).fetchall()
        merchants = [r[0] for r in rows if r[0]]
        if not merchants:
            return {"merchants": [], "semantic": False}
        # Enrich each description with category keywords before embedding
        enriched = [_enrich(r[0], r[1] or "") for r in rows if r[0]]
        embs = model.encode(enriched, normalize_embeddings=True, show_progress_bar=False)
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

    threshold = 0.40
    hits = [(m, s) for m, s in zip(merchants, boosted_scores) if s > threshold]
    hits.sort(key=lambda x: -x[1])
    top = hits[:20]
    return {
        "merchants": [m for m, _ in top],
        "scores":    {m: s for m, s in top},
        "semantic":  True,
    }

"""
core/search.py — Semantic search via sentence-transformers.

Model: BAAI/bge-base-en-v1.5 at threshold 0.55 (F1=0.91 on internal eval).
Loaded eagerly at import time so the first search is instant.
Gracefully degrades to no-op when sentence-transformers isn't installed.

Design:
- Descriptions are fingerprinted (noise stripped) before embedding.
- The index is keyed on (description, category_id) pairs, not just description.
  "COSTCO WHOLESALE" tagged Groceries and "COSTCO WHOLESALE" tagged Transport
  are two separate entries with different embeddings — so "gas" finds the
  Transport-Costco and "groceries" finds the Groceries-Costco.
- Each entry is embedded as "{fingerprinted_desc} {category_keywords}" so
  opaque names like "OTF" match "health" via their Fitness & Active category.
"""
from __future__ import annotations

import re

from core.store import get_conn, data_file

# ---------------------------------------------------------------------------
# Model + caches
# ---------------------------------------------------------------------------

_sem_model = None
_sem_cat_cache: dict = {}   # {cache_key: (cat_list, embeddings_array)}
_sem_txn_cache: dict = {}   # {username: {"mtime": float, "pairs": list, "embs": ndarray}}

try:
    from fastembed import TextEmbedding
    import numpy as _np_init
    print("Loading embeddings model (bge-base-en-v1.5)…", flush=True)
    _sem_model = TextEmbedding("BAAI/bge-base-en-v1.5")
    # Warm up — first call downloads the model if not cached
    list(_sem_model.embed(["warmup"]))
    print("Embeddings model ready.", flush=True)
except Exception as _e:
    print(f"fastembed unavailable — semantic search disabled: {_e}", flush=True)


def _get_sem_model():
    return _sem_model


# ---------------------------------------------------------------------------
# Description normalisation
# ---------------------------------------------------------------------------

def _fingerprint(desc: str) -> str:
    """Strip numbers, punctuation and payment suffixes.

    "UBER *TRIP 9487"      → "uber trip"
    "EXXONMOBIL GAS #4312" → "exxonmobil gas"
    "OTF 00345 NYC"        → "otf nyc"
    """
    s = str(desc).lower()
    s = re.sub(r"\b\d[\d/\-]*\d\b", " ", s)
    s = re.sub(r"[^a-z ]+", " ", s)
    return " ".join(s.split()[:6])


# ---------------------------------------------------------------------------
# Category → descriptive keywords for embedding enrichment
# Keys match exact category names stored in the parquet (full names + slugs).
# ---------------------------------------------------------------------------

_CAT_KEYWORDS: dict[str, str] = {
    # Transport — generic enough not to pull all transport merchants for "cab",
    # but includes fuel/gas so Exxon/Chevron surface for "gas" queries.
    # Brand names (uber, lyft, exxon) provide the fine-grained signal.
    "Commute & Transport":       "transportation commute vehicle fuel gas petroleum station travel",
    "commute-and-transport":     "transportation commute vehicle fuel gas petroleum station travel",
    "transport":                 "transportation commute vehicle fuel gas petroleum station travel",
    # Groceries
    "Groceries":                 "groceries grocery supermarket food market produce shopping",
    "groceries":                 "groceries grocery supermarket food market produce shopping",
    # Dining
    "Dining & Drinks":           "dining restaurant food bar drinks coffee cafe lunch dinner brunch takeout",
    "dining-and-drinks":         "dining restaurant food bar drinks coffee cafe lunch dinner brunch takeout",
    "dining":                    "dining restaurant food bar drinks coffee cafe",
    # Food delivery
    "Food Delivery":             "food delivery takeout order doordash grubhub ubereats instacart",
    "food-delivery":             "food delivery takeout order doordash grubhub ubereats instacart",
    # Fitness
    "Fitness & Active":          "fitness gym workout exercise yoga crossfit pilates sports active health training studio",
    "fitness-and-active":        "fitness gym workout exercise yoga crossfit pilates sports active health training studio",
    "health":                    "health fitness gym workout medical",
    # Health / medical
    "Health & Medical":          "health medical doctor pharmacy prescription hospital clinic dental vision",
    "health-and-medical":        "health medical doctor pharmacy prescription hospital clinic dental vision",
    # Shopping
    "Shopping & Retail":         "shopping retail store purchase buy online amazon",
    "shopping-and-retail":       "shopping retail store purchase buy online amazon",
    "shopping":                  "shopping retail store purchase buy",
    # Subscriptions / connectivity
    "Connectivity":              "subscription streaming internet phone mobile wireless broadband",
    "connectivity":              "subscription streaming internet phone mobile wireless broadband",
    "subs":                      "subscription streaming internet phone mobile wireless",
    # Travel
    "Travel & Getaways":         "travel flight airline hotel airbnb vacation trip getaway lodging booking",
    "travel-and-getaways":       "travel flight airline hotel airbnb vacation trip getaway lodging booking",
    "travel":                    "travel flight airline hotel airbnb vacation trip",
    # Housing / utilities
    "Housing & Utilities":       "rent housing apartment utilities electricity water heat landlord",
    "housing-and-utilities":     "rent housing apartment utilities electricity water heat landlord",
    "rent":                      "rent housing apartment utilities electricity water",
    # Entertainment
    "Entertainment":             "entertainment streaming movies music games software events concert cinema",
    "entertainment":             "entertainment streaming movies music games software events concert cinema",
    # Education
    "Education":                 "education school tuition course class learning books university",
    "education":                 "education school tuition course class learning books university",
    # Professional development
    "Professional Development":  "professional development course training certification conference career",
    "professional-development":  "professional development course training certification conference career",
    "self_dev":                  "self development professional course coaching learning",
    # Personal care
    "Personal Care":             "personal care haircut grooming salon spa beauty barber",
    "personal-care":             "personal care haircut grooming salon spa beauty barber",
    "Grooming & Beauty":         "grooming beauty haircut salon spa barber skincare",
    "grooming-and-beauty":       "grooming beauty haircut salon spa barber skincare",
    # Transfers
    "Financial & Transfers":     "transfer payment bank wire zelle venmo autopay",
    "financial-and-transfers":   "transfer payment bank wire zelle venmo autopay",
    "transfer":                  "transfer payment bank wire zelle venmo",
    # Income
    "Paycheck & Salary":         "salary paycheck income wages employer direct deposit",
    "paycheck-and-salary":       "salary paycheck income wages employer direct deposit",
    "income":                    "income salary paycheck wages",
    # Refund
    "Refund / Return":           "refund return credit cashback",
    "refund":                    "refund return credit cashback",
    # Other
    "Other":                     "other miscellaneous",
    "other":                     "other miscellaneous",
}


def _enrich(fp: str, category: str) -> str:
    """Combine fingerprinted description with category keywords for embedding."""
    kw = _CAT_KEYWORDS.get(category, "")
    return f"{fp} {kw}".strip() if kw else fp


# ---------------------------------------------------------------------------
# Category semantic ranking (unchanged)
# ---------------------------------------------------------------------------

def semantic_rank(query: str, cats: list) -> list:
    """Re-rank cats by a hybrid score: substring match boost + semantic similarity."""
    q = query.strip().lower()
    if not q:
        return cats

    model = _get_sem_model()

    if model is not None:
        import numpy as np
        cache_key = ",".join(c["id"] for c in cats)
        if cache_key not in _sem_cat_cache:
            texts = [c["name"] for c in cats]
            embs  = np.array(list(model.embed(texts)))
            _sem_cat_cache[cache_key] = (cats, embs)
        _, cat_embs = _sem_cat_cache[cache_key]
        q_emb       = np.array(list(model.embed([q])))[0]
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
    """Return (merchant, category_id) pairs semantically matching the query.

    The index is built on unique (description, category) pairs so the same
    merchant with different categories (e.g. Costco as Groceries vs Transport)
    gets separate embeddings and can match different queries independently.

    Returns:
        {
          "matches":  [{"merchant": str, "category": str}, ...],
          "scores":   {"merchant||category": float, ...},
          "semantic": True
        }
    """
    from core.categories import map_category
    import numpy as np

    if not q.strip():
        return {"matches": [], "merchants": [], "semantic": False}

    model = _get_sem_model()
    if model is None:
        return {"matches": [], "merchants": [], "semantic": False, "error": "model unavailable"}

    parquet_path = data_file(username)
    if not parquet_path.exists():
        return {"matches": [], "merchants": [], "semantic": False}

    mtime      = parquet_path.stat().st_mtime
    model_name = type(model).__name__
    cached     = _sem_txn_cache.get(username, {})
    if cached.get("mtime") != mtime or cached.get("model") != model_name:
        conn = get_conn(username)
        rows = conn.execute("""
            SELECT description, category, COUNT(*) AS cnt
            FROM txns
            WHERE description IS NOT NULL
            GROUP BY description, category
            ORDER BY description, cnt DESC
        """).fetchall()

        if not rows:
            return {"matches": [], "merchants": [], "semantic": False}

        pairs    = []   # list of (description, category_id)
        fp_texts = []   # fingerprinted description only
        for desc, raw_cat, _ in rows:
            cat_id = map_category(str(raw_cat or "other"))
            fp     = _fingerprint(desc)
            pairs.append((desc, cat_id))
            fp_texts.append(fp)

        desc_embs = np.array(list(model.embed(fp_texts)))
        _sem_txn_cache[username] = {
            "mtime": mtime, "model": model_name, "pairs": pairs, "desc_embs": desc_embs,
        }
        cached = _sem_txn_cache[username]

    pairs     = cached["pairs"]
    desc_embs = cached["desc_embs"]
    q_emb     = np.array(list(model.embed([q.strip()])))[0]

    import numpy as _np
    desc_scores = desc_embs @ q_emb

    # Literal match boost — ensures exact name matches always rank above semantic-only results.
    # +0.50: full query string contained in description ("whole foods" in "WHOLE FOODS #123")
    # +0.25: any single query word appears in description
    # These values exceed the max realistic semantic score (~0.85) when combined with it,
    # guaranteeing literal hits sort to the top.
    q_lower = q.strip().lower()
    q_words = q_lower.split()
    boost = _np.array([
        0.50 if q_lower in desc.lower() else
        (0.25 if any(w in desc.lower() for w in q_words) else 0.0)
        for (desc, _) in pairs
    ])
    combined = desc_scores + boost

    # Lower threshold slightly so substring-boosted results always pass even if semantically distant
    threshold = 0.45
    hits = [
        (desc, cat_id, float(s))
        for (desc, cat_id), s in zip(pairs, combined)
        if s >= threshold
    ]
    hits.sort(key=lambda x: -x[2])
    top = hits[:30]

    matches      = [{"merchant": d, "category": c} for d, c, _ in top]
    score_dict   = {f"{d}||{c}": s for d, c, s in top}
    # Keep legacy "merchants" list for any callers that haven't updated yet
    merchants    = list(dict.fromkeys(d for d, _, _ in top))

    return {
        "matches":   matches,
        "merchants": merchants,
        "scores":    score_dict,
        "semantic":  True,
    }

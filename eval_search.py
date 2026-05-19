"""
eval_search.py — Compare embedding models for transaction semantic search.

Usage:
    .venv/bin/python eval_search.py

Runs every model against a labeled set of (query → expected merchants) test
cases using the same fingerprint preprocessing as core/search.py, then prints
a score table and per-query breakdown.

No API keys needed — purely local sentence-transformers inference.
"""
from __future__ import annotations

import re
import sys
import time

# ---------------------------------------------------------------------------
# Synthetic merchant list  (realistic raw bank-statement descriptions)
# ---------------------------------------------------------------------------

MERCHANTS = [
    # Transport / rideshare
    "UBER *TRIP",
    "UBER* PENDING",
    "LYFT *RIDE 1234",
    "LYFT *1234567",
    "NYC TAXI 5678",
    "YELLOW CAB 9012",
    # Gas
    "EXXONMOBIL 4312",
    "SHELL GAS STATION",
    "BP #0034521",
    "CHEVRON GAS 00123",
    # Dining
    "DOMINOS PIZZA 3412",
    "CHIPOTLE MEXICAN GRILL",
    "SHAKE SHACK 0042",
    "DUNKIN #334455",
    "STARBUCKS STORE 12345",
    "SWEETGREEN 0023",
    # Groceries
    "WHOLE FOODS MKT 00345",
    "TRADER JOES 1234",
    "COSTCO WHOLESALE 0099",
    "SAFEWAY 0456",
    "KROGER 1122",
    # Food delivery
    "DOORDASH*CHIPOTLE",
    "GRUBHUB*ORDER",
    "UBEREATS*MCDONALDS",
    "INSTACART 1234",
    # Streaming / subscriptions
    "NETFLIX.COM",
    "SPOTIFY USA",
    "HULU 9988",
    "APPLE.COM/BILL",
    "DISNEY PLUS",
    # Fitness
    "EQUINOX 0023",
    "PLANET FITNESS",
    "CROSSFIT NYC",
    "PELOTON*MEMBERSHIP",
    # Health / pharmacy
    "CVS PHARMACY 1234",
    "WALGREENS #5678",
    "DUANE READE 9900",
    # Shopping
    "AMAZON.COM*1A2B3C",
    "TARGET 0099",
    "WALMART SUPERCENTER",
    "BEST BUY 1234",
    # Travel
    "DELTA AIR LINES",
    "UNITED AIRLINES",
    "MARRIOTT HOTELS",
    "AIRBNB * 1234XY",
    # Utilities / bills
    "CON EDISON",
    "SPECTRUM INTERNET",
    "VERIZON WIRELESS",
    # Transfers / payments
    "ZELLE PAYMENT TO JOHN",
    "VENMO PAYMENT",
    "CHASE CREDIT CRD AUTOPAY",
]

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

TEST_CASES = [
    {
        "query":      "cab",
        "expect":     ["UBER *TRIP", "UBER* PENDING", "LYFT *RIDE 1234", "LYFT *1234567",
                       "NYC TAXI 5678", "YELLOW CAB 9012"],
        "not_expect": ["EXXONMOBIL 4312", "COSTCO WHOLESALE 0099", "AMAZON.COM*1A2B3C",
                       "NETFLIX.COM", "DOORDASH*CHIPOTLE"],
    },
    {
        "query":      "taxi",
        "expect":     ["NYC TAXI 5678", "YELLOW CAB 9012", "UBER *TRIP", "LYFT *RIDE 1234"],
        "not_expect": ["EXXONMOBIL 4312", "NETFLIX.COM", "AMAZON.COM*1A2B3C"],
    },
    {
        "query":      "gas",
        "expect":     ["EXXONMOBIL 4312", "SHELL GAS STATION", "BP #0034521", "CHEVRON GAS 00123"],
        "not_expect": ["UBER *TRIP", "NETFLIX.COM", "COSTCO WHOLESALE 0099"],
    },
    {
        "query":      "pizza",
        "expect":     ["DOMINOS PIZZA 3412"],
        "not_expect": ["UBER *TRIP", "NETFLIX.COM", "EXXONMOBIL 4312"],
    },
    {
        "query":      "coffee",
        "expect":     ["STARBUCKS STORE 12345", "DUNKIN #334455"],
        "not_expect": ["EXXONMOBIL 4312", "AMAZON.COM*1A2B3C", "NETFLIX.COM"],
    },
    {
        "query":      "gym",
        "expect":     ["EQUINOX 0023", "PLANET FITNESS", "CROSSFIT NYC", "PELOTON*MEMBERSHIP"],
        "not_expect": ["NETFLIX.COM", "EXXONMOBIL 4312", "AMAZON.COM*1A2B3C"],
    },
    {
        "query":      "streaming",
        "expect":     ["NETFLIX.COM", "SPOTIFY USA", "HULU 9988", "DISNEY PLUS"],
        "not_expect": ["EXXONMOBIL 4312", "UBER *TRIP", "EQUINOX 0023"],
    },
    {
        "query":      "pharmacy",
        "expect":     ["CVS PHARMACY 1234", "WALGREENS #5678", "DUANE READE 9900"],
        "not_expect": ["UBER *TRIP", "NETFLIX.COM", "AMAZON.COM*1A2B3C"],
    },
    {
        "query":      "food delivery",
        "expect":     ["DOORDASH*CHIPOTLE", "GRUBHUB*ORDER", "UBEREATS*MCDONALDS", "INSTACART 1234"],
        "not_expect": ["EXXONMOBIL 4312", "NETFLIX.COM", "EQUINOX 0023"],
    },
    {
        "query":      "flight",
        "expect":     ["DELTA AIR LINES", "UNITED AIRLINES"],
        "not_expect": ["UBER *TRIP", "NETFLIX.COM", "EXXONMOBIL 4312"],
    },
    {
        "query":      "transfer",
        "expect":     ["ZELLE PAYMENT TO JOHN", "VENMO PAYMENT", "CHASE CREDIT CRD AUTOPAY"],
        "not_expect": ["UBER *TRIP", "NETFLIX.COM", "EXXONMOBIL 4312"],
    },
]

MODELS = [
    "all-mpnet-base-v2",       # current production model
    "BAAI/bge-base-en-v1.5",   # BGE base — better calibrated than bge-small
    "BAAI/bge-large-en-v1.5",  # BGE large — tops MTEB retrieval
    "intfloat/e5-base-v2",     # retrieval-specific; uses query/passage prefixes
]

# Models that require "query: " / "passage: " prefixes for correct use
_E5_PREFIX_MODELS = {"intfloat/e5-base-v2", "intfloat/e5-small-v2", "intfloat/e5-large-v2"}

THRESHOLDS = [0.40, 0.45, 0.50, 0.55]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fingerprint(desc: str) -> str:
    s = str(desc).lower()
    s = re.sub(r"\b\d[\d/\-]*\d\b", " ", s)
    s = re.sub(r"[^a-z ]+", " ", s)
    return " ".join(s.split()[:6])


def score_threshold(scores: dict[str, float], test: dict, threshold: float) -> dict:
    retrieved = {m for m, s in scores.items() if s >= threshold}
    expected  = set(test["expect"])
    not_exp   = set(test["not_expect"])

    tp  = len(retrieved & expected)
    fn  = len(expected - retrieved)
    fp  = len(retrieved & not_exp)

    recall    = tp / len(expected) if expected else 1.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    return {"tp": tp, "fn": fn, "fp": fp, "recall": recall, "precision": precision, "f1": f1}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run():
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
    except ImportError:
        print("sentence-transformers not installed. Run: pip install sentence-transformers")
        sys.exit(1)

    fingerprinted = [fingerprint(m) for m in MERCHANTS]
    print(f"\n{'='*70}")
    print(f"  Transaction Search Embedding Model Eval")
    print(f"  {len(MERCHANTS)} merchants  |  {len(TEST_CASES)} queries  |  {len(THRESHOLDS)} thresholds")
    print(f"{'='*70}\n")

    results = {}  # model → threshold → {recall, precision, f1}

    for model_name in MODELS:
        print(f"Loading {model_name}...", end=" ", flush=True)
        t0 = time.monotonic()
        try:
            model = SentenceTransformer(model_name)
        except Exception as e:
            print(f"FAILED: {e}")
            continue
        load_ms = (time.monotonic() - t0) * 1000

        use_prefix = model_name in _E5_PREFIX_MODELS
        passages   = [f"passage: {t}" for t in fingerprinted] if use_prefix else fingerprinted

        t0 = time.monotonic()
        merchant_embs = model.encode(passages, normalize_embeddings=True, show_progress_bar=False)
        encode_ms = (time.monotonic() - t0) * 1000
        print(f"loaded in {load_ms:.0f}ms, encoded {len(MERCHANTS)} merchants in {encode_ms:.0f}ms")

        results[model_name] = {}

        # Per-query score breakdown
        print(f"\n  {'Query':<20} {'Merchant':<35} {'Score':>7}")
        print(f"  {'-'*20} {'-'*35} {'-'*7}")

        all_scores_by_query = []
        for test in TEST_CASES:
            q_text = f"query: {test['query']}" if use_prefix else test["query"]
            q_emb  = model.encode([q_text], normalize_embeddings=True, show_progress_bar=False)[0]
            sims   = (merchant_embs @ q_emb).tolist()
            scores = {m: s for m, s in zip(MERCHANTS, sims)}
            all_scores_by_query.append(scores)

            # Print top hits + key expected/not-expected scores
            interesting = sorted(
                [(m, s) for m, s in scores.items()
                 if m in test["expect"] or m in test["not_expect"] or s >= 0.45],
                key=lambda x: -x[1]
            )[:8]
            for i, (m, s) in enumerate(interesting):
                tag = ""
                if m in test["expect"]:     tag = "✓"
                elif m in test["not_expect"]: tag = "✗"
                label = test["query"] if i == 0 else ""
                bar = "█" * int(s * 20)
                print(f"  {label:<20} {m:<35} {s:6.3f} {tag} {bar}")
            print()

        # Aggregate scores per threshold
        for thresh in THRESHOLDS:
            agg = {"tp": 0, "fn": 0, "fp": 0}
            for test, scores in zip(TEST_CASES, all_scores_by_query):
                r = score_threshold(scores, test, thresh)
                agg["tp"] += r["tp"]
                agg["fn"] += r["fn"]
                agg["fp"] += r["fp"]
            total_expected = sum(len(t["expect"]) for t in TEST_CASES)
            recall    = agg["tp"] / total_expected if total_expected else 0
            precision = agg["tp"] / (agg["tp"] + agg["fp"]) if (agg["tp"] + agg["fp"]) > 0 else 1.0
            f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
            results[model_name][thresh] = {"recall": recall, "precision": precision, "f1": f1,
                                           "tp": agg["tp"], "fp": agg["fp"], "fn": agg["fn"]}

    # ---------------------------------------------------------------------------
    # Summary table
    # ---------------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("  SUMMARY — Recall / Precision / F1  (TP=correct hits, FP=false positives)")
    print(f"{'='*70}")
    header = f"  {'Model':<30}"
    for t in THRESHOLDS:
        header += f"  thresh={t}"
    print(header)
    print(f"  {'-'*30}" + "  " + ("  " + "-"*11) * len(THRESHOLDS))

    for model_name, thresh_results in results.items():
        row = f"  {model_name:<30}"
        best_f1 = max(v["f1"] for v in thresh_results.values())
        for t in THRESHOLDS:
            v = thresh_results[t]
            marker = " *" if abs(v["f1"] - best_f1) < 0.001 else "  "
            row += f"  R{v['recall']:.2f} P{v['precision']:.2f} F{v['f1']:.2f}{marker}"
        print(row)

    print(f"\n  * = best threshold for that model")
    print(f"\n  Columns: R=recall  P=precision  F=F1-score")
    print(f"  Recall: fraction of expected merchants found above threshold")
    print(f"  Precision: of results returned, fraction that were correct")
    print(f"  F1: harmonic mean — the number to optimise\n")


if __name__ == "__main__":
    run()

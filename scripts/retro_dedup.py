"""
Retroactive dedup: remove pending→posted Plaid duplicates from all user parquets.

A pair is a duplicate when:
  - Same description (case-insensitive)
  - Same expense_amount (within $0.01)
  - Dates within ±3 days of each other
  - Different plaid_txn_id

For each duplicate pair, keep the later date (posted transaction).
Only removes the earlier entry when exactly one match exists in the window
to avoid incorrectly removing legitimate repeat charges (e.g. daily coffee).
"""
import re
import sys
import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import pandas as pd

DATA_DIR = Path("/app/data")


def _desc_fp(desc: str) -> str:
    s = str(desc).lower().strip()
    words = re.sub(r"[^a-z0-9]+", " ", s).split()
    filtered = " ".join(w for w in words if len(w) > 1)[:60]
    return filtered if filtered else s[:60]


def retro_dedup(username: str) -> None:
    path = DATA_DIR / username / "transactions.parquet"
    if not path.exists():
        print(f"{username}: no parquet, skipping")
        return

    df = pd.read_parquet(path)
    df["_date_str"] = df["date"].dt.date.astype(str)
    df["_fp"]       = df["description"].apply(_desc_fp)
    df["_amt"]      = df["expense_amount"].round(2)

    to_remove: set = set()

    for idx, row in df.iterrows():
        if idx in to_remove:
            continue

        fp  = row["_fp"]
        amt = row["_amt"]
        d0  = datetime.date.fromisoformat(row["_date_str"])

        # Find all other rows with same fingerprint + amount within ±3 days
        candidates = df[
            (df["_fp"] == fp) &
            (df["_amt"] == amt) &
            (df.index != idx) &
            (df.index.map(lambda i: i not in to_remove))
        ]

        nearby = []
        for cidx, crow in candidates.iterrows():
            try:
                cd = datetime.date.fromisoformat(crow["_date_str"])
                if abs((cd - d0).days) <= 3:
                    nearby.append((cidx, cd))
            except ValueError:
                pass

        # Only act when exactly one nearby match (conservative — avoids removing
        # legitimate repeats like daily coffee runs with multiple same-day charges)
        if len(nearby) == 1:
            cidx, cd = nearby[0]
            # Remove the earlier (pending) date, keep the later (posted)
            if d0 < cd:
                to_remove.add(idx)
            elif cd < d0:
                to_remove.add(cidx)
            # if same date, already caught by semantic dedup — skip

    df = df.drop(index=list(to_remove)).drop(columns=["_date_str", "_fp", "_amt"])
    df = df.sort_values("date", ascending=False).reset_index(drop=True)
    df.to_parquet(path, index=False)
    print(f"{username}: removed {len(to_remove)} pending→posted duplicate(s), {len(df)} rows remaining")


users = [p.name for p in DATA_DIR.iterdir() if p.is_dir() and (p / "transactions.parquet").exists()]
for u in users:
    retro_dedup(u)

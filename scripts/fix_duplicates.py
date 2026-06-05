"""One-time script to remove semantic duplicates from all user parquets."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

DATA_DIR = Path("/app/data")

def fix_user(username: str) -> None:
    path = DATA_DIR / username / "transactions.parquet"
    if not path.exists():
        print(f"{username}: no parquet found, skipping")
        return

    df = pd.read_parquet(path)
    before = len(df)

    df["_key"] = (
        df["date"].dt.date.astype(str) + "|" +
        df["description"].str.lower().str.strip() + "|" +
        df["expense_amount"].round(2).astype(str)
    )
    # Prefer rows that are approved or user_edited when deduping
    sort_cols = ["_key"]
    sort_asc  = [True]
    for col in ("approved", "user_edited"):
        if col in df.columns:
            sort_cols.append(col)
            sort_asc.append(False)

    df = df.sort_values(sort_cols, ascending=sort_asc)
    df = df.drop_duplicates(subset=["_key"], keep="first").drop(columns=["_key"])
    df = df.sort_values("date", ascending=False).reset_index(drop=True)

    removed = before - len(df)
    df.to_parquet(path, index=False)
    print(f"{username}: removed {removed} duplicate(s), {len(df)} rows remaining")

users = [p.name for p in DATA_DIR.iterdir() if p.is_dir() and (p / "transactions.parquet").exists()]
for u in users:
    fix_user(u)

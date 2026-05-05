"""
user_rules.py — User-defined categorization rules.

Rules are stored in data/user_rules.json and applied before keyword matching
and LLM categorization. First matching rule wins.

Each rule:
  {
    "pattern":    "whole foods",          # text to match (case-insensitive)
    "match_type": "contains",             # "contains" | "starts_with" | "exact"
    "category":   "Groceries & Supermarkets"
  }
"""

from __future__ import annotations

import json
import os
import re

import pandas as pd

_RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "user_rules.json")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def load_rules() -> list[dict]:
    """Return saved rules, or [] if none exist."""
    if os.path.exists(_RULES_PATH):
        try:
            with open(_RULES_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_rules(rules: list[dict]) -> None:
    os.makedirs(os.path.dirname(_RULES_PATH), exist_ok=True)
    with open(_RULES_PATH, "w") as f:
        json.dump(rules, f, indent=2)


def add_rule(pattern: str, match_type: str, category: str) -> None:
    rules = load_rules()
    rules.append({"pattern": pattern.strip(), "match_type": match_type, "category": category})
    save_rules(rules)


def delete_rule(index: int) -> None:
    rules = load_rules()
    if 0 <= index < len(rules):
        rules.pop(index)
        save_rules(rules)


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def _matches(description: str, pattern: str, match_type: str) -> bool:
    desc = description.lower()
    pat  = pattern.lower()
    if match_type == "contains":
        return pat in desc
    if match_type == "starts_with":
        return desc.startswith(pat)
    if match_type == "exact":
        return desc == pat
    # fallback: treat as contains
    return pat in desc


def apply_rules(description: str) -> str | None:
    """
    Return the category from the first matching rule, or None if no rule matches.
    """
    for rule in load_rules():
        if _matches(description, rule["pattern"], rule["match_type"]):
            return rule["category"]
    return None


def apply_rules_to_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Apply user rules to every row. Rows that match a rule get their category
    set and suggested_category cleared; others are left untouched.
    """
    df = df.copy()
    rules = load_rules()
    if not rules:
        return df

    def _categorize_row(row):
        for rule in rules:
            if _matches(str(row["description"]), rule["pattern"], rule["match_type"]):
                return rule["category"]
        return row.get("category")

    df["category"] = df.apply(_categorize_row, axis=1)
    return df

"""
categorizer/ — Transaction categorization package.

Public API used by the rest of the app:
  ALL_CATEGORIES        — ordered list of expense category names
  INCOME_CATEGORIES     — list of income category names
  categorize_transactions(df) — adds 'category' and 'suggested_category' columns
  llm_categorize_all(...)     — LLM-powered categorization (Claude or Gemini)
"""

from .constants import ALL_CATEGORIES, INCOME_CATEGORIES
from .rules import categorize_transactions
from .llm import llm_categorize_all

__all__ = [
    "ALL_CATEGORIES",
    "INCOME_CATEGORIES",
    "categorize_transactions",
    "llm_categorize_all",
]

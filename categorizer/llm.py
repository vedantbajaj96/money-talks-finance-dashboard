"""
categorizer/llm.py — LLM-powered transaction categorization.

Sends batches of transaction descriptions to Claude or Gemini and gets back
one category per description. Both income and expense transactions are handled
in a single call by labeling each row [INCOME] or [EXPENSE] in the prompt.

Public entry point: llm_categorize_all()
"""

from __future__ import annotations

import json
import os

from .constants import ALL_CATEGORIES, INCOME_CATEGORIES

_BATCH_SIZE = 50  # descriptions per API call


def _extract_json_array(text: str) -> list | None:
    """
    Robustly extract the first JSON array from a string.
    Falls back through several strategies before giving up.
    """
    import json as _j
    # Strategy 1: the whole text is already valid JSON
    try:
        result = _j.loads(text)
        if isinstance(result, list):
            return result
    except Exception:
        pass
    # Strategy 2: find the first '[' and last ']' that enclose valid JSON
    start = text.find("[")
    if start != -1:
        for end in range(len(text) - 1, start, -1):
            if text[end] == "]":
                try:
                    result = _j.loads(text[start: end + 1])
                    if isinstance(result, list):
                        return result
                except Exception:
                    continue
    return None


def _build_prompt(descriptions: list[str], transaction_types: list[str], extra_expense_cats: list[str] | None = None) -> str:
    """Assemble the categorization prompt used by both Claude and Gemini."""
    expense_cats = "\n".join(f"- {c}" for c in ALL_CATEGORIES + (extra_expense_cats or []))
    income_cats  = "\n".join(f"- {c}" for c in INCOME_CATEGORIES)
    numbered     = "\n".join(
        f"{i + 1}. [{t.upper()}] {desc}"
        for i, (desc, t) in enumerate(zip(descriptions, transaction_types))
    )
    return f"""You are a personal finance transaction categorizer for a US urban professional.

Each transaction is labeled [EXPENSE] or [INCOME]. Use the matching category list.

For [EXPENSE] transactions use one of:
{expense_cats}

For [INCOME] transactions use one of:
{income_cats}

Transaction descriptions to categorize:
{numbered}

Rules:
- Match the category type to the label ([EXPENSE] → expense category, [INCOME] → income category).
- Every entry must be an exact category name from the lists above.
- The array must have exactly {len(descriptions)} elements.
- Return ONLY a valid JSON array — no explanation, no extra text."""


def _validate_results(
    raw: list,
    transaction_types: list[str],
    expected_count: int,
    extra_expense_cats: list[str] | None = None,
) -> tuple[list[str] | None, str | None]:
    """
    Validate LLM output: ensure every category is a known value and the
    count matches. Falls back to a safe default per transaction type.
    """
    if len(raw) != expected_count:
        return None, (
            f"LLM returned {len(raw)} categories for {expected_count} descriptions."
        )

    all_valid = set(ALL_CATEGORIES) | set(INCOME_CATEGORIES) | set(extra_expense_cats or [])
    validated = [
        cat if cat in all_valid
        else ("Other Income" if t == "income" else "Shopping & Retail")
        for cat, t in zip(raw, transaction_types)
    ]
    return validated, None


# ---------------------------------------------------------------------------
# Provider-specific batch functions
# ---------------------------------------------------------------------------


def _categorize_batch_claude(
    descriptions: list[str],
    api_key: str | None,
    transaction_types: list[str],
    extra_expense_cats: list[str] | None = None,
) -> tuple[list[str] | None, str | None]:
    """Send one batch to Claude and return validated categories."""
    try:
        import anthropic
    except ImportError:
        return None, "anthropic package not installed. Run: pip install anthropic"

    resolved_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not resolved_key:
        return None, "No Anthropic API key found. Enter one in Settings."

    try:
        client   = anthropic.Anthropic(api_key=resolved_key)
        prompt   = _build_prompt(descriptions, transaction_types, extra_expense_cats)
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = response.content[0].text.strip()

        parsed = _extract_json_array(raw_text)
        if parsed is None:
            return None, f"Could not extract JSON array from response: {raw_text[:100]}"
        return _validate_results(parsed, transaction_types, len(descriptions), extra_expense_cats)

    except Exception as exc:
        return None, str(exc)


def _categorize_batch_gemini(
    descriptions: list[str],
    api_key: str,
    transaction_types: list[str],
    extra_expense_cats: list[str] | None = None,
) -> tuple[list[str] | None, str | None]:
    """Send one batch to Gemini and return validated categories."""
    try:
        from google import genai
    except ImportError:
        return None, "google-genai not installed. Run: pip install google-genai"

    try:
        client   = genai.Client(api_key=api_key)
        prompt   = _build_prompt(descriptions, transaction_types, extra_expense_cats)
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt,
        )
        raw_text = response.text.strip()

        parsed = _extract_json_array(raw_text)
        if parsed is None:
            return None, f"Could not extract JSON array from response: {raw_text[:100]}"
        return _validate_results(parsed, transaction_types, len(descriptions), extra_expense_cats)

    except Exception as exc:
        return None, str(exc)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def llm_categorize_all(
    descriptions: list[str],
    api_key: str | None = None,
    provider: str = "claude",
    transaction_types: list[str] | None = None,
    extra_expense_cats: list[str] | None = None,
) -> tuple[list[str] | None, str | None]:
    """
    Categorize all descriptions via the LLM, processing in batches of
    up to _BATCH_SIZE descriptions per API call.

    Parameters
    ----------
    descriptions : list of str
    api_key : str, optional
        Provider API key. Claude falls back to ANTHROPIC_API_KEY env var.
    provider : "claude" | "gemini" (default: "claude")
    transaction_types : list of "expense" | "income", optional
        Must be the same length as descriptions. Defaults to all "expense".

    Returns
    -------
    (categories, None) on success — one category string per description.
    (None, error_message) on failure.
    """
    if transaction_types is None:
        transaction_types = ["expense"] * len(descriptions)

    all_results: list[str] = []

    for i in range(0, len(descriptions), _BATCH_SIZE):
        batch_descs = descriptions[i : i + _BATCH_SIZE]
        batch_types = transaction_types[i : i + _BATCH_SIZE]

        if provider == "gemini":
            results, error = _categorize_batch_gemini(batch_descs, api_key=api_key, transaction_types=batch_types, extra_expense_cats=extra_expense_cats)
        else:
            results, error = _categorize_batch_claude(batch_descs, api_key=api_key, transaction_types=batch_types, extra_expense_cats=extra_expense_cats)

        if error:
            return None, error
        all_results.extend(results)

    return all_results, None

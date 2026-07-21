"""
core/categories.py — Category constants and pure classification helpers.

map_category() and _resolve_category() are pure functions with no side effects.
They can be imported and tested without any I/O.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Category mapping: raw parquet value → frontend short ID
# ---------------------------------------------------------------------------

CAT_MAP: dict[str, str] = {
    # ── Categorizer names (current) ────────────────────────────────────────
    "Paycheck & Salary":            "income",
    "Freelance & Side Income":      "income",
    "Investment & Dividend Income": "income",
    "Other Income":                 "income",
    "Financial & Transfers":        "transfer",
    "Refund / Return":              "refund",
    "Housing & Utilities":          "rent",
    "Connectivity":                 "subs",
    "Food Delivery":                "dining",
    "Commute & Transport":          "transport",
    "Dining & Drinks":              "dining",
    "Fitness & Active":             "health",
    "Health & Medical":             "health",
    "Professional Development":     "self_dev",
    "Education":                    "education",
    "Self Development":             "self_dev",
    "Shopping & Retail":            "shopping",
    "Travel & Getaways":            "travel",
    "Reimbursements":               "other",
    "Personal Care":                "personal_care",
    "Grooming & Beauty":            "personal_care",
    # ── Slugified versions (already in parquet) ────────────────────────────
    "paycheck-and-salary":            "income",
    "freelance-and-side-income":      "income",
    "investment-and-dividend-income": "income",
    "other-income":                   "income",
    "financial-and-transfers":        "transfer",
    "housing-and-utilities":          "rent",
    "connectivity":                   "subs",
    "food-delivery":                  "dining",
    "commute-and-transport":          "transport",
    "dining-and-drinks":              "dining",
    "fitness-and-active":             "health",
    "health-and-medical":             "health",
    "professional-development":       "self_dev",
    "education":                      "education",
    "self-development":               "self_dev",
    "shopping-and-retail":            "shopping",
    "travel-and-getaways":            "travel",
    "reimbursements":                 "other",
    "personal-care":                  "personal_care",
    "grooming-and-beauty":            "personal_care",
    # ── Legacy Streamlit names ─────────────────────────────────────────────
    "Groceries":      "groceries",
    "Shopping":       "shopping",
    "Transportation": "transport",
    "Entertainment":  "entertainment",
    "Health":         "health",
    "Travel":         "travel",
    "Utilities":      "utilities",
    "Housing":        "rent",
    "Subscriptions":  "subs",
    "Income":         "income",
    "Reimbursement":  "other",
    "Transfers":      "transfer",
    "Savings":        "savings",
    "Other":          "other",
}

# Reverse map: frontend ID → a parquet-compatible name for storage.
# CAT_MAP is many-to-one so only the last mapping survives per value.
CAT_REVERSE_MAP: dict[str, str] = {v: k for k, v in CAT_MAP.items()}

CAT_META: dict[str, dict] = {
    "income":        {"name": "Income",           "group": "income",   "color": "#5ec98a", "icon": "↗"},
    "rent":          {"name": "Rent & Housing",   "group": "fixed",    "color": "#6b8aab", "icon": "◧"},
    "groceries":     {"name": "Groceries",        "group": "variable", "color": "#a3e635", "icon": "◉"},
    "dining":        {"name": "Dining & Bars",    "group": "variable", "color": "#d97757", "icon": "◔"},
    "transport":     {"name": "Transport",        "group": "variable", "color": "#67e8f9", "icon": "◇"},
    "utilities":     {"name": "Utilities",        "group": "fixed",    "color": "#fbbf24", "icon": "◐"},
    "subs":          {"name": "Subscriptions",    "group": "fixed",    "color": "#a78bfa", "icon": "◑"},
    "shopping":      {"name": "Shopping",         "group": "variable", "color": "#ec4899", "icon": "◕"},
    "health":        {"name": "Health & Fitness", "group": "variable", "color": "#22d3ee", "icon": "◙"},
    "travel":        {"name": "Travel",           "group": "variable", "color": "#f97316", "icon": "◭"},
    "entertainment": {"name": "Entertainment",    "group": "variable", "color": "#e879f9", "icon": "◬"},
    "transfer":      {"name": "Transfers",        "group": "transfer", "color": "#64748b", "icon": "⇄"},
    "refund":        {"name": "Refund / Return",  "group": "transfer", "color": "#94a3b8", "icon": "↩"},
    "savings":       {"name": "Savings",          "group": "transfer", "color": "#34d399", "icon": "⊕"},
    "education":     {"name": "Education",        "group": "variable", "color": "#818cf8", "icon": "◈"},
    "self_dev":      {"name": "Self Development", "group": "variable", "color": "#fb7185", "icon": "◍"},
    "personal_care": {"name": "Personal Care",    "group": "variable", "color": "#f0abfc", "icon": "◎"},
    "other":         {"name": "Other",            "group": "variable", "color": "#94a3b8", "icon": "○"},
}

ACCOUNT_COLORS = ["#5ec98a", "#67e8f9", "#d97757", "#a78bfa", "#fbbf24", "#6b8aab", "#f97316", "#e879f9"]

# Description substrings that always map to "transfer" regardless of categoriser output.
_TRANSFER_DESC_PATTERNS = [
    "automatic payment",
    "payment - thank",
    "payment thank you",
    "payment-thank",
    "online transfer from",
    "online transfer to",
    "payment to chase",
    "payment to discover",
    "payment to amex",
    "payment to citi",
    "payment to bank of america",
    "payment to wells fargo",
    "e-payment",
    "acctverify",
    "penny test",
    "account transfer",
    "ach transfer",
]

_REIMBURSEMENT_CATS = {"reimbursements", "Reimbursements"}


# ---------------------------------------------------------------------------
# Plaid personal_finance_category.detailed → our internal category ID
# Only covers unambiguous mappings; anything not listed falls through to LLM.
# ---------------------------------------------------------------------------

PLAID_CATEGORY_MAP: dict[str, str] = {
    # Food & drink
    "FOOD_AND_DRINK_GROCERIES":                 "groceries",
    "FOOD_AND_DRINK_RESTAURANTS":               "dining",
    "FOOD_AND_DRINK_FAST_FOOD":                 "dining",
    "FOOD_AND_DRINK_COFFEE":                    "dining",
    "FOOD_AND_DRINK_ALCOHOL_AND_BAR":           "dining",
    "FOOD_AND_DRINK_FOOD_DELIVERY_SERVICES":    "dining",
    # Transportation
    "TRANSPORTATION_GAS":                       "transport",
    "TRANSPORTATION_TAXI":                      "transport",
    "TRANSPORTATION_PUBLIC_TRANSIT":            "transport",
    "TRANSPORTATION_CAR_SERVICES":              "transport",
    "TRANSPORTATION_PARKING":                   "transport",
    "TRANSPORTATION_AUTO_INSURANCE":            "transport",
    "TRANSPORTATION_AUTO_MAINTENANCE":          "transport",
    # Travel
    "TRAVEL_FLIGHTS":                           "travel",
    "TRAVEL_HOTELS":                            "travel",
    "TRAVEL_RENTAL_CARS":                       "travel",
    "TRAVEL_VACATION_RENTALS":                  "travel",
    "TRAVEL_CRUISES":                           "travel",
    # Medical
    "MEDICAL_DOCTOR_VISIT":                     "health",
    "MEDICAL_PHARMACY":                         "health",
    "MEDICAL_DENTAL":                           "health",
    "MEDICAL_VISION":                           "health",
    "MEDICAL_VETERINARY":                       "health",
    # Personal care & fitness
    "PERSONAL_CARE_HAIRCUT_AND_BARBERSHOP":     "personal_care",
    "PERSONAL_CARE_SPA_AND_MASSAGE":            "personal_care",
    "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS":   "health",
    "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING":   "personal_care",
    # Entertainment
    "ENTERTAINMENT_MUSIC_AND_AUDIO":            "entertainment",
    "ENTERTAINMENT_MOVIES_AND_DVDS":            "entertainment",
    "ENTERTAINMENT_TV_AND_MOVIES":              "entertainment",
    "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS": "entertainment",
    "ENTERTAINMENT_VIDEO_GAMES":                "entertainment",
    "ENTERTAINMENT_CASINOS_AND_GAMBLING":       "entertainment",
    # Shopping
    "GENERAL_MERCHANDISE_DISCOUNT_STORES":      "shopping",
    "GENERAL_MERCHANDISE_DEPARTMENT_STORES":    "shopping",
    "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES":  "shopping",
    "CLOTHING_AND_ACCESSORIES":                 "shopping",
    "HOME_IMPROVEMENT_HARDWARE":                "shopping",
    "HOME_IMPROVEMENT_FURNITURE":               "shopping",
    "ELECTRONICS":                              "shopping",
    "SPORTING_GOODS":                           "shopping",
    "BOOKS_AND_MAGAZINES":                      "shopping",
    "PET_FOOD_SUPPLIES":                        "shopping",
    # Housing & utilities
    "RENT_AND_UTILITIES_RENT":                  "rent",
    "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY":   "utilities",
    "RENT_AND_UTILITIES_WATER":                 "utilities",
    "RENT_AND_UTILITIES_SEWAGE_AND_WASTE":      "utilities",
    "RENT_AND_UTILITIES_TELEPHONE":             "utilities",
    "RENT_AND_UTILITIES_INTERNET_AND_CABLE":    "subs",
    # Subscriptions
    "SUBSCRIPTION_STREAMING_SERVICES":          "subs",
    "SUBSCRIPTION_MEMBERSHIP_DUES":             "subs",
    "SUBSCRIPTION_SOFTWARE_AS_A_SERVICE":       "subs",
    "SUBSCRIPTION_NEWSPAPERS_AND_MAGAZINES":    "subs",
    # Education
    "EDUCATION_TUITION":                        "education",
    "EDUCATION_BOOKS_AND_SUPPLIES":             "education",
    "EDUCATION_STUDENT_LOAN":                   "education",
    # Income
    "INCOME_PAYROLL":                           "income",
    "INCOME_DIVIDENDS":                         "income",
    "INCOME_INTEREST_EARNED":                   "income",
    "INCOME_RETIREMENT_PENSION":                "income",
    "INCOME_TAX_REFUND":                        "income",
    "INCOME_UNEMPLOYMENT":                      "income",
    "INCOME_WAGES":                             "income",
    "INCOME_OTHER_INCOME":                      "income",
    # Transfers
    "TRANSFER_IN_ACCOUNT_TRANSFER":             "transfer",
    "TRANSFER_OUT_ACCOUNT_TRANSFER":            "transfer",
    "TRANSFER_IN_SAVINGS":                      "savings",
    "TRANSFER_OUT_SAVINGS":                     "savings",
    "TRANSFER_IN_INVESTMENT_AND_RETIREMENT":    "transfer",
    "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT":   "transfer",
    "TRANSFER_IN_DEPOSIT":                      "transfer",
    "TRANSFER_OUT_WITHDRAWAL":                  "transfer",
    "LOAN_PAYMENTS_MORTGAGE_PAYMENT":           "rent",
    "LOAN_PAYMENTS_CAR_PAYMENT":                "transport",
    "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT":      "transfer",
    "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT":       "education",
}


def plaid_category_to_internal(detailed: str | None, confidence: str | None) -> str | None:
    """Map Plaid's personal_finance_category.detailed to our internal category ID.

    Returns None if: no mapping exists, confidence is LOW/UNKNOWN, or inputs are missing.
    Only returns a value for VERY_HIGH or HIGH confidence to avoid mis-categorization.
    """
    if not detailed or confidence not in ("VERY_HIGH", "HIGH"):
        return None
    return PLAID_CATEGORY_MAP.get(str(detailed).upper())


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def map_category(cat: str) -> str:
    if cat in CAT_MAP:
        return CAT_MAP[cat]
    return cat.lower().replace(" ", "-").replace("&", "and")


def _resolve_category(
    description: str,
    raw_category: str,
    txn_type: str | None,
    expense_amount: float = 0.0,
) -> str:
    """Map a raw parquet category to a frontend category ID.

    Priority order:
      1. Description matches a transfer pattern  → "transfer"
      2. Category maps to transfer               → "transfer"
      3. Reimbursement category                  → "other"
      4. transaction_type=income or amount < 0   → "income"
      5. Everything else                         → expense category ID
    """
    desc_lower = description.lower()
    if any(p in desc_lower for p in _TRANSFER_DESC_PATTERNS):
        return "transfer"

    cat_id = map_category(raw_category or "other")

    if cat_id == "transfer":
        return "transfer"

    # Refund / Return is always neutral — never reclassified as income even if
    # the amount is negative (it's a credit, not earned income).
    if cat_id == "refund":
        return "refund"

    if raw_category in _REIMBURSEMENT_CATS or cat_id == "reimbursements":
        return "other"

    # If the stored category is explicitly an income category, trust it over txn_type.
    # This handles rows where txn_type was incorrectly set to "expense" before the
    # final category was known (e.g. interest earned categorized after transaction_type
    # was already assigned during sync).
    _INCOME_CATS = {"income", "freelance-and-side-income", "paycheck-and-salary",
                    "investment-and-dividend-income", "other-income"}
    if cat_id in _INCOME_CATS:
        return "income"

    is_income = (txn_type == "income") or (txn_type is None and expense_amount < 0)
    if is_income:
        return "income"

    return cat_id


def detect_refund_pairs(df: "pd.DataFrame", user_rules_path: "Path | None" = None) -> "tuple[pd.DataFrame, int]":
    """Auto-categorize matched charge/refund pairs as 'Refund / Return'.

    Two cases handled:
      1. Full refund  — credit amount == charge amount (within $0.01):
         both the charge and the credit are marked "Refund / Return" so neither
         shows up as expense or income (they cancel out).
      2. Partial refund — credit amount < charge amount, same description,
         within 90 days: only the credit is marked "Refund / Return".
         The original charge keeps its category (e.g. Groceries stays Groceries).

    Conditions for a match:
      - Same description (case-insensitive)
      - Credit arrives within 90 days of the charge
      - Neither transaction has been manually edited
      - Neither transaction is already handled by user rules

    Returns (modified_df, number_of_pairs_found).
    """
    import pandas as pd
    from pathlib import Path as _Path

    if df.empty or "expense_amount" not in df.columns:
        return df, 0

    # Skip transactions already claimed by user rules
    _apply_rules = None
    if user_rules_path is not None and _Path(user_rules_path).exists():
        from categorizer.rules import _load_apply_rules
        _apply_rules = _load_apply_rules(user_rules_path)

    def _rule_handled(idx) -> bool:
        if _apply_rules is None:
            return False
        return bool(_apply_rules(str(df.at[idx, "description"]), float(df.at[idx, "expense_amount"])))

    user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).infer_objects(copy=False).astype(bool)
    editable    = ~user_edited
    dates       = pd.to_datetime(df["date"])
    descs       = df["description"].astype(str).str.strip().str.lower()
    amounts     = df["expense_amount"].astype(float)

    charge_idx = [i for i in df.index[editable & (amounts > 0)] if not _rule_handled(i)]
    credit_idx = [i for i in df.index[editable & (amounts < 0)] if not _rule_handled(i)]

    full_refund_matched = set()   # both sides marked Refund / Return
    partial_credits     = set()   # only the credit marked Refund / Return
    pair_count = 0

    for ci in credit_idx:
        if ci in full_refund_matched or ci in partial_credits:
            continue
        credit_amt  = abs(amounts[ci])
        credit_date = dates[ci]
        credit_desc = descs[ci]

        for di in charge_idx:
            if di in full_refund_matched:
                continue
            if descs[di] != credit_desc:
                continue
            days_diff = (credit_date - dates[di]).days
            if not (0 <= days_diff <= 90):
                continue
            charge_amt = amounts[di]
            if abs(charge_amt - credit_amt) <= 0.01:
                # Full refund — cancel both sides
                full_refund_matched.add(ci)
                full_refund_matched.add(di)
                pair_count += 1
                break
            elif credit_amt < charge_amt:
                # Partial refund — only mark the credit
                partial_credits.add(ci)
                pair_count += 1
                break

    if full_refund_matched or partial_credits:
        df = df.copy()
        if full_refund_matched:
            df.loc[list(full_refund_matched), "category"]    = "Refund / Return"
            df.loc[list(full_refund_matched), "user_edited"] = True
        if partial_credits:
            df.loc[list(partial_credits), "category"]    = "Refund / Return"
            df.loc[list(partial_credits), "user_edited"] = True

    return df, pair_count


def description_fingerprint(s: str) -> str:
    """Normalise a merchant description for fuzzy matching.

    Strips numbers/dates/IDs so 'NETFLIX 1234' matches 'NETFLIX 9999'.
    """
    s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
    s = re.sub(r"[^a-z ]+", " ", s)
    return " ".join(s.split()[:4])


def build_cat_list(cfg: dict) -> list:
    """Return the full ordered category list with user overrides applied."""
    custom    = {c["id"]: c for c in (cfg.get("custom_categories") or [])}
    overrides = cfg.get("category_overrides") or {}
    order     = cfg.get("category_order") or []
    hidden    = set(cfg.get("hidden_categories") or [])

    all_cats: dict[str, dict] = {}
    for kid, v in CAT_META.items():
        if kid in hidden:
            continue
        entry = {"id": kid, **v, "builtin": True}
        if kid in overrides:
            entry.update({k: v2 for k, v2 in overrides[kid].items() if k in ("name", "color")})
        all_cats[kid] = entry
    for cid, c in custom.items():
        if cid not in hidden:
            all_cats[cid] = {"builtin": False, **c}

    ordered = [all_cats[i] for i in order if i in all_cats]
    rest    = [all_cats[i] for i in all_cats if i not in order]
    return ordered + rest

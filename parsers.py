"""
parsers.py — Detects and parses CSV files from Chase Bank, Chase Credit Card, and Amex.

All parsers output a DataFrame with these standard columns:
  - date            : transaction date (datetime)
  - description     : merchant/description string
  - expense_amount  : positive = money spent, negative = credit/refund
  - source          : which account this came from (e.g. "Chase Bank")
  - format          : internal format identifier
"""

import pandas as pd


def detect_format(df):
    """Look at column names to figure out which bank/card this CSV is from."""
    cols = set(df.columns.str.strip())

    # Chase Bank checking/savings has a 'Details' column and a 'Balance' column
    if "Details" in cols and "Balance" in cols and "Posting Date" in cols:
        return "chase_bank"

    # Chase Credit Card has 'Transaction Date', 'Post Date', and 'Memo'
    if "Transaction Date" in cols and "Post Date" in cols and "Memo" in cols:
        return "chase_cc"

    # Amex has a very distinctive 'Extended Details' column
    if "Extended Details" in cols:
        return "amex"

    return "unknown"


def parse_chase_bank(df):
    """
    Parse a Chase Bank (checking or savings) CSV.

    Chase convention: debits (spending) are NEGATIVE, deposits are POSITIVE.
    We flip the sign so that spending shows up as a positive expense_amount.
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    result = pd.DataFrame()
    result["date"] = pd.to_datetime(df["Posting Date"], errors="coerce")
    result["description"] = df["Description"].astype(str).str.strip()
    # Flip sign: a debit of -50.00 becomes expense_amount = +50.00
    result["expense_amount"] = -pd.to_numeric(df["Amount"], errors="coerce")
    result["source"] = "Chase Bank"
    result["format"] = "chase_bank"
    return result


def parse_chase_cc(df):
    """
    Parse a Chase Credit Card CSV.

    Chase CC convention: purchases are NEGATIVE, payments/credits are POSITIVE.
    We flip the sign so purchases show up as positive expense_amount.
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    result = pd.DataFrame()
    result["date"] = pd.to_datetime(df["Transaction Date"], errors="coerce")
    result["description"] = df["Description"].astype(str).str.strip()
    # Flip sign: a charge of -35.00 becomes expense_amount = +35.00
    result["expense_amount"] = -pd.to_numeric(df["Amount"], errors="coerce")
    result["source"] = "Chase Credit Card"
    result["format"] = "chase_cc"
    return result


def parse_amex(df):
    """
    Parse an American Express Credit Card CSV.

    Amex convention: purchases are POSITIVE, credits/payments are NEGATIVE.
    So expense_amount = amount directly (no sign flip needed).
    """
    df = df.copy()
    df.columns = df.columns.str.strip()

    result = pd.DataFrame()
    result["date"] = pd.to_datetime(df["Date"], errors="coerce")
    result["description"] = df["Description"].astype(str).str.strip()
    # No flip needed: Amex charges are already positive
    result["expense_amount"] = pd.to_numeric(df["Amount"], errors="coerce")
    result["source"] = "Amex"
    result["format"] = "amex"
    return result


def load_csv(file):
    """
    Load a CSV file (or file-like object), auto-detect its format, and parse it.

    Returns (dataframe, None) on success, or (None, error_message) on failure.
    """
    try:
        df = pd.read_csv(file)
    except Exception as e:
        return None, f"Could not read file: {e}"

    fmt = detect_format(df)

    if fmt == "chase_bank":
        parsed = parse_chase_bank(df)
    elif fmt == "chase_cc":
        parsed = parse_chase_cc(df)
    elif fmt == "amex":
        parsed = parse_amex(df)
    else:
        cols = list(df.columns)
        return None, (
            f"Unrecognized CSV format. Columns found: {cols}. "
            "Expected Chase Bank, Chase Credit Card, or Amex CSV."
        )

    # Drop rows where we couldn't parse the date or amount
    parsed = parsed.dropna(subset=["date", "expense_amount"])
    return parsed, None


def deduplicate(df):
    """
    Remove duplicate transactions that may appear when the same statement is
    uploaded more than once, or when two CSVs overlap in date range.

    A transaction is considered a duplicate if it has the same date, description,
    and amount as another row — regardless of which file it came from.

    Parameters
    ----------
    df : pd.DataFrame
        Combined transactions DataFrame with 'date', 'description', and
        'expense_amount' columns.

    Returns
    -------
    tuple of (pd.DataFrame, int)
        The deduplicated DataFrame and the number of rows that were removed.
    """
    df = df.copy()

    # Build a composite key: "2024-03-15|starbucks|12.50"
    df["_dedupe_key"] = (
        df["date"].dt.date.astype(str) + "|" +
        df["description"].str.lower().str.strip() + "|" +
        df["expense_amount"].round(2).astype(str)
    )

    before = len(df)
    df = df.drop_duplicates(subset=["_dedupe_key"])
    df = df.drop(columns=["_dedupe_key"])
    removed = before - len(df)

    return df, removed

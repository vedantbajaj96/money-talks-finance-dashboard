"""
stages/upload.py — Stage 1: CSV upload and initial processing.

show_upload_stage()  renders the upload UI.
process_files()      parses, deduplicates, categorizes, and advances to the
                     next stage. Called as a Streamlit button callback.
add_more_files()     merges additional CSVs into an active dashboard session.
                     Imported and called from stages/dashboard.py.
"""

import pandas as pd
import streamlit as st

from categorizer import categorize_transactions, llm_categorize_all
from config import get_active_api_key, get_active_provider
from parsers import deduplicate, load_csv
from sidebar import show_settings_sidebar
from merchants import add_merchant_column
from storage import save_transactions


def _sync_plaid_from_upload() -> None:
    """Sync Plaid transactions from the landing page and advance to dashboard."""
    from plaid_client import sync_all_transactions

    with st.spinner("Fetching transactions from connected banks..."):
        new_df, sync_errors = sync_all_transactions()

    for err in sync_errors:
        st.error(f"Sync error — {err}")

    if new_df.empty:
        if not sync_errors:
            st.warning("No transactions returned. Make sure you have connected a bank account.")
        return

    new_df = categorize_transactions(new_df)
    transactions = _filter_and_label(new_df)
    transactions = _run_llm(transactions)
    transactions = add_merchant_column(transactions)

    save_transactions(transactions)
    st.session_state["df_transactions"] = transactions
    st.session_state["pending_overrides"] = {}
    st.session_state["stage"] = "dashboard"
    st.rerun()


# ---------------------------------------------------------------------------
# Helpers shared with add_more_files
# ---------------------------------------------------------------------------

def _label_transaction_types(df: pd.DataFrame) -> pd.DataFrame:
    """Add a 'transaction_type' column: 'income' if expense_amount < 0, else 'expense'."""
    df = df.copy()
    df["transaction_type"] = df["expense_amount"].apply(
        lambda x: "income" if x < 0 else "expense"
    )
    return df


def _run_llm(transactions: pd.DataFrame) -> pd.DataFrame:
    """
    Run all transactions through the LLM for accurate categorization.
    Shows Streamlit feedback. Returns the updated DataFrame.
    """
    api_key  = get_active_api_key()
    provider = get_active_provider()

    if not api_key:
        pending_count = int((transactions["category"] == "Pending Review").sum())
        if pending_count > 0:
            st.info(
                f"💡 **{pending_count} transaction(s)** couldn't be matched by keyword. "
                "Enter your API key in **⚙️ Settings** (sidebar) to enable "
                "AI categorization, or review them manually in the next step."
            )
        return transactions

    total = len(transactions)
    with st.spinner(f"🤖 AI reviewing all {total} transaction(s) for accuracy..."):
        llm_results, error = llm_categorize_all(
            transactions["description"].tolist(),
            api_key=api_key,
            provider=provider,
            transaction_types=transactions["transaction_type"].tolist(),
        )

    if error:
        st.warning(f"AI categorization ran into a problem: {error}. Falling back to keyword results.")
        return transactions

    for idx, category in zip(transactions.index.tolist(), llm_results):
        transactions.at[idx, "category"] = category
        transactions.at[idx, "suggested_category"] = None

    st.success(f"🤖 AI categorized all {total} transaction(s).")

    # Drop anything the LLM still flagged as a transfer
    return transactions[transactions["category"] != "Financial & Transfers"].copy()


def _filter_and_label(df: pd.DataFrame) -> pd.DataFrame:
    """Keep non-zero, non-transfer rows and add transaction_type."""
    filtered = df[
        (df["expense_amount"] != 0) &
        (df["category"] != "Financial & Transfers")
    ].copy()
    return _label_transaction_types(filtered)


# ---------------------------------------------------------------------------
# Button callbacks
# ---------------------------------------------------------------------------

def process_files(uploaded_files) -> None:
    """
    Streamlit callback: parse uploaded CSVs, deduplicate, keyword-categorize,
    LLM-categorize, then advance to sanity_check or dashboard.
    """
    if not uploaded_files:
        return

    parsed_frames = []
    for file in uploaded_files:
        df_parsed, error = load_csv(file)
        if error:
            st.error(f"**{file.name}**: {error}")
        else:
            df_parsed["source_file"] = file.name
            parsed_frames.append(df_parsed)
            st.success(
                f"Loaded **{file.name}** "
                f"({len(df_parsed):,} transactions, "
                f"source: {df_parsed['source'].iloc[0]})"
            )

    if not parsed_frames:
        return

    df_all = pd.concat(parsed_frames, ignore_index=True)

    df_all, removed = deduplicate(df_all)
    if removed > 0:
        st.info(f"Removed {removed:,} duplicate transaction(s) across files.")

    df_all       = categorize_transactions(df_all)
    transactions = _filter_and_label(df_all)

    if transactions.empty:
        st.warning("No transactions found in the uploaded files.")
        return

    transactions = _run_llm(transactions)
    transactions = add_merchant_column(transactions)

    save_transactions(transactions)
    st.session_state["df_transactions"]  = transactions
    st.session_state["pending_overrides"] = {}

    pending = int((transactions["category"] == "Pending Review").sum())
    st.session_state["stage"] = "sanity_check" if pending > 0 else "dashboard"
    st.rerun()


def add_more_files(uploaded_files) -> None:
    """
    Streamlit callback (called from dashboard sidebar): merge new CSVs into
    the existing session, deduplicate, re-categorize, and refresh.
    """
    if not uploaded_files:
        return

    new_frames = []
    for file in uploaded_files:
        df_parsed, error = load_csv(file)
        if error:
            st.error(f"**{file.name}**: {error}")
        else:
            df_parsed["source_file"] = file.name
            new_frames.append(df_parsed)
            st.success(f"Loaded **{file.name}** ({len(df_parsed):,} transactions)")

    if not new_frames:
        return

    existing = st.session_state.get("df_transactions")
    new_df   = pd.concat(new_frames, ignore_index=True)
    combined = pd.concat([existing, new_df], ignore_index=True) if existing is not None else new_df

    combined, removed = deduplicate(combined)
    if removed:
        st.info(f"Removed {removed:,} duplicate transaction(s).")

    # Only re-categorize rows that don't already have a category
    if "category" not in combined.columns:
        combined = categorize_transactions(combined)
    else:
        new_mask = combined["category"].isna()
        if new_mask.any():
            sub = categorize_transactions(combined[new_mask].copy())
            combined.loc[new_mask, "category"]           = sub["category"]
            combined.loc[new_mask, "suggested_category"] = sub["suggested_category"]

    transactions = _filter_and_label(combined)
    transactions = _run_llm(transactions)
    transactions = add_merchant_column(transactions)

    save_transactions(transactions)
    st.session_state["df_transactions"] = transactions
    st.rerun()


# ---------------------------------------------------------------------------
# Stage renderer
# ---------------------------------------------------------------------------

def show_upload_stage() -> None:
    from plaid_client import is_configured as plaid_is_configured

    show_settings_sidebar()
    st.title("💰 Personal Finance Dashboard")

    # ── Primary: Plaid ────────────────────────────────────────────────────────
    st.subheader("Connect your bank")
    st.markdown(
        "Link your bank accounts for automatic transaction sync. "
        "Your bank credentials go directly to your bank — never stored here."
    )

    if plaid_is_configured():
        from plaid_client import get_connected_accounts
        accounts = get_connected_accounts()

        col1, col2 = st.columns([1, 1], gap="small")
        with col1:
            plaid_url = "http://localhost:8502/connect"
            st.link_button("🏦 Connect a Bank", plaid_url, type="primary")
        with col2:
            if accounts:
                if st.button("⬇️ Sync Transactions", type="primary"):
                    _sync_plaid_from_upload()

        if accounts:
            st.caption(f"{len(accounts)} bank(s) connected: {', '.join(a['institution_name'] for a in accounts)}")
        else:
            st.caption("No banks connected yet — click Connect a Bank to get started.")
    else:
        st.info(
            "Enter your **Plaid Client ID** and **Secret** in ⚙️ Settings (sidebar) to enable bank sync.",
            icon="🔑",
        )

    # ── Secondary: CSV upload ─────────────────────────────────────────────────
    st.divider()
    with st.expander("Or upload CSV statements manually"):
        st.markdown(
            "Supports **Chase Bank** (checking/savings), **Chase Credit Card**, "
            "and **Amex Credit Card** CSV exports."
        )

        with st.expander("How to export your CSVs"):
            st.markdown("""
**Chase Bank (Checking / Savings)**
1. Log in at chase.com → select your checking or savings account.
2. Click **Download account activity** (the download icon near the top right).
3. Choose **CSV** format and your desired date range, then click **Download**.

**Chase Credit Card**
1. Log in at chase.com → select your credit card account.
2. Click **Download account activity**.
3. Choose **CSV** format and your desired date range, then click **Download**.

**American Express (Amex)**
1. Log in at americanexpress.com → go to **Statements & Activity**.
2. Click **Export** at the top right of the transactions list.
3. Choose **CSV** and click **Export**.
            """)

        uploaded_files = st.file_uploader(
            "Choose one or more CSV files",
            type="csv",
            accept_multiple_files=True,
        )

        st.button(
            "Process Files →",
            type="primary",
            on_click=process_files,
            args=(uploaded_files,),
            disabled=(not uploaded_files),
        )

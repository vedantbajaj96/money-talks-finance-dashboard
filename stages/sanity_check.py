"""
stages/sanity_check.py — Stage 2: manual category review.

Shows up to 25 "Pending Review" transactions (sorted by dollar amount) and
lets the user assign the correct category before viewing the dashboard.
"""

import pandas as pd
import streamlit as st

from categorizer import ALL_CATEGORIES, INCOME_CATEGORIES
from sidebar import show_settings_sidebar

_MAX_PENDING_ROWS = 25  # cap so the UI doesn't become overwhelming


def _apply_overrides(selections: dict) -> None:
    """Write the user's category selections back to session state and advance."""
    df = st.session_state["df_transactions"].copy()

    for idx, chosen_category in selections.items():
        df.at[idx, "category"]           = chosen_category
        df.at[idx, "suggested_category"] = None

    st.session_state["df_transactions"]  = df
    st.session_state["pending_overrides"] = selections
    st.session_state["stage"]            = "dashboard"
    st.rerun()


def show_sanity_check_stage() -> None:
    show_settings_sidebar()

    df          = st.session_state["df_transactions"]
    pending_df  = df[df["category"] == "Pending Review"].copy()
    total_count = len(pending_df)

    st.title("💰 Personal Finance Dashboard")
    st.header("Step 2 — Sanity Check")
    st.markdown(
        f"I found **{total_count} transaction(s)** I couldn't automatically place. "
        "Help me categorize them — I've made my best guess for each one."
    )

    # Show highest-value transactions first; cap to keep the UI manageable
    pending_df = pending_df.sort_values("expense_amount", ascending=False)
    if total_count > _MAX_PENDING_ROWS:
        st.warning(
            f"Showing the top {_MAX_PENDING_ROWS} unmatched transactions by dollar amount. "
            f"The remaining {total_count - _MAX_PENDING_ROWS} will stay as 'Pending Review'."
        )
        pending_df = pending_df.head(_MAX_PENDING_ROWS)

    # Column headers
    hdr1, hdr2, hdr3 = st.columns([3, 2, 2])
    hdr1.markdown("**Description**")
    hdr2.markdown("**Amount · Date**")
    hdr3.markdown("**Assign Category**")
    st.divider()

    all_options = ALL_CATEGORIES + INCOME_CATEGORIES
    selections  = {}

    for idx, row in pending_df.iterrows():
        desc = str(row["description"])
        if len(desc) > 45:
            desc = desc[:42] + "..."

        amount_str  = f"${abs(row['expense_amount']):,.2f}"
        date_str    = pd.to_datetime(row["date"]).strftime("%b %-d")
        amount_date = f"{amount_str} · {date_str}"

        suggested   = row.get("suggested_category") or all_options[0]
        if suggested not in all_options:
            suggested = all_options[0]
        default_idx = all_options.index(suggested)

        col1, col2, col3 = st.columns([3, 2, 2])
        col1.write(desc)
        col2.write(amount_date)
        selections[idx] = col3.selectbox(
            label="Category",
            options=all_options,
            index=default_idx,
            key=f"sanity_{idx}",
            label_visibility="collapsed",
        )

    st.divider()

    col_confirm, col_skip = st.columns(2)
    with col_confirm:
        if st.button("Confirm & View Dashboard →", type="primary"):
            _apply_overrides(selections)
    with col_skip:
        if st.button("Skip →"):
            st.session_state["stage"] = "dashboard"
            st.rerun()

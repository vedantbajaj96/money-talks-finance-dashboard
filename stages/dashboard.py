"""
stages/dashboard.py — Stage 3: full spend and income analysis dashboard.

Sections (in order):
  1. Sidebar — filters (date, category, account) + add more files
  2. Cash Flow — total income, total spent, net
  3. Burn Rate — current month spend with MoM delta
  4. Summary metrics — 4 KPIs
  5. Spending Breakdown — horizontal bar + donut by expense category
  6. Income Breakdown — horizontal bar + donut by income category
  7. Monthly Trendline — income vs expenses line chart + stacked spend bar
  8. Transaction Deep-Search — filterable table with inline re-categorization
"""

from __future__ import annotations

import re

import pandas as pd
import plotly.express as px
import streamlit as st

from categorizer import ALL_CATEGORIES, INCOME_CATEGORIES, REIMBURSEMENT_CATEGORY, categorize_transactions
from merchants import add_merchant_column, merchant_summary
from user_rules import add_rule, delete_rule, load_rules
from plaid_client import (
    get_account_balances,
    get_connected_accounts,
    is_configured as plaid_is_configured,
    refresh_all,
    sync_all_transactions,
)
from sidebar import show_settings_sidebar
from stages.upload import _filter_and_label, _run_llm, add_more_files
from storage import ensure_annotation_columns, save_transactions
from subscriptions import detect_recurring


# ---------------------------------------------------------------------------
# Search query parser
# ---------------------------------------------------------------------------

def parse_search_query(query: str) -> tuple[str, float | None, float | None]:
    """
    Parse a free-text search string into (text, min_amount, max_amount).

    Supported amount patterns:
      "> $100"  / ">100"   → min_amount = 100
      "< $50"   / "<50"    → max_amount = 50
      "$50-$200" / "50-200" → min_amount=50, max_amount=200
    Everything else is treated as a merchant name text filter.
    """
    text       = query.strip()
    min_amount = None
    max_amount = None

    gt_match = re.search(r">\s*\$?([\d]+(?:\.[\d]+)?)", text)
    if gt_match:
        min_amount = float(gt_match.group(1))
        text = text[:gt_match.start()] + text[gt_match.end():]

    lt_match = re.search(r"<\s*\$?([\d]+(?:\.[\d]+)?)", text)
    if lt_match:
        max_amount = float(lt_match.group(1))
        text = text[:lt_match.start()] + text[lt_match.end():]

    if min_amount is None and max_amount is None:
        range_match = re.search(r"\$?([\d]+(?:\.[\d]+)?)-\$?([\d]+(?:\.[\d]+)?)", text)
        if range_match:
            min_amount = float(range_match.group(1))
            max_amount = float(range_match.group(2))
            text = text[:range_match.start()] + text[range_match.end():]

    return text.strip(), min_amount, max_amount


# ---------------------------------------------------------------------------
# Section renderers — each takes the filtered df (or sub-df) and draws one
# section of the dashboard.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=300, show_spinner=False)
def _cached_balances() -> list[dict]:
    """Cache Plaid balance API call for 5 minutes to avoid re-fetching on every render."""
    return get_account_balances()


def _render_net_worth() -> None:
    """Show current account balances and net worth from Plaid."""
    if not plaid_is_configured() or not get_connected_accounts():
        return

    balances = _cached_balances()
    if not balances:
        return

    st.header("Net Worth")

    assets      = sum(b["current_balance"] for b in balances if b["account_type"] == "depository")
    liabilities = sum(b["current_balance"] for b in balances if b["account_type"] in ("credit", "loan"))
    net_worth   = assets - liabilities

    col1, col2, col3 = st.columns(3)
    col1.metric("Net Worth", f"${net_worth:,.0f}")
    col2.metric("Assets (Cash & Savings)", f"${assets:,.0f}")
    col3.metric("Liabilities (Credit & Loans)", f"${liabilities:,.0f}")

    # Per-account breakdown
    with st.expander("Account breakdown"):
        for b in balances:
            sign  = "-" if b["account_type"] in ("credit", "loan") else ""
            label = f"{b['institution_name']} — {b['account_name']} ({b['account_type']})"
            st.write(f"**{label}**: {sign}${b['current_balance']:,.2f}")

    st.divider()


def _render_cash_flow(
    df_expenses: pd.DataFrame,
    df_income: pd.DataFrame,
    df_reimbursements: pd.DataFrame,
) -> None:
    st.header("Cash Flow")

    total_income        = df_income["income_amount"].sum() if not df_income.empty else 0.0
    total_spent         = df_expenses["expense_amount"].sum() if not df_expenses.empty else 0.0
    total_reimbursed    = df_reimbursements["expense_amount"].abs().sum() if not df_reimbursements.empty else 0.0
    net                 = total_income - total_spent

    cf1, cf2, cf3, cf4 = st.columns(4)
    cf1.metric("Income (Employer)", f"${total_income:,.2f}")
    cf2.metric("Reimbursements",    f"${total_reimbursed:,.2f}")
    cf3.metric("Total Spent",       f"${total_spent:,.2f}")
    cf4.metric(
        "Net",
        f"${net:,.2f}",
        delta="surplus" if net >= 0 else "deficit",
        delta_color="normal" if net >= 0 else "inverse",
    )
    st.divider()


def _render_burn_rate(df_expenses: pd.DataFrame) -> None:
    st.header("Burn Rate")

    monthly = (
        df_expenses.groupby("month")["expense_amount"]
        .sum()
        .sort_index()
    )

    if len(monthly) >= 2:
        current, prior = monthly.iloc[-1], monthly.iloc[-2]
        pct_change     = ((current - prior) / prior) * 100
        st.metric(
            label=f"Burn Rate — {monthly.index[-1]}",
            value=f"${current:,.2f}",
            delta=f"{pct_change:+.1f}% vs last month",
            delta_color="inverse",
        )
    elif len(monthly) == 1:
        st.metric(
            label=f"Burn Rate — {monthly.index[-1]}",
            value=f"${monthly.iloc[-1]:,.2f}",
        )
    st.divider()


def _render_summary_metrics(
    df: pd.DataFrame,
    df_expenses: pd.DataFrame,
    total_spent: float,
) -> None:
    date_span_days = max(1, (df["date"].max() - df["date"].min()).days)
    avg_monthly    = total_spent / (date_span_days / 30)
    top_category   = (
        df_expenses.groupby("category")["expense_amount"].sum().idxmax()
        if not df_expenses.empty else "—"
    )

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Spent",       f"${total_spent:,.2f}")
    col2.metric("Transactions",      f"{len(df):,}")
    col3.metric("Avg Monthly Spend", f"${avg_monthly:,.2f}")
    col4.metric("Top Expense",       top_category)
    st.divider()


def _render_spending_breakdown(df_expenses: pd.DataFrame) -> None:
    st.header("Spending Breakdown")

    cat_totals = (
        df_expenses.groupby("category")["expense_amount"]
        .sum().sort_values(ascending=True).reset_index()
    )
    cat_totals.columns = ["Category", "Amount"]

    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("By Category")
        fig = px.bar(
            cat_totals, x="Amount", y="Category", orientation="h",
            text=cat_totals["Amount"].map("${:,.0f}".format),
            color="Amount", color_continuous_scale="Blues",
        )
        fig.update_traces(textposition="outside")
        fig.update_layout(
            showlegend=False, coloraxis_showscale=False, height=400,
            xaxis_title="Amount ($)", yaxis_title="",
            margin=dict(l=10, r=80, t=20, b=20),
        )
        st.plotly_chart(fig, use_container_width=True)

    with col_right:
        st.subheader("Share of Total")
        fig = px.pie(cat_totals, values="Amount", names="Category", hole=0.4)
        fig.update_traces(textinfo="percent+label")
        fig.update_layout(height=400, showlegend=False, margin=dict(l=10, r=10, t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)

    st.divider()


def _render_subscriptions(df: pd.DataFrame) -> None:
    recurring = detect_recurring(df)
    if recurring.empty:
        return

    st.header("Subscriptions & Recurring")

    total_monthly = recurring["est_monthly_cost"].sum()
    st.metric("Total Monthly Recurring", f"${total_monthly:,.2f}")

    display = recurring.rename(columns={
        "description":      "Merchant",
        "category":         "Category",
        "amount":           "Charge ($)",
        "frequency":        "Frequency",
        "occurrences":      "Times Seen",
        "last_charge":      "Last Charge",
        "est_monthly_cost": "Est. Monthly ($)",
    })
    display["Charge ($)"]       = display["Charge ($)"].map("${:,.2f}".format)
    display["Est. Monthly ($)"] = display["Est. Monthly ($)"].map("${:,.2f}".format)

    st.dataframe(display, use_container_width=True, hide_index=True)
    st.divider()


def _render_income_breakdown(df_income: pd.DataFrame) -> None:
    if df_income.empty:
        return

    st.header("Income Breakdown")

    income_totals = (
        df_income.groupby("category")["income_amount"]
        .sum().sort_values(ascending=True).reset_index()
    )
    income_totals.columns = ["Category", "Amount"]

    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("By Category")
        fig = px.bar(
            income_totals, x="Amount", y="Category", orientation="h",
            text=income_totals["Amount"].map("${:,.0f}".format),
            color="Amount", color_continuous_scale="Greens",
        )
        fig.update_traces(textposition="outside")
        fig.update_layout(
            showlegend=False, coloraxis_showscale=False, height=300,
            xaxis_title="Amount ($)", yaxis_title="",
            margin=dict(l=10, r=80, t=20, b=20),
        )
        st.plotly_chart(fig, use_container_width=True)

    with col_right:
        st.subheader("Share of Total")
        fig = px.pie(
            income_totals, values="Amount", names="Category", hole=0.4,
            color_discrete_sequence=px.colors.sequential.Greens_r,
        )
        fig.update_traces(textinfo="percent+label")
        fig.update_layout(height=300, showlegend=False, margin=dict(l=10, r=10, t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)

    st.divider()


def _render_trendline(df_expenses: pd.DataFrame, df_income: pd.DataFrame) -> None:
    st.header("Monthly Trendline")

    # Income vs expenses — line chart
    monthly_exp = (
        df_expenses.groupby("month")["expense_amount"]
        .sum().reset_index().rename(columns={"expense_amount": "Amount"})
    )
    monthly_exp["Type"] = "Expenses"

    if not df_income.empty:
        monthly_inc = (
            df_income.groupby("month")["income_amount"]
            .sum().reset_index().rename(columns={"income_amount": "Amount"})
        )
    else:
        monthly_inc = pd.DataFrame(columns=["month", "Amount"])
    monthly_inc["Type"] = "Income"

    cashflow = pd.concat([monthly_exp, monthly_inc], ignore_index=True).sort_values("month")

    fig_line = px.line(
        cashflow, x="month", y="Amount", color="Type", markers=True,
        color_discrete_map={"Expenses": "#EF553B", "Income": "#00CC96"},
        labels={"month": "Month", "Amount": "Amount ($)", "Type": ""},
        title="Income vs Expenses Per Month",
    )
    fig_line.update_layout(height=320, margin=dict(l=10, r=10, t=40, b=20))
    st.plotly_chart(fig_line, use_container_width=True)

    # Stacked bar by expense category — spot lifestyle creep
    monthly_by_cat = (
        df_expenses.groupby(["month", "category"])["expense_amount"]
        .sum().reset_index()
        .rename(columns={"expense_amount": "Amount"})
        .sort_values("month")
    )
    fig_stacked = px.bar(
        monthly_by_cat, x="month", y="Amount", color="category", barmode="stack",
        labels={"month": "Month", "Amount": "Amount ($)", "category": "Category"},
        title="Spend by Category Per Month",
    )
    fig_stacked.update_layout(height=400, margin=dict(l=10, r=10, t=40, b=20))
    st.plotly_chart(fig_stacked, use_container_width=True)

    st.divider()


def _render_transaction_search(df: pd.DataFrame) -> None:
    st.header("Transaction Deep-Search")
    st.caption("Search by merchant name or use price filters: `> $100`, `< $50`, `$50-$200`")

    search_query = st.text_input(
        "Search transactions",
        placeholder='e.g.  "amazon > $20"  or  "starbucks"  or  "$10-$50"',
        label_visibility="collapsed",
    )

    df = ensure_annotation_columns(df)

    display_df = (
        df[["date", "description", "expense_amount", "transaction_type", "category", "source", "notes", "tags"]]
        .copy()
        .sort_values("date", ascending=False)
    )
    total_before_search = len(display_df)

    if search_query:
        text_filter, min_amt, max_amt = parse_search_query(search_query)
        if text_filter:
            display_df = display_df[
                display_df["description"].str.contains(text_filter, case=False, na=False)
            ]
        if min_amt is not None:
            display_df = display_df[display_df["expense_amount"].abs() >= min_amt]
        if max_amt is not None:
            display_df = display_df[display_df["expense_amount"].abs() <= max_amt]

    # Build editor DataFrame — preserve original index for write-back
    editor_df              = display_df.reset_index(names=["_orig_idx"])
    editor_df["date"]      = editor_df["date"].dt.strftime("%Y-%m-%d")
    editor_df["Amount ($)"] = editor_df.apply(
        lambda r: -r["expense_amount"] if r["transaction_type"] == "income" else r["expense_amount"],
        axis=1,
    )
    editor_df = editor_df.rename(columns={
        "date": "Date", "description": "Description",
        "transaction_type": "Type", "category": "Category",
        "source": "Account", "notes": "Notes", "tags": "Tags",
    })

    st.caption("✏️ Click **Category**, **Notes**, or **Tags** cells to edit inline.")

    edited = st.data_editor(
        editor_df[["Date", "Description", "Amount ($)", "Type", "Category", "Account", "Notes", "Tags", "_orig_idx"]],
        column_config={
            "Date":        st.column_config.TextColumn("Date",         disabled=True),
            "Description": st.column_config.TextColumn("Description",  disabled=True),
            "Amount ($)":  st.column_config.NumberColumn("Amount ($)", format="$%.2f", disabled=True),
            "Type":        st.column_config.TextColumn("Type",         disabled=True),
            "Category":    st.column_config.SelectboxColumn(
                               "Category",
                               options=ALL_CATEGORIES + INCOME_CATEGORIES + [REIMBURSEMENT_CATEGORY],
                               required=True,
                           ),
            "Account":     st.column_config.TextColumn("Account",      disabled=True),
            "Notes":       st.column_config.TextColumn("Notes",        max_chars=200),
            "Tags":        st.column_config.TextColumn("Tags",         help="Comma-separated, e.g. business, tax"),
            "_orig_idx":   None,
        },
        hide_index=True,
        use_container_width=True,
        key="txn_editor",
    )

    # Persist category, notes, and tag changes
    changed_cols = ["Category", "Notes", "Tags"]
    changed = [
        i for i in range(len(editor_df))
        if any(editor_df.iloc[i][c] != edited.iloc[i][c] for c in changed_cols)
    ]
    if changed:
        df_main = st.session_state["df_transactions"].copy()
        df_main = ensure_annotation_columns(df_main)
        for pos in changed:
            orig_idx = int(edited.iloc[pos]["_orig_idx"])
            df_main.at[orig_idx, "category"] = edited.iloc[pos]["Category"]
            df_main.at[orig_idx, "notes"]    = edited.iloc[pos]["Notes"] or ""
            df_main.at[orig_idx, "tags"]     = edited.iloc[pos]["Tags"] or ""
        save_transactions(df_main)
        st.session_state["df_transactions"] = df_main
        st.rerun()

    # CSV export of current view
    export_df         = display_df.copy()
    export_df["date"] = export_df["date"].dt.strftime("%Y-%m-%d")
    st.download_button(
        label="⬇️ Export Results to CSV",
        data=export_df.to_csv(index=False).encode("utf-8"),
        file_name="transactions_export.csv",
        mime="text/csv",
    )
    st.caption(f"Showing {len(display_df):,} of {total_before_search:,} transactions")


# ---------------------------------------------------------------------------
# Merchant summary
# ---------------------------------------------------------------------------

def _render_merchant_summary(df_expenses: pd.DataFrame) -> None:
    st.header("Top Merchants")

    if "merchant" not in df_expenses.columns:
        df_expenses = add_merchant_column(df_expenses)

    summary = merchant_summary(df_expenses)
    if summary.empty:
        st.info("No expense data to summarize.")
        return

    top_n = st.slider("Show top N merchants", min_value=5, max_value=30, value=15, key="merchant_top_n")
    top   = summary.head(top_n)

    fig = px.bar(
        top,
        x="total_spent",
        y="merchant",
        orientation="h",
        text=top["total_spent"].apply(lambda v: f"${v:,.0f}"),
        labels={"total_spent": "Total Spent ($)", "merchant": "Merchant"},
        height=max(300, top_n * 28),
    )
    fig.update_traces(textposition="outside")
    fig.update_layout(yaxis={"categoryorder": "total ascending"}, showlegend=False, margin={"l": 10})
    st.plotly_chart(fig, use_container_width=True)

    with st.expander("Full merchant table"):
        display = summary.copy()
        display["total_spent"]      = display["total_spent"].apply(lambda v: f"${v:,.2f}")
        display["avg_transaction"]  = display["avg_transaction"].apply(lambda v: f"${v:,.2f}")
        display.columns             = ["Merchant", "# Transactions", "Total Spent", "Avg Transaction"]
        st.dataframe(display, use_container_width=True, hide_index=True)


# ---------------------------------------------------------------------------
# Custom rules manager
# ---------------------------------------------------------------------------

def _render_custom_rules(df_full: pd.DataFrame) -> None:
    """UI to view, add, and delete user-defined categorization rules."""
    st.header("Categorization Rules")
    st.caption(
        "Rules are applied before AI categorization. "
        "The first matching rule wins. Changes take effect on the next sync or re-categorize."
    )

    rules = load_rules()

    # ── Existing rules ────────────────────────────────────────────────────────
    if rules:
        for i, rule in enumerate(rules):
            col_pat, col_type, col_cat, col_del = st.columns([3, 2, 3, 1])
            col_pat.markdown(f"`{rule['pattern']}`")
            col_type.write(rule["match_type"])
            col_cat.write(rule["category"])
            if col_del.button("✕", key=f"del_rule_{i}"):
                delete_rule(i)
                st.rerun()
    else:
        st.info("No rules yet. Add one below.")

    # ── Add new rule ──────────────────────────────────────────────────────────
    with st.expander("+ Add a rule"):
        c1, c2, c3 = st.columns([3, 2, 3])
        pattern    = c1.text_input("Pattern", placeholder="e.g. whole foods", key="rule_pattern")
        match_type = c2.selectbox("Match type", ["contains", "starts_with", "exact"], key="rule_match")
        category   = c3.selectbox("Category", ALL_CATEGORIES + INCOME_CATEGORIES + [REIMBURSEMENT_CATEGORY], key="rule_cat")

        if st.button("Add Rule", type="primary", disabled=not pattern.strip()):
            add_rule(pattern, match_type, category)
            # Re-apply all rules to existing transactions immediately
            df_main = st.session_state["df_transactions"].copy()
            from user_rules import apply_rules_to_df
            df_main = apply_rules_to_df(df_main)
            save_transactions(df_main)
            st.session_state["df_transactions"] = df_main
            st.success(f"Rule added — transactions recategorized.")
            st.rerun()


# ---------------------------------------------------------------------------
# Stage renderer
# ---------------------------------------------------------------------------

def _sync_plaid_transactions(force_refresh: bool = False) -> None:
    """
    Incremental delta sync. Only fetches changes since the last cursor.
    Historical months are stored locally and never re-fetched.
    """
    if force_refresh:
        with st.spinner("Requesting latest data from banks (this takes a few seconds)..."):
            refresh_errors = refresh_all()
        for err in refresh_errors:
            st.warning(f"Refresh warning — {err}")

    existing = st.session_state.get("df_transactions")

    with st.spinner("Syncing new transactions..."):
        updated_df, sync_errors, stats = sync_all_transactions(existing)

    for err in sync_errors:
        st.error(f"Sync error — {err}")

    if stats["added"] == 0 and stats["modified"] == 0 and stats["removed"] == 0:
        st.info("Already up to date — no new transactions since last sync.")
        return

    # Categorize only the new rows (category=None)
    new_mask = updated_df["category"].isna()
    if new_mask.any():
        new_sub = categorize_transactions(updated_df[new_mask].copy())
        new_sub = _filter_and_label(new_sub)
        new_sub = _run_llm(new_sub)
        new_sub = add_merchant_column(new_sub)
        updated_df = pd.concat(
            [updated_df[~new_mask], new_sub], ignore_index=True
        )

    updated_df = ensure_annotation_columns(updated_df)
    save_transactions(updated_df)
    st.session_state["df_transactions"] = updated_df

    parts = []
    if stats["added"]:    parts.append(f"{stats['added']:,} new")
    if stats["modified"]: parts.append(f"{stats['modified']:,} updated")
    if stats["removed"]:  parts.append(f"{stats['removed']:,} removed")
    st.success(f"Sync complete: {', '.join(parts)}")
    st.rerun()


def show_dashboard_stage() -> None:
    show_settings_sidebar()

    df = st.session_state["df_transactions"].copy()

    # ── Sidebar: add more files + filters ───────────────────────────────────
    with st.sidebar:
        with st.expander("📁 Add More Files"):
            extra_files = st.file_uploader(
                "Upload additional CSVs",
                type="csv",
                accept_multiple_files=True,
                key="dashboard_uploader",
            )
            st.button(
                "Add to Dashboard",
                type="primary",
                on_click=add_more_files,
                args=(extra_files,),
                disabled=(not extra_files),
            )

        # ── Plaid sync ───────────────────────────────────────────────────────
        if plaid_is_configured():
            accounts = get_connected_accounts()
            if accounts:
                with st.expander("🏦 Plaid — Connected Banks"):
                    for acct in accounts:
                        st.write(f"• {acct['institution_name']}")
                    if st.button("⬇️ Sync New Transactions", type="primary", use_container_width=True):
                        _sync_plaid_transactions(force_refresh=False)
                    if st.button("🔄 Force Refresh + Sync", use_container_width=True,
                                 help="Asks banks to push latest data first, then syncs. Slower but most current."):
                        _sync_plaid_transactions(force_refresh=True)
            else:
                st.info(
                    "No banks connected yet. "
                    "Open [localhost:8502/connect](http://localhost:8502/connect) to link an account.",
                    icon="🏦",
                )

        st.divider()
        st.header("Filters")

        all_cats      = sorted(df["category"].unique())
        selected_cats = st.multiselect("Categories", options=all_cats, default=all_cats)

        all_sources      = sorted(df["source"].unique())
        selected_sources = st.multiselect("Accounts", options=all_sources, default=all_sources)

    # ── Apply category + account filters ─────────────────────────────────────
    if selected_cats:
        df = df[df["category"].isin(selected_cats)]
    if selected_sources:
        df = df[df["source"].isin(selected_sources)]

    if df.empty:
        st.warning("No transactions match your current filters.")
        st.stop()

    # ── Render title + unified time filter ───────────────────────────────────
    st.title("💰 Personal Finance Dashboard")

    all_periods = sorted(df["date"].dt.to_period("M").astype(str).unique(), reverse=True)

    filter_mode = st.radio(
        "Time filter", ["By Month", "Custom Range"],
        horizontal=True, label_visibility="collapsed",
        key="time_filter_mode",
    )

    if filter_mode == "By Month":
        # ← / month selector / →
        if "time_month_idx" not in st.session_state or \
                st.session_state.get("time_month_idx", 0) >= len(all_periods):
            st.session_state["time_month_idx"] = 0

        col_prev, col_sel, col_next = st.columns([1, 6, 1])
        with col_prev:
            if st.button("←", key="month_prev") and st.session_state["time_month_idx"] < len(all_periods) - 1:
                st.session_state["time_month_idx"] += 1
                st.rerun()
        with col_sel:
            chosen = st.selectbox(
                "Month", all_periods,
                index=st.session_state["time_month_idx"],
                label_visibility="collapsed",
                key="time_month_sel",
            )
            # Sync index to selectbox without triggering an extra rerun
            st.session_state["time_month_idx"] = all_periods.index(chosen)
        with col_next:
            if st.button("→", key="month_next") and st.session_state["time_month_idx"] > 0:
                st.session_state["time_month_idx"] -= 1
                st.rerun()

        period    = pd.Period(chosen, "M")
        time_start = period.start_time.date()
        time_end   = period.end_time.date()
    else:
        min_date = df["date"].min().date()
        max_date = df["date"].max().date()
        col1, col2 = st.columns(2)
        time_start = col1.date_input("From", value=min_date, min_value=min_date, max_value=max_date, key="range_start")
        time_end   = col2.date_input("To",   value=max_date, min_value=min_date, max_value=max_date, key="range_end")

    df = df[(df["date"].dt.date >= time_start) & (df["date"].dt.date <= time_end)]

    if df.empty:
        st.warning("No transactions in this period.")
        st.stop()

    st.divider()

    # ── Prepare per-type sub-DataFrames ──────────────────────────────────────
    df["month"]           = df["date"].dt.to_period("M").astype(str)
    df_expenses           = df[df["transaction_type"] == "expense"].copy()
    df_income             = df[df["transaction_type"] == "income"].copy()
    df_reimbursements     = df[df["transaction_type"] == "reimbursement"].copy()
    df_income["income_amount"] = df_income["expense_amount"].abs()

    total_income = df_income["income_amount"].sum() if not df_income.empty else 0.0
    total_spent  = df_expenses["expense_amount"].sum() if not df_expenses.empty else 0.0

    _render_net_worth()
    _render_cash_flow(df_expenses, df_income, df_reimbursements)
    _render_burn_rate(df_expenses)
    _render_summary_metrics(df, df_expenses, total_spent)
    _render_spending_breakdown(df_expenses)
    _render_subscriptions(df)
    _render_income_breakdown(df_income)
    _render_trendline(df_expenses, df_income)
    _render_merchant_summary(df_expenses)
    _render_transaction_search(df)
    _render_custom_rules(df)

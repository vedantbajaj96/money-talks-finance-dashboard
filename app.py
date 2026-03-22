"""
app.py — Personal Finance Dashboard

Run with:  streamlit run app.py

This is a multi-stage app:
  Stage 1 — Upload:       User uploads bank/card CSVs.
  Stage 2 — Sanity Check: User confirms categories for unmatched transactions.
  Stage 3 — Dashboard:    Full spend analysis with charts and search.
"""

import json
import os
import re

import pandas as pd
import plotly.express as px
import streamlit as st

from categorizer import ALL_CATEGORIES, categorize_transactions, llm_categorize_all
from parsers import deduplicate, load_csv

# ---------------------------------------------------------------------------
# Config persistence — keys are saved to config.json so they survive restarts
# ---------------------------------------------------------------------------
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def _load_config():
    if os.path.exists(_CONFIG_PATH):
        try:
            with open(_CONFIG_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_config():
    config = {
        "anthropic_api_key": st.session_state.get("anthropic_api_key", ""),
        "gemini_api_key":    st.session_state.get("gemini_api_key", ""),
        "preferred_provider": st.session_state.get("preferred_provider", "claude"),
    }
    try:
        with open(_CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
    except Exception:
        pass


def _get_active_provider():
    """Return which LLM provider to use based on available keys and preference."""
    has_claude = bool(st.session_state.get("anthropic_api_key"))
    has_gemini = bool(st.session_state.get("gemini_api_key"))
    pref = st.session_state.get("preferred_provider", "claude")
    if has_claude and has_gemini:
        return pref
    if has_claude:
        return "claude"
    if has_gemini:
        return "gemini"
    return None


def _get_active_api_key():
    provider = _get_active_provider()
    if provider == "claude":
        return st.session_state.get("anthropic_api_key", "")
    if provider == "gemini":
        return st.session_state.get("gemini_api_key", "")
    return None

# ---------------------------------------------------------------------------
# Page config (must be the very first Streamlit call)
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Finance Dashboard",
    page_icon="💰",
    layout="wide",
)

# ---------------------------------------------------------------------------
# Session state initialisation
# If a key doesn't exist yet, set it to a sensible default.
# ---------------------------------------------------------------------------
if "stage" not in st.session_state:
    st.session_state["stage"] = "upload"

if "df_transactions" not in st.session_state:
    st.session_state["df_transactions"] = None

if "pending_overrides" not in st.session_state:
    st.session_state["pending_overrides"] = {}

# Load persisted settings on first run — config file wins over env var
_cfg = _load_config()
if "anthropic_api_key" not in st.session_state:
    st.session_state["anthropic_api_key"] = (
        _cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
    )
if "gemini_api_key" not in st.session_state:
    st.session_state["gemini_api_key"] = _cfg.get("gemini_api_key", "")
if "preferred_provider" not in st.session_state:
    st.session_state["preferred_provider"] = _cfg.get("preferred_provider", "claude")

# ---------------------------------------------------------------------------
# Privacy notice — shown at the top of every stage
# ---------------------------------------------------------------------------
st.info(
    "🔒 **Your data never leaves this machine.** "
    "All processing happens locally. Nothing is stored or transmitted."
)


# ===========================================================================
# HELPER — parse_search_query
# Extracts text, min_amount, and max_amount from a free-text search string.
#
# Supported patterns:
#   "> 100"  / ">$100"  / "> $100.50"   → min_amount = 100.50
#   "< 50"   / "<$50"                   → max_amount = 50
#   "$50-$200" / "50-200"               → min_amount=50, max_amount=200
#   Everything else is treated as a merchant name text filter.
# ===========================================================================
def parse_search_query(query):
    """
    Parse a search query string and return (text, min_amount, max_amount).

    Parameters
    ----------
    query : str
        Raw search string from the user, e.g. "amazon > $50" or "$20-$100".

    Returns
    -------
    tuple of (str, float or None, float or None)
        text        : merchant name filter (may be empty string)
        min_amount  : minimum expense_amount to show (or None)
        max_amount  : maximum expense_amount to show (or None)
    """
    text = query.strip()
    min_amount = None
    max_amount = None

    # Pattern: > $X  or  >$X  or  > X
    gt_match = re.search(r">\s*\$?([\d]+(?:\.[\d]+)?)", text)
    if gt_match:
        min_amount = float(gt_match.group(1))
        text = text[:gt_match.start()] + text[gt_match.end():]

    # Pattern: < $X  or  <$X  or  < X
    lt_match = re.search(r"<\s*\$?([\d]+(?:\.[\d]+)?)", text)
    if lt_match:
        max_amount = float(lt_match.group(1))
        text = text[:lt_match.start()] + text[lt_match.end():]

    # Pattern: $X-$Y  or  X-Y  (only when no > or < was found)
    if min_amount is None and max_amount is None:
        range_match = re.search(r"\$?([\d]+(?:\.[\d]+)?)-\$?([\d]+(?:\.[\d]+)?)", text)
        if range_match:
            min_amount = float(range_match.group(1))
            max_amount = float(range_match.group(2))
            text = text[:range_match.start()] + text[range_match.end():]

    text = text.strip()
    return text, min_amount, max_amount


# ===========================================================================
# SETTINGS SIDEBAR — shown on every stage
# ===========================================================================
def _validate_claude_key(key):
    """Validate an Anthropic API key with a zero-cost count_tokens call."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        client.messages.count_tokens(
            model="claude-haiku-4-5",
            messages=[{"role": "user", "content": "hi"}],
        )
        return True, None
    except Exception as exc:
        return False, str(exc)


def _validate_gemini_key(key):
    """Validate a Google Gemini API key by listing available models."""
    try:
        from google import genai
        client = genai.Client(api_key=key)
        next(iter(client.models.list()))
        return True, None
    except Exception as exc:
        return False, str(exc)


def _key_input_section(label, session_key, placeholder, validate_fn, valid_state_key):
    """Render a key input + validate button and persist on change."""
    new_key = st.text_input(
        label,
        value=st.session_state.get(session_key, ""),
        type="password",
        placeholder=placeholder,
    )
    if new_key != st.session_state.get(session_key, ""):
        st.session_state[session_key] = new_key
        st.session_state.pop(valid_state_key, None)
        _save_config()
        st.rerun()

    if st.session_state.get(session_key):
        if st.button("Validate", key=f"validate_{session_key}"):
            with st.spinner("Testing connection..."):
                ok, err = validate_fn(st.session_state[session_key])
            st.session_state[valid_state_key] = (ok, err)
            _save_config()

        result = st.session_state.get(valid_state_key)
        if result is None:
            st.info("Key entered — click Validate to confirm", icon="🔑")
        elif result[0]:
            st.success("Valid ✅", icon="✅")
        else:
            st.error(f"Invalid: {result[1]}", icon="❌")
    else:
        st.caption("Not set")


def _reset_session():
    """Clear all transaction data and return to the upload stage."""
    st.session_state["stage"] = "upload"
    st.session_state["df_transactions"] = None
    st.session_state["pending_overrides"] = {}


def show_settings_sidebar():
    """Render the Settings section in the sidebar (visible on all stages)."""
    with st.sidebar:
        if st.session_state.get("stage") != "upload":
            if st.button("🔄 Start Over / Upload New Data", use_container_width=True):
                _reset_session()
                st.rerun()
            st.divider()
        with st.expander("⚙️ Settings", expanded=False):

            # ── Claude (Anthropic) ──────────────────────────────────────────
            st.markdown("**Claude (Anthropic)**")
            st.caption("Get key at [console.anthropic.com](https://console.anthropic.com)")
            _key_input_section(
                label="Anthropic API Key",
                session_key="anthropic_api_key",
                placeholder="sk-ant-...",
                validate_fn=_validate_claude_key,
                valid_state_key="claude_key_valid",
            )

            st.divider()

            # ── Gemini (Google) ─────────────────────────────────────────────
            st.markdown("**Gemini (Google)**")
            st.caption("Get key at [aistudio.google.com](https://aistudio.google.com)")
            _key_input_section(
                label="Gemini API Key",
                session_key="gemini_api_key",
                placeholder="AIza...",
                validate_fn=_validate_gemini_key,
                valid_state_key="gemini_key_valid",
            )

            # ── Provider preference (only shown when both keys are set) ─────
            if st.session_state.get("anthropic_api_key") and st.session_state.get("gemini_api_key"):
                st.divider()
                st.markdown("**Preferred Provider**")
                pref = st.radio(
                    "Provider",
                    options=["claude", "gemini"],
                    format_func=lambda x: "Claude (Anthropic)" if x == "claude" else "Gemini (Google)",
                    index=0 if st.session_state.get("preferred_provider", "claude") == "claude" else 1,
                    label_visibility="collapsed",
                )
                if pref != st.session_state.get("preferred_provider"):
                    st.session_state["preferred_provider"] = pref
                    _save_config()
                    st.rerun()


# ===========================================================================
# STAGE 1 — Upload
# ===========================================================================
def show_upload_stage():
    show_settings_sidebar()
    st.title("💰 Personal Finance Dashboard")
    st.header("Step 1 — Upload Statements")
    st.markdown(
        "Supports **Chase Bank** (checking/savings), **Chase Credit Card**, "
        "and **Amex Credit Card** CSV exports."
    )

    # How-to expander
    with st.expander("How to export your CSVs"):
        st.markdown(
            """
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
            """
        )

    uploaded_files = st.file_uploader(
        "Choose one or more CSV files",
        type="csv",
        accept_multiple_files=True,
    )

    st.button(
        "Process Files →",
        type="primary",
        on_click=_process_files,
        args=(uploaded_files,),
        disabled=(not uploaded_files),
    )


def _process_files(uploaded_files):
    """Callback: parse, deduplicate, categorize, and advance the stage."""
    if not uploaded_files:
        return

    all_transactions = []
    has_error = False

    for file in uploaded_files:
        df_parsed, error = load_csv(file)
        if error:
            st.error(f"**{file.name}**: {error}")
            has_error = True
        else:
            df_parsed["source_file"] = file.name
            all_transactions.append(df_parsed)
            st.success(
                f"Loaded **{file.name}** "
                f"({len(df_parsed):,} transactions, "
                f"source: {df_parsed['source'].iloc[0]})"
            )

    if not all_transactions:
        return

    # Combine all files
    df_all = pd.concat(all_transactions, ignore_index=True)

    # Deduplicate
    df_all, removed_count = deduplicate(df_all)
    if removed_count > 0:
        st.info(
            f"Removed {removed_count:,} duplicate transaction(s) "
            "that appeared in more than one file."
        )

    # Categorize (adds 'category' and 'suggested_category' columns)
    df_all = categorize_transactions(df_all)

    # Keep only expenses: money out, and not internal financial movements
    expenses = df_all[
        (df_all["expense_amount"] > 0) &
        (df_all["category"] != "Financial & Transfers")
    ].copy()

    if expenses.empty:
        st.warning("No expense transactions found in the uploaded files.")
        return

    # -----------------------------------------------------------------------
    # LLM categorization — run ALL expense transactions through Claude for
    # maximum accuracy. Keyword matching is fast but imperfect; the LLM
    # catches nuance, ambiguous merchants, and new businesses.
    # -----------------------------------------------------------------------
    api_key = _get_active_api_key()
    provider = _get_active_provider()
    if api_key:
        total = len(expenses)
        with st.spinner(f"🤖 AI reviewing all {total} transaction(s) for accuracy..."):
            descriptions = expenses["description"].tolist()
            llm_results, llm_error = llm_categorize_all(descriptions, api_key=api_key, provider=provider)

        if llm_error:
            st.warning(
                f"AI categorization ran into a problem: {llm_error}. "
                "Falling back to keyword results."
            )
        else:
            # Apply LLM categories across the board
            for idx, category in zip(expenses.index.tolist(), llm_results):
                expenses.at[idx, "category"] = category
                expenses.at[idx, "suggested_category"] = None
            st.success(f"🤖 AI categorized all {total} transaction(s).")

            # If the LLM flagged anything as Financial & Transfers, drop it
            # (it's a transfer that slipped past the keyword filter)
            expenses = expenses[expenses["category"] != "Financial & Transfers"].copy()
    else:
        pending_count = int((expenses["category"] == "Pending Review").sum())
        if pending_count > 0:
            st.info(
                f"💡 **{pending_count} transaction(s)** couldn't be matched by keyword. "
                "Enter your Anthropic API key in **⚙️ Settings** (sidebar) to enable "
                "AI categorization, or review them manually in the next step."
            )

    # Store in session state
    st.session_state["df_transactions"] = expenses
    st.session_state["pending_overrides"] = {}

    # Decide which stage to go to next
    remaining_pending = int((expenses["category"] == "Pending Review").sum())
    if remaining_pending > 0:
        st.session_state["stage"] = "sanity_check"
    else:
        st.session_state["stage"] = "dashboard"

    st.rerun()


# ===========================================================================
# STAGE 2 — Sanity Check
# ===========================================================================
def show_sanity_check_stage():
    show_settings_sidebar()
    df = st.session_state["df_transactions"]

    pending_df = df[df["category"] == "Pending Review"].copy()
    pending_count = len(pending_df)

    st.title("💰 Personal Finance Dashboard")
    st.header("Step 2 — Sanity Check")
    st.markdown(
        f"I found **{pending_count} transaction(s)** I couldn't automatically place. "
        "Help me categorize them — I've made my best guess for each one."
    )

    # Sort by amount descending (most impactful first)
    pending_df = pending_df.sort_values("expense_amount", ascending=False)

    # Cap at 25 rows to keep the UI manageable
    MAX_ROWS = 25
    if pending_count > MAX_ROWS:
        st.warning(
            f"Showing the top {MAX_ROWS} unmatched transactions by dollar amount. "
            f"The remaining {pending_count - MAX_ROWS} will stay as 'Pending Review'."
        )
        pending_df = pending_df.head(MAX_ROWS)

    # Column headers
    hdr1, hdr2, hdr3 = st.columns([3, 2, 2])
    hdr1.markdown("**Description**")
    hdr2.markdown("**Amount · Date**")
    hdr3.markdown("**Assign Category**")

    st.divider()

    # Collect user selections in a local dict
    selections = {}

    for idx, row in pending_df.iterrows():
        # Truncate long descriptions so the UI stays tidy
        desc = str(row["description"])
        if len(desc) > 45:
            desc = desc[:42] + "..."

        # Format amount and date
        amount_str = f"${row['expense_amount']:,.2f}"
        date_str = pd.to_datetime(row["date"]).strftime("%b %-d")
        amount_date = f"{amount_str} · {date_str}"

        # Use suggested_category as the pre-selected value; fall back to first category
        suggested = row.get("suggested_category") or ALL_CATEGORIES[0]
        # Make sure the suggestion is actually in our list
        if suggested not in ALL_CATEGORIES:
            suggested = ALL_CATEGORIES[0]
        default_idx = ALL_CATEGORIES.index(suggested)

        col1, col2, col3 = st.columns([3, 2, 2])
        col1.write(desc)
        col2.write(amount_date)
        chosen = col3.selectbox(
            label="Category",
            options=ALL_CATEGORIES,
            index=default_idx,
            key=f"sanity_{idx}",
            label_visibility="collapsed",
        )
        selections[idx] = chosen

    st.divider()

    col_confirm, col_skip = st.columns([1, 1])

    with col_confirm:
        if st.button("Confirm & View Dashboard →", type="primary"):
            _apply_overrides(selections)

    with col_skip:
        if st.button("Skip →"):
            st.session_state["stage"] = "dashboard"
            st.rerun()


def _apply_overrides(selections):
    """Apply the user's category selections and advance to the dashboard."""
    df = st.session_state["df_transactions"].copy()

    for idx, chosen_category in selections.items():
        df.at[idx, "category"] = chosen_category
        df.at[idx, "suggested_category"] = None  # No longer pending

    st.session_state["df_transactions"] = df
    st.session_state["pending_overrides"] = selections
    st.session_state["stage"] = "dashboard"
    st.rerun()


# ===========================================================================
# HELPER — add more files to an existing dashboard session
# ===========================================================================
def _add_more_files(uploaded_files):
    """Parse new CSVs, merge with existing transactions, deduplicate, re-categorize."""
    if not uploaded_files:
        return

    new_transactions = []
    for file in uploaded_files:
        df_parsed, error = load_csv(file)
        if error:
            st.error(f"**{file.name}**: {error}")
        else:
            df_parsed["source_file"] = file.name
            new_transactions.append(df_parsed)
            st.success(f"Loaded **{file.name}** ({len(df_parsed):,} transactions)")

    if not new_transactions:
        return

    # Combine new files with whatever is already in the session.
    # Re-attach the existing raw data (before expense filtering) if possible;
    # since we only store expenses we simply concatenate and re-deduplicate.
    existing = st.session_state.get("df_transactions")
    new_df = pd.concat(new_transactions, ignore_index=True)

    if existing is not None:
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df

    # Deduplicate across all data
    combined, removed = deduplicate(combined)
    if removed:
        st.info(f"Removed {removed:,} duplicate transaction(s).")

    # Categorize any rows that don't yet have a category
    needs_cat = "category" not in combined.columns
    if needs_cat:
        combined = categorize_transactions(combined)
    else:
        # Only re-categorize newly added rows (those without a category yet)
        new_mask = combined["category"].isna()
        if new_mask.any():
            sub = combined[new_mask].copy()
            sub = categorize_transactions(sub)
            combined.loc[new_mask, "category"] = sub["category"]
            combined.loc[new_mask, "suggested_category"] = sub["suggested_category"]

    # Filter to expenses
    expenses = combined[
        (combined["expense_amount"] > 0) &
        (combined["category"] != "Financial & Transfers")
    ].copy()

    # LLM-categorize ALL new transactions for accuracy
    api_key = _get_active_api_key()
    provider = _get_active_provider()
    if api_key:
        with st.spinner(f"🤖 AI reviewing {len(expenses)} transaction(s)..."):
            llm_results, llm_error = llm_categorize_all(
                expenses["description"].tolist(), api_key=api_key, provider=provider
            )
        if not llm_error:
            for idx, cat in zip(expenses.index.tolist(), llm_results):
                expenses.at[idx, "category"] = cat
                expenses.at[idx, "suggested_category"] = None
            expenses = expenses[expenses["category"] != "Financial & Transfers"].copy()

    st.session_state["df_transactions"] = expenses
    st.rerun()


# ===========================================================================
# STAGE 3 — Dashboard
# ===========================================================================
def show_dashboard_stage():
    show_settings_sidebar()
    df = st.session_state["df_transactions"].copy()

    # -----------------------------------------------------------------------
    # Sidebar
    # -----------------------------------------------------------------------
    with st.sidebar:
        # --- Add More Files ---
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
                on_click=_add_more_files,
                args=(extra_files,),
                disabled=(not extra_files),
            )

        st.divider()
        st.header("Filters")

        # Date range filter
        min_date = df["date"].min().date()
        max_date = df["date"].max().date()
        date_range = st.date_input(
            "Date range",
            value=(min_date, max_date),
            min_value=min_date,
            max_value=max_date,
        )

        # Category multiselect — show every category present in the data
        all_cats_in_data = sorted(df["category"].unique())
        selected_categories = st.multiselect(
            "Categories",
            options=all_cats_in_data,
            default=all_cats_in_data,
        )

        # Account / source multiselect
        all_sources = sorted(df["source"].unique())
        selected_sources = st.multiselect(
            "Accounts",
            options=all_sources,
            default=all_sources,
        )

    # -----------------------------------------------------------------------
    # Apply sidebar filters
    # -----------------------------------------------------------------------
    if len(date_range) == 2:
        start_date, end_date = date_range
        df = df[
            (df["date"].dt.date >= start_date) &
            (df["date"].dt.date <= end_date)
        ]

    if selected_categories:
        df = df[df["category"].isin(selected_categories)]

    if selected_sources:
        df = df[df["source"].isin(selected_sources)]

    if df.empty:
        st.warning("No transactions match your current filters.")
        st.stop()

    # -----------------------------------------------------------------------
    # Page title
    # -----------------------------------------------------------------------
    st.title("💰 Personal Finance Dashboard")

    # -----------------------------------------------------------------------
    # Burn Rate — most prominent metric at the top
    # -----------------------------------------------------------------------
    st.header("Burn Rate")

    # Add a 'month' period column (e.g. "2024-03")
    df["month"] = df["date"].dt.to_period("M").astype(str)
    monthly_totals = (
        df.groupby("month")["expense_amount"]
        .sum()
        .sort_index()
    )

    if len(monthly_totals) >= 2:
        current_month_total = monthly_totals.iloc[-1]
        prior_month_total = monthly_totals.iloc[-2]
        pct_change = ((current_month_total - prior_month_total) / prior_month_total) * 100
        pct_label = f"{pct_change:+.1f}% vs last month"
        # Streamlit delta: negative delta = green (spending less is good)
        st.metric(
            label=f"Burn Rate — {monthly_totals.index[-1]}",
            value=f"${current_month_total:,.2f}",
            delta=pct_label,
            delta_color="inverse",  # red = increase in spend, green = decrease
        )
    else:
        # Only one month of data available
        current_month_total = monthly_totals.iloc[-1]
        st.metric(
            label=f"Burn Rate — {monthly_totals.index[-1]}",
            value=f"${current_month_total:,.2f}",
        )

    st.divider()

    # -----------------------------------------------------------------------
    # 4 Summary metrics
    # -----------------------------------------------------------------------
    total_spent = df["expense_amount"].sum()
    num_transactions = len(df)
    date_span_days = max(1, (df["date"].max() - df["date"].min()).days)
    avg_monthly = total_spent / (date_span_days / 30)
    top_category = df.groupby("category")["expense_amount"].sum().idxmax()

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Spent", f"${total_spent:,.2f}")
    col2.metric("Transactions", f"{num_transactions:,}")
    col3.metric("Avg Monthly Spend", f"${avg_monthly:,.2f}")
    col4.metric("Top Category", top_category)

    st.divider()

    # -----------------------------------------------------------------------
    # Spending Breakdown — horizontal bar + donut
    # -----------------------------------------------------------------------
    st.header("Spending Breakdown")

    cat_totals = (
        df.groupby("category")["expense_amount"]
        .sum()
        .sort_values(ascending=True)
        .reset_index()
    )
    cat_totals.columns = ["Category", "Amount"]

    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("By Category")
        fig_bar = px.bar(
            cat_totals,
            x="Amount",
            y="Category",
            orientation="h",
            text=cat_totals["Amount"].map("${:,.0f}".format),
            color="Amount",
            color_continuous_scale="Blues",
        )
        fig_bar.update_traces(textposition="outside")
        fig_bar.update_layout(
            showlegend=False,
            coloraxis_showscale=False,
            height=400,
            xaxis_title="Amount ($)",
            yaxis_title="",
            margin=dict(l=10, r=80, t=20, b=20),
        )
        st.plotly_chart(fig_bar, use_container_width=True)

    with col_right:
        st.subheader("Share of Total")
        fig_pie = px.pie(
            cat_totals,
            values="Amount",
            names="Category",
            hole=0.4,
        )
        fig_pie.update_traces(textinfo="percent+label")
        fig_pie.update_layout(
            height=400,
            showlegend=False,
            margin=dict(l=10, r=10, t=20, b=20),
        )
        st.plotly_chart(fig_pie, use_container_width=True)

    st.divider()

    # -----------------------------------------------------------------------
    # Monthly Trendline — line chart + stacked bar
    # -----------------------------------------------------------------------
    st.header("Monthly Trendline")

    monthly_total_df = (
        df.groupby("month")["expense_amount"]
        .sum()
        .reset_index()
        .rename(columns={"expense_amount": "Total"})
        .sort_values("month")
    )

    fig_line = px.line(
        monthly_total_df,
        x="month",
        y="Total",
        markers=True,
        labels={"month": "Month", "Total": "Total Spent ($)"},
        title="Total Spend Per Month",
    )
    fig_line.update_layout(
        height=320,
        margin=dict(l=10, r=10, t=40, b=20),
    )
    st.plotly_chart(fig_line, use_container_width=True)

    # Stacked bar by category — helps spot "lifestyle creep"
    monthly_by_cat = (
        df.groupby(["month", "category"])["expense_amount"]
        .sum()
        .reset_index()
        .rename(columns={"expense_amount": "Amount"})
        .sort_values("month")
    )

    fig_stacked = px.bar(
        monthly_by_cat,
        x="month",
        y="Amount",
        color="category",
        barmode="stack",
        labels={"month": "Month", "Amount": "Amount ($)", "category": "Category"},
        title="Spend by Category Per Month",
    )
    fig_stacked.update_layout(
        height=400,
        margin=dict(l=10, r=10, t=40, b=20),
    )
    st.plotly_chart(fig_stacked, use_container_width=True)

    st.divider()

    # -----------------------------------------------------------------------
    # Transaction Deep-Search
    # -----------------------------------------------------------------------
    st.header("Transaction Deep-Search")
    st.caption(
        "Search by merchant name or use price filters: "
        "`> $100`, `< $50`, `$50-$200`"
    )

    search_query = st.text_input(
        "Search transactions",
        placeholder='e.g.  "amazon > $20"  or  "starbucks"  or  "$10-$50"',
        label_visibility="collapsed",
    )

    # Build the display DataFrame before filtering
    display_df = df[["date", "description", "expense_amount", "category", "source"]].copy()
    display_df = display_df.sort_values("date", ascending=False)
    total_before_search = len(display_df)

    # Apply search filters if a query was entered
    if search_query:
        text_filter, min_amt, max_amt = parse_search_query(search_query)

        if text_filter:
            display_df = display_df[
                display_df["description"].str.contains(
                    text_filter, case=False, na=False
                )
            ]

        if min_amt is not None:
            display_df = display_df[display_df["expense_amount"] >= min_amt]

        if max_amt is not None:
            display_df = display_df[display_df["expense_amount"] <= max_amt]

    num_shown = len(display_df)

    # Build editor DataFrame — keep the original df index so we can write
    # changes back to session state even when the view is filtered.
    editor_df = display_df.reset_index(names=["_orig_idx"])
    editor_df["date"] = editor_df["date"].dt.strftime("%Y-%m-%d")
    editor_df = editor_df.rename(columns={
        "date": "Date",
        "description": "Description",
        "expense_amount": "Amount ($)",
        "category": "Category",
        "source": "Account",
    })

    st.caption("✏️ Click any **Category** cell to recategorize a transaction.")

    edited = st.data_editor(
        editor_df[["Date", "Description", "Amount ($)", "Category", "Account", "_orig_idx"]],
        column_config={
            "Date":       st.column_config.TextColumn("Date",        disabled=True),
            "Description":st.column_config.TextColumn("Description", disabled=True),
            "Amount ($)": st.column_config.NumberColumn("Amount ($)", format="$%.2f", disabled=True),
            "Category":   st.column_config.SelectboxColumn(
                              "Category",
                              options=ALL_CATEGORIES,
                              required=True,
                          ),
            "Account":    st.column_config.TextColumn("Account",     disabled=True),
            "_orig_idx":  None,   # hidden — used for write-back only
        },
        hide_index=True,
        use_container_width=True,
        key="txn_editor",
    )

    # Detect category changes and persist them to session state
    original_cats = editor_df["Category"].values
    new_cats      = edited["Category"].values
    changed_positions = [i for i, (o, n) in enumerate(zip(original_cats, new_cats)) if o != n]

    if changed_positions:
        df_main = st.session_state["df_transactions"].copy()
        for pos in changed_positions:
            orig_idx = int(edited.iloc[pos]["_orig_idx"])
            df_main.at[orig_idx, "category"] = edited.iloc[pos]["Category"]
        st.session_state["df_transactions"] = df_main
        st.rerun()

    # Export button — downloads whatever is currently shown in the table
    export_df = display_df.copy()
    export_df["date"] = export_df["date"].dt.strftime("%Y-%m-%d")
    csv_bytes = export_df.to_csv(index=False).encode("utf-8")
    st.download_button(
        label="⬇️ Export Results to CSV",
        data=csv_bytes,
        file_name="transactions_export.csv",
        mime="text/csv",
    )

    st.caption(f"Showing {num_shown:,} of {total_before_search:,} transactions")


# ===========================================================================
# Main router — pick which stage to render based on session state
# ===========================================================================
current_stage = st.session_state["stage"]

if current_stage == "upload":
    show_upload_stage()

elif current_stage == "sanity_check":
    show_sanity_check_stage()

elif current_stage == "dashboard":
    show_dashboard_stage()

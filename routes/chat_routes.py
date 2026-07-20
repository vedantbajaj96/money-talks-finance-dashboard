"""routes/chat_routes.py — /api/chat endpoint."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from core.auth import get_current_user
from core.store import data_file, get_conn, load_config

router = APIRouter()


def _build_schema(username: str) -> str:
    conn = get_conn(username)
    date_min, date_max = conn.execute("SELECT MIN(date), MAX(date) FROM txns").fetchone()
    total      = conn.execute("SELECT COUNT(*) FROM txns").fetchone()[0]
    categories = [r[0] for r in conn.execute("SELECT DISTINCT category FROM txns ORDER BY category").fetchall()]
    sources    = [r[0] for r in conn.execute("SELECT DISTINCT source FROM txns ORDER BY source").fetchall()]

    return f"""DuckDB view: txns  ({total} rows, {date_min} to {date_max})

Columns:
  date              DATE     — transaction date
  description       VARCHAR  — merchant or payee name
  expense_amount    DOUBLE   — positive = money spent, negative = income / credit
  transaction_type  VARCHAR  — 'expense' or 'income'
  category          VARCHAR  — one of: {', '.join(categories)}
  source            VARCHAR  — account name, one of: {', '.join(sources)}

Notes:
  - Use expense_amount > 0 to filter expenses, < 0 for income
  - All amounts are in USD
  - Date format is YYYY-MM-DD; use strftime(date, '%Y-%m') for month grouping
"""


def _llm_call(messages: list[dict], system: str, cfg: dict, max_tokens: int = 512) -> str:
    preferred  = cfg.get("preferred_provider", "claude")
    claude_key = cfg.get("anthropic_api_key", "")
    gemini_key = cfg.get("gemini_api_key", "")
    providers  = ["claude", "gemini"] if preferred == "claude" else ["gemini", "claude"]

    for provider in providers:
        if provider == "claude" and claude_key:
            try:
                import anthropic
                resp = anthropic.Anthropic(api_key=claude_key).messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                )
                return resp.content[0].text
            except Exception:
                continue

        if provider == "gemini" and gemini_key:
            try:
                from google import genai
                from google.genai import types as gtypes
                client = genai.Client(api_key=gemini_key)
                gemini_msgs = [
                    gtypes.Content(
                        role="model" if m["role"] == "assistant" else m["role"],
                        parts=[gtypes.Part(text=m["content"])],
                    )
                    for m in messages
                ]
                resp = client.models.generate_content(
                    model="gemini-3-flash-preview",
                    contents=gemini_msgs,
                    config=gtypes.GenerateContentConfig(system_instruction=system),
                )
                return resp.text
            except Exception:
                continue

    return ""


@router.post("/api/chat")
def chat(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    messages = body.get("messages", [])
    cfg      = load_config(current_user)

    if not cfg.get("anthropic_api_key") and not cfg.get("gemini_api_key"):
        return {"reply": "No AI provider configured. Add a Claude or Gemini API key in Settings."}

    if not data_file(current_user).exists():
        return {"reply": "No transaction data found. Upload a CSV first."}

    schema        = _build_schema(current_user)
    user_question = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")

    sql_system = f"""You are a DuckDB SQL expert for a personal finance app.
Write a single SELECT query that answers the user's question.
Return ONLY the raw SQL — no explanation, no markdown, no code fences.

{schema}"""

    raw_sql = _llm_call(messages, sql_system, cfg, max_tokens=256).strip()
    if raw_sql.startswith("```"):
        raw_sql = raw_sql.strip("`").lstrip("sql").strip()

    sql_error   = None
    result_text = ""
    row_count   = 0
    try:
        conn      = get_conn(current_user)
        result_df = conn.execute(raw_sql).df()
        row_count   = len(result_df)

        # Cap at 30 rows to limit data sent externally
        result_text = result_df.to_string(index=False, max_rows=30)
    except Exception as e:
        sql_error   = str(e)
        result_text = f"Query failed: {sql_error}"

    interpret_system = (
        "You are a personal finance assistant. "
        "Answer the user's question based only on the SQL query results provided. "
        "Be concise and specific. Use $ for dollar amounts. "
        "If the query failed or returned no rows, say so clearly."
    )
    interpret_messages = [{
        "role": "user",
        "content": (
            f"Question: {user_question}\n\n"
            f"SQL run locally:\n{raw_sql}\n\n"
            f"Results ({row_count} rows):\n{result_text}"
        ),
    }]

    answer = _llm_call(interpret_messages, interpret_system, cfg, max_tokens=512)
    if not answer:
        answer = "Could not get a response from the AI provider."

    return {"reply": answer, "sql": raw_sql, "rows": row_count}

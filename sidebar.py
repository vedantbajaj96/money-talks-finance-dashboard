"""
sidebar.py — Settings sidebar rendered on every stage.

Handles API key input, live key validation, provider preference,
and the "Start Over" button that resets the session.
"""

from __future__ import annotations

import streamlit as st

from config import save_config
from storage import clear_transactions


# ---------------------------------------------------------------------------
# Key validation — cheap API calls that confirm a key works without spending
# ---------------------------------------------------------------------------

def _validate_claude_key(key: str) -> tuple[bool, str | None]:
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


def _validate_gemini_key(key: str) -> tuple[bool, str | None]:
    """Validate a Google Gemini API key by listing available models."""
    try:
        from google import genai
        client = genai.Client(api_key=key)
        next(iter(client.models.list()))
        return True, None
    except Exception as exc:
        return False, str(exc)


# ---------------------------------------------------------------------------
# Reusable key input widget
# ---------------------------------------------------------------------------

def _key_input_section(
    label: str,
    session_key: str,
    placeholder: str,
    validate_fn,
    valid_state_key: str,
) -> None:
    """Render a password input + Validate button for one API key."""
    new_key = st.text_input(
        label,
        value=st.session_state.get(session_key, ""),
        type="password",
        placeholder=placeholder,
    )
    if new_key != st.session_state.get(session_key, ""):
        st.session_state[session_key] = new_key
        st.session_state.pop(valid_state_key, None)
        save_config()
        st.rerun()

    if st.session_state.get(session_key):
        if st.button("Validate", key=f"validate_{session_key}"):
            with st.spinner("Testing connection..."):
                ok, err = validate_fn(st.session_state[session_key])
            st.session_state[valid_state_key] = (ok, err)
            save_config()

        result = st.session_state.get(valid_state_key)
        if result is None:
            st.info("Key entered — click Validate to confirm", icon="🔑")
        elif result[0]:
            st.success("Valid ✅", icon="✅")
        else:
            st.error(f"Invalid: {result[1]}", icon="❌")
    else:
        st.caption("Not set")


# ---------------------------------------------------------------------------
# Session reset
# ---------------------------------------------------------------------------

def reset_session() -> None:
    """Clear all transaction data (memory + disk) and return to the upload stage."""
    clear_transactions()
    st.session_state["stage"] = "upload"
    st.session_state["df_transactions"] = None
    st.session_state["pending_overrides"] = {}


# ---------------------------------------------------------------------------
# Main sidebar renderer — called at the top of every stage
# ---------------------------------------------------------------------------

def show_settings_sidebar() -> None:
    """Render the Settings expander (and Start Over button) in the sidebar."""
    with st.sidebar:
        if st.session_state.get("stage") != "upload":
            if st.button("🔄 Start Over / Upload New Data", use_container_width=True):
                reset_session()
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
                    save_config()
                    st.rerun()

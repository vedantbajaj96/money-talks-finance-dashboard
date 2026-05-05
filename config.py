"""
config.py — Persistent configuration for the Finance Dashboard.

Handles loading and saving API keys and provider preferences to config.json,
and exposes helpers for determining which LLM provider is currently active.
"""

from __future__ import annotations

import json
import os

import streamlit as st

_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config() -> dict:
    """Load persisted settings from config.json. Returns {} on any failure."""
    if os.path.exists(_CONFIG_PATH):
        try:
            with open(_CONFIG_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_config() -> None:
    """Persist current API keys and provider preference to config.json."""
    config = {
        "anthropic_api_key":  st.session_state.get("anthropic_api_key", ""),
        "gemini_api_key":     st.session_state.get("gemini_api_key", ""),
        "preferred_provider": st.session_state.get("preferred_provider", "claude"),
        "plaid_client_id":    st.session_state.get("plaid_client_id", ""),
        "plaid_secret":       st.session_state.get("plaid_secret", ""),
        "plaid_environment":  st.session_state.get("plaid_environment", "sandbox"),
    }
    try:
        with open(_CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
    except Exception:
        pass


def get_active_provider() -> str | None:
    """
    Return which LLM provider to use based on available keys and preference.

    - Both keys set → respect preferred_provider setting.
    - Only one key set → use that provider.
    - No keys set → return None.
    """
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


def get_active_api_key() -> str | None:
    """Return the API key for whichever provider is currently active."""
    provider = get_active_provider()
    if provider == "claude":
        return st.session_state.get("anthropic_api_key", "")
    if provider == "gemini":
        return st.session_state.get("gemini_api_key", "")
    return None

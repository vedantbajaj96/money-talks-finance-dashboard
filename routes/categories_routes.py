"""routes/categories_routes.py — /api/categories/* endpoints."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.categories import CAT_META, build_cat_list, map_category
from core.search import semantic_rank
from core.store import load_config, save_config, load_df

router = APIRouter()


@router.get("/api/categories")
def get_categories(current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    return {"categories": build_cat_list(cfg)}


@router.get("/api/categories/search")
def search_categories(q: str = "", current_user: str = Depends(get_current_user)) -> dict:
    cfg  = load_config(current_user)
    cats = build_cat_list(cfg)
    if not q.strip():
        return {"categories": cats, "semantic": False}
    ranked = semantic_rank(q, cats)
    return {"categories": ranked, "semantic": True}


@router.post("/api/categories")
def create_category(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    cat_id = re.sub(r"[^a-z0-9_]", "_", name.lower().strip())[:32]
    cfg    = load_config(current_user)
    custom = cfg.get("custom_categories") or []
    if cat_id in CAT_META or any(c["id"] == cat_id for c in custom):
        raise HTTPException(409, "category already exists")
    entry = {
        "id":    cat_id,
        "name":  name,
        "color": body.get("color") or "#94a3b8",
        "icon":  body.get("icon")  or "○",
        "group": body.get("group") or "variable",
    }
    custom.append(entry)
    cfg["custom_categories"] = custom
    order = cfg.get("category_order") or []
    order.append(cat_id)
    cfg["category_order"] = order
    save_config(current_user, cfg)
    return {"ok": True, "category": {**entry, "builtin": False}}


@router.patch("/api/categories/{cat_id}")
def update_category(cat_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    if cat_id in CAT_META:
        overrides = cfg.get("category_overrides") or {}
        if cat_id not in overrides:
            overrides[cat_id] = {}
        if "name"  in body: overrides[cat_id]["name"]  = body["name"]
        if "color" in body: overrides[cat_id]["color"] = body["color"]
        cfg["category_overrides"] = overrides
        save_config(current_user, cfg)
        return {"ok": True}
    custom = cfg.get("custom_categories") or []
    for c in custom:
        if c["id"] == cat_id:
            if "name"  in body: c["name"]  = body["name"]
            if "color" in body: c["color"] = body["color"]
            if "group" in body: c["group"] = body["group"]
            cfg["custom_categories"] = custom
            save_config(current_user, cfg)
            return {"ok": True}
    raise HTTPException(404, "category not found")


@router.post("/api/categories/reorder")
def reorder_categories(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    order = body.get("order") or []
    cfg   = load_config(current_user)
    cfg["category_order"] = order
    save_config(current_user, cfg)
    return {"ok": True}


@router.delete("/api/categories/{cat_id}")
def delete_category(cat_id: str, current_user: str = Depends(get_current_user)) -> dict:
    df    = load_df(current_user)
    count = 0
    if df is not None and not df.empty:
        # Parquet stores raw names ("Dining & Drinks") — map each to its frontend ID
        # before comparing, so "dining" correctly matches "Dining & Drinks" rows.
        mapped = df["category"].astype(str).apply(map_category)
        count  = int((mapped == cat_id).sum())
    if count > 0:
        raise HTTPException(409, f"{count} transaction{'s' if count != 1 else ''} use this category — reassign them first")

    cfg = load_config(current_user)

    if cat_id in CAT_META:
        hidden = cfg.get("hidden_categories") or []
        if cat_id not in hidden:
            hidden.append(cat_id)
        cfg["hidden_categories"] = hidden
        cfg["category_order"] = [i for i in (cfg.get("category_order") or []) if i != cat_id]
        save_config(current_user, cfg)
        return {"ok": True}

    custom     = cfg.get("custom_categories") or []
    new_custom = [c for c in custom if c["id"] != cat_id]
    if len(new_custom) == len(custom):
        raise HTTPException(404, "category not found")
    cfg["custom_categories"] = new_custom
    cfg["category_order"]    = [i for i in (cfg.get("category_order") or []) if i != cat_id]
    save_config(current_user, cfg)
    return {"ok": True}

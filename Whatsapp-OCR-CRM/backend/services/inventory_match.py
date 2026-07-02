"""Inventory matching using exact / alias / fuzzy strategies.

We use rapidfuzz for in-memory fuzzy matching since MongoDB has no pg_trgm.
"""
from typing import Optional, Dict, Any, List
from rapidfuzz import fuzz, process

from database import db


async def _all_inventory() -> List[Dict[str, Any]]:
    return await db.inventory.find({}, {"_id": 0}).to_list(2000)


async def match_product(name: str) -> Dict[str, Any]:
    """Return best match info for an input product name.

    Returns dict: { inventoryId, productName, currentRate, unit, matchType, matchScore }
    matchType in: exact, alias, fuzzy, new
    """
    if not name or not name.strip():
        return {"matchType": "new", "matchScore": 0.0, "productName": name, "inventoryId": None}

    n = name.strip()
    n_lower = n.lower()

    items = await _all_inventory()
    if not items:
        return {"matchType": "new", "matchScore": 0.0, "productName": n, "inventoryId": None}

    # 1. Exact (case-insensitive)
    for it in items:
        if it["name"].lower() == n_lower:
            return {
                "inventoryId": it["id"],
                "productName": it["name"],
                "currentRate": it.get("currentRate"),
                "unit": it.get("unit"),
                "matchType": "exact",
                "matchScore": 1.0,
            }

    # 2. Alias (case-insensitive)
    for it in items:
        aliases = [a.lower() for a in (it.get("aliases") or [])]
        if n_lower in aliases:
            return {
                "inventoryId": it["id"],
                "productName": it["name"],
                "currentRate": it.get("currentRate"),
                "unit": it.get("unit"),
                "matchType": "alias",
                "matchScore": 1.0,
            }

    # 3. Fuzzy across name + aliases
    candidates = []
    for it in items:
        candidates.append((it["name"], it))
        for a in (it.get("aliases") or []):
            candidates.append((a, it))

    choices = [c[0] for c in candidates]
    best = process.extractOne(n, choices, scorer=fuzz.WRatio)
    if best:
        _, score, idx = best
        item = candidates[idx][1]
        score_pct = score / 100.0
        if score_pct >= 0.7:
            mt = "fuzzy"
        elif score_pct >= 0.5:
            mt = "fuzzy"  # suggestion
        else:
            mt = "new"
        if mt == "new":
            return {"matchType": "new", "matchScore": score_pct, "productName": n, "inventoryId": None}
        return {
            "inventoryId": item["id"],
            "productName": item["name"],
            "currentRate": item.get("currentRate"),
            "unit": item.get("unit"),
            "matchType": mt,
            "matchScore": round(score_pct, 3),
        }
    return {"matchType": "new", "matchScore": 0.0, "productName": n, "inventoryId": None}


async def search_inventory(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Fuzzy search inventory by name or alias."""
    q = (query or "").strip()
    items = await _all_inventory()
    if not q:
        return items[:limit]
    scored = []
    for it in items:
        candidates = [it["name"]] + list(it.get("aliases") or [])
        best = max(fuzz.WRatio(q, c) for c in candidates)
        if best > 30:
            scored.append((best, it))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "id": it["id"],
            "name": it["name"],
            "currentRate": it.get("currentRate"),
            "unit": it.get("unit"),
            "category": it.get("category"),
        }
        for _, it in scored[:limit]
    ]

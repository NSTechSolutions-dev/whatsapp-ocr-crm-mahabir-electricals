"""Inventory management."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional

from database import db
from auth import get_current_user, require_role
from models import Inventory, CreateInventoryIn, UpdateInventoryIn, UpdateRateIn, RateHistory
from services.inventory_match import search_inventory
from services.automation_service import trigger_price_drop
from services.activity import log_activity

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("")
async def list_inventory(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    items = await db.inventory.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["name"].lower() or any(ql in a.lower() for a in (i.get("aliases") or []))]
    return {"items": items}


@router.get("/search")
async def search(q: str = "", user: dict = Depends(get_current_user)):
    results = await search_inventory(q, limit=10)
    return {"items": results}


@router.post("", dependencies=[Depends(require_role("ADMIN"))])
async def create_item(data: CreateInventoryIn, user: dict = Depends(get_current_user)):
    if await db.inventory.find_one({"name": data.name}):
        raise HTTPException(status_code=400, detail="Product name already exists")
    inv = Inventory(**data.model_dump())
    await db.inventory.insert_one(inv.model_dump())
    # initial rate history
    if data.currentRate is not None:
        rh = RateHistory(inventoryId=inv.id, rate=data.currentRate, changedBy=user["name"])
        await db.rate_history.insert_one(rh.model_dump())
    await log_activity(user["id"], "create", "inventory", inv.id)
    return inv.model_dump()


@router.put("/{inventory_id}", dependencies=[Depends(require_role("ADMIN"))])
async def update_item(inventory_id: str, data: UpdateInventoryIn, user: dict = Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updatedAt"] = datetime.now(timezone.utc).isoformat()
    res = await db.inventory.update_one({"id": inventory_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await log_activity(user["id"], "update", "inventory", inventory_id)
    return await db.inventory.find_one({"id": inventory_id}, {"_id": 0})


@router.put("/{inventory_id}/rate")
async def update_rate(inventory_id: str, data: UpdateRateIn, user: dict = Depends(get_current_user)):
    inv = await db.inventory.find_one({"id": inventory_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Not found")
    old_rate = float(inv.get("currentRate") or 0)
    new_rate = float(data.rate)
    await db.inventory.update_one(
        {"id": inventory_id},
        {"$set": {"currentRate": new_rate, "updatedAt": datetime.now(timezone.utc).isoformat()}},
    )
    rh = RateHistory(inventoryId=inventory_id, rate=new_rate, changedBy=user["name"])
    await db.rate_history.insert_one(rh.model_dump())

    # Price drop automation
    if old_rate and new_rate < old_rate:
        await trigger_price_drop(inventory_id, old_rate, new_rate)

    await log_activity(user["id"], "update_rate", "inventory", inventory_id)
    return {"ok": True, "currentRate": new_rate}


@router.get("/{inventory_id}/rate-history")
async def rate_history(inventory_id: str, user: dict = Depends(get_current_user)):
    items = await db.rate_history.find({"inventoryId": inventory_id}, {"_id": 0}).sort("recordedAt", -1).to_list(200)
    return {"items": items}

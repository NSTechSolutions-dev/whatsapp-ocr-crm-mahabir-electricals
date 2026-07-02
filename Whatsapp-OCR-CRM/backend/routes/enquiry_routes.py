"""Enquiry CRUD + finalize."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from datetime import datetime, timezone
from typing import List

from database import db
from auth import get_current_user
from models import Enquiry, EnquiryItem, CreateEnquiryIn, UpdateEnquiryIn
from services.inventory_match import match_product
from services.activity import log_activity

router = APIRouter(prefix="/enquiries", tags=["enquiries"])


async def _enrich(enquiry: dict) -> dict:
    items = await db.enquiry_items.find({"enquiryId": enquiry["id"]}, {"_id": 0}).sort("createdAt", 1).to_list(500)
    cust = await db.customers.find_one({"id": enquiry["customerId"]}, {"_id": 0})
    # For each item, attach inventory snapshot
    enriched_items = []
    for it in items:
        inv = None
        if it.get("inventoryId"):
            inv = await db.inventory.find_one({"id": it["inventoryId"]}, {"_id": 0})
        enriched_items.append({**it, "inventory": inv})
    quotation = await db.quotations.find_one({"enquiryId": enquiry["id"]}, {"_id": 0})
    return {**enquiry, "customer": cust, "items": enriched_items, "quotation": quotation}


@router.post("")
async def create_enquiry(data: CreateEnquiryIn, user: dict = Depends(get_current_user)):
    # Resolve customer from conversation if not provided
    conv = await db.conversations.find_one({"id": data.conversationId}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    customer_id = data.customerId or conv["customerId"]

    enquiry = Enquiry(
        conversationId=data.conversationId,
        customerId=customer_id,
        createdById=user["id"],
    )
    await db.enquiries.insert_one(enquiry.model_dump())

    # Insert items. If Gemini already matched (inventoryId provided), trust it
    # and skip local fuzzy matching to keep "inventory matching by Emergent AI" intact.
    for item_in in data.items:
        if item_in.inventoryId:
            inv = await db.inventory.find_one({"id": item_in.inventoryId}, {"_id": 0})
            rate = item_in.rate if item_in.rate is not None else (inv.get("currentRate") if inv else None)
            unit = item_in.unit or (inv.get("unit") if inv else None)
            inv_id = item_in.inventoryId
            match_type = item_in.matchType or ("exact" if inv else "new")
            match_score = item_in.matchScore if item_in.matchScore is not None else (1.0 if inv else 0.0)
        else:
            match = await match_product(item_in.productName)
            rate = item_in.rate if item_in.rate is not None else match.get("currentRate")
            unit = item_in.unit or match.get("unit")
            inv_id = match.get("inventoryId")
            match_type = item_in.matchType or match.get("matchType")
            match_score = item_in.matchScore if item_in.matchScore is not None else match.get("matchScore")

        item = EnquiryItem(
            enquiryId=enquiry.id,
            inventoryId=inv_id,
            rawText=item_in.rawText,
            productName=item_in.productName,
            qty=item_in.qty,
            unit=unit,
            rate=rate,
            confidence=item_in.confidence,
            matchType=match_type,
            matchScore=match_score,
        )
        await db.enquiry_items.insert_one(item.model_dump())

    await log_activity(user["id"], "create", "enquiry", enquiry.id)
    out = await db.enquiries.find_one({"id": enquiry.id}, {"_id": 0})
    return await _enrich(out)


@router.get("")
async def list_enquiries(user: dict = Depends(get_current_user), limit: int = 100):
    enquiries = await db.enquiries.find({}, {"_id": 0}).sort("createdAt", -1).limit(limit).to_list(limit)
    result = []
    for e in enquiries:
        cust = await db.customers.find_one({"id": e["customerId"]}, {"_id": 0})
        items_count = await db.enquiry_items.count_documents({"enquiryId": e["id"]})
        result.append({**e, "customer": cust, "itemsCount": items_count})
    return {"items": result}


@router.get("/{enquiry_id}")
async def get_enquiry(enquiry_id: str, user: dict = Depends(get_current_user)):
    e = await db.enquiries.find_one({"id": enquiry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    return await _enrich(e)


@router.put("/{enquiry_id}")
async def update_enquiry(enquiry_id: str, data: UpdateEnquiryIn, user: dict = Depends(get_current_user)):
    e = await db.enquiries.find_one({"id": enquiry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Not found")

    # Replace items (simplest, correct)
    await db.enquiry_items.delete_many({"enquiryId": enquiry_id})
    for it in data.items:
        new_item = EnquiryItem(
            enquiryId=enquiry_id,
            inventoryId=it.inventoryId,
            rawText=it.rawText,
            productName=it.productName,
            qty=it.qty,
            unit=it.unit,
            rate=it.rate,
            confidence=it.confidence,
            matchType=it.matchType,
            matchScore=it.matchScore,
        )
        await db.enquiry_items.insert_one(new_item.model_dump())

    update = {"status": "REVIEW", "updatedAt": datetime.now(timezone.utc).isoformat()}
    if data.gstPercent is not None:
        update["gstPercent"] = data.gstPercent
    await db.enquiries.update_one({"id": enquiry_id}, {"$set": update})
    await log_activity(user["id"], "update", "enquiry", enquiry_id)
    out = await db.enquiries.find_one({"id": enquiry_id}, {"_id": 0})
    return await _enrich(out)


@router.post("/{enquiry_id}/finalize")
async def finalize_enquiry(enquiry_id: str, background: BackgroundTasks, gstPercent: float = 18.0, user: dict = Depends(get_current_user)):
    e = await db.enquiries.find_one({"id": enquiry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    await db.enquiries.update_one(
        {"id": enquiry_id},
        {"$set": {"status": "FINALIZED", "finalizedAt": datetime.now(timezone.utc).isoformat(), "gstPercent": gstPercent}},
    )
    # Generate quotation synchronously (PIL is fast). Returns quotation record.
    from routes.quotation_routes import generate_quotation_for_enquiry
    quotation = await generate_quotation_for_enquiry(enquiry_id, gst_percent=gstPercent)
    await log_activity(user["id"], "finalize", "enquiry", enquiry_id)
    return {"ok": True, "quotationId": quotation["id"]}

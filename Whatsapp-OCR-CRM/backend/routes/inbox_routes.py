"""Inbox routes: conversations + messages."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from database import db
from auth import get_current_user

router = APIRouter(prefix="/inbox", tags=["inbox"])


@router.get("")
async def list_conversations(
    user: dict = Depends(get_current_user),
    page: int = 1, limit: int = 50, q: Optional[str] = None,
):
    skip = (page - 1) * limit
    convs = await db.conversations.find({}, {"_id": 0}).sort("lastMessageAt", -1).skip(skip).limit(limit).to_list(limit)

    # enrich with customer + last message
    result = []
    for c in convs:
        cust = await db.customers.find_one({"id": c["customerId"]}, {"_id": 0}) or {}
        last_msg = await db.whatsapp_messages.find(
            {"conversationId": c["id"]}, {"_id": 0}
        ).sort("createdAt", -1).limit(1).to_list(1)
        preview = ""
        if last_msg:
            m = last_msg[0]
            preview = (m.get("content") or ("[image]" if m["type"] == "image" else "[message]"))[:80]
        result.append({
            "id": c["id"],
            "customer": {"id": cust.get("id"), "phone": cust.get("phone"), "name": cust.get("name"), "company": cust.get("company")},
            "lastMessageAt": c["lastMessageAt"],
            "lastMessagePreview": preview,
            "unreadCount": c.get("unreadCount", 0),
            "status": c.get("status", "open"),
        })

    if q:
        ql = q.lower()
        result = [r for r in result if ql in (r["customer"].get("phone") or "").lower() or ql in (r["customer"].get("name") or "").lower()]
    return {"page": page, "items": result}


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str, user: dict = Depends(get_current_user)):
    conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    cust = await db.customers.find_one({"id": conv["customerId"]}, {"_id": 0})
    messages = await db.whatsapp_messages.find({"conversationId": conversation_id}, {"_id": 0}).sort("createdAt", 1).to_list(1000)
    # mark read
    await db.conversations.update_one({"id": conversation_id}, {"$set": {"unreadCount": 0}})
    return {"conversation": conv, "customer": cust, "messages": messages}

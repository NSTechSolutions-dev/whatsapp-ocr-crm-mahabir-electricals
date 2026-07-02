"""MSG91 webhook (real signature path) + simulator for testing."""
import os
import hmac
import hashlib
import base64
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks, Header
from typing import Optional

from database import db
from models import Customer, Conversation, WhatsappMessage, SimulateInboundIn
from storage import save_bytes, presign_url

log = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])

WEBHOOK_SECRET = os.environ.get("MSG91_WEBHOOK_SECRET", "mock-secret")


def _verify_msg91_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _upsert_inbound_message(*, phone: str, name: Optional[str], msg_type: str, content: Optional[str], media_url: Optional[str], wa_message_id: Optional[str] = None):
    cust = await db.customers.find_one({"phone": phone}, {"_id": 0})
    if not cust:
        c = Customer(phone=phone, name=name)
        await db.customers.insert_one(c.model_dump())
        cust = c.model_dump()
    elif name and not cust.get("name"):
        await db.customers.update_one({"id": cust["id"]}, {"$set": {"name": name}})

    wa_conv_id = f"wa-{cust['id']}"
    conv = await db.conversations.find_one({"waConversationId": wa_conv_id}, {"_id": 0})
    if not conv:
        c = Conversation(customerId=cust["id"], waConversationId=wa_conv_id)
        await db.conversations.insert_one(c.model_dump())
        conv = c.model_dump()

    msg = WhatsappMessage(
        conversationId=conv["id"],
        direction="INBOUND",
        type=msg_type,
        content=content,
        mediaUrl=media_url,
        waMessageId=wa_message_id,
    )
    await db.whatsapp_messages.insert_one(msg.model_dump())
    await db.conversations.update_one(
        {"id": conv["id"]},
        {"$set": {"lastMessageAt": datetime.now(timezone.utc).isoformat()},
         "$inc": {"unreadCount": 1}},
    )
    return conv, msg


@router.post("/webhooks/msg91")
async def msg91_webhook(request: Request, x_msg91_signature: Optional[str] = Header(default=None)):
    raw = await request.body()
    # In MOCK mode we accept missing signature; in real mode we validate
    if os.environ.get("MSG91_MOCK", "1") != "1":
        if not x_msg91_signature or not _verify_msg91_signature(raw, x_msg91_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # MSG91 payload format (simplified)
    phone = payload.get("from") or payload.get("phone")
    msg_type = payload.get("type", "text")
    name = payload.get("name")
    content = payload.get("text") or payload.get("content")
    media_url = payload.get("mediaUrl")
    wa_id = payload.get("messageId")

    if not phone:
        raise HTTPException(status_code=400, detail="Missing phone")

    await _upsert_inbound_message(
        phone=phone, name=name, msg_type=msg_type, content=content,
        media_url=media_url, wa_message_id=wa_id,
    )
    return {"ok": True}


@router.post("/webhooks/simulate-inbound")
async def simulate_inbound(data: SimulateInboundIn):
    """Test helper: simulate an inbound WhatsApp message without real MSG91.

    Accepts text or image (mediaDataUrl is a data:image/png;base64,... blob;
    OR a remote URL via mediaUrl).
    """
    media_url = None
    if data.type == "image":
        if data.mediaDataUrl and data.mediaDataUrl.startswith("data:"):
            try:
                header, b64 = data.mediaDataUrl.split(",", 1)
                # crude mime detection
                ext = "png"
                if "jpeg" in header or "jpg" in header:
                    ext = "jpg"
                elif "webp" in header:
                    ext = "webp"
                raw = base64.b64decode(b64)
                day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                key = f"uploads/whatsapp/{day}/{datetime.now(timezone.utc).timestamp()}.{ext}"
                save_bytes(key, raw)
                # build absolute URL using request? we don't have request here; use relative
                media_url = presign_url(key, 24 * 3600)
            except Exception as e:
                log.exception("failed to decode mediaDataUrl: %s", e)
                raise HTTPException(status_code=400, detail="Invalid mediaDataUrl")
        elif data.mediaUrl:
            media_url = data.mediaUrl

    conv, msg = await _upsert_inbound_message(
        phone=data.phone, name=data.name, msg_type=data.type, content=data.content,
        media_url=media_url,
    )
    return {"ok": True, "conversationId": conv["id"], "messageId": msg.id}

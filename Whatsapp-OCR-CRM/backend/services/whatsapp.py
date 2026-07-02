"""WhatsApp service. Wraps MSG91 calls.

In this Emergent preview MSG91 is MOCKED — outbound messages are logged
to the database and the delivery status is auto-set to 'sent'. To wire
real MSG91 in production, replace _send_to_msg91() with real HTTP calls.
"""
import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional

from database import db
from models import WhatsappMessage

log = logging.getLogger(__name__)

MOCK = os.environ.get("MSG91_MOCK", "1") == "1"


async def _send_to_msg91(payload: dict) -> dict:
    """Real MSG91 call would go here. We log + return synthetic ack."""
    if MOCK:
        log.info("MSG91 MOCK send: %s", payload.get("type"))
        await asyncio.sleep(0.05)
        return {"status": "ok", "messageId": f"mock-{datetime.now(timezone.utc).timestamp()}"}
    # placeholder for production wiring
    raise NotImplementedError("Real MSG91 not configured")


async def send_image_message(*, conversation_id: str, phone: str, image_url: str, caption: str = "") -> str:
    """Queue-style send. Records the outbound message and returns its id."""
    msg = WhatsappMessage(
        conversationId=conversation_id,
        direction="OUTBOUND",
        type="image",
        content=caption,
        mediaUrl=image_url,
        deliveryStatus="sending",
    )
    await db.whatsapp_messages.insert_one(msg.model_dump())

    payload = {"type": "image", "to": phone, "imageUrl": image_url, "caption": caption}
    try:
        ack = await _send_to_msg91(payload)
        await db.whatsapp_messages.update_one(
            {"id": msg.id},
            {"$set": {"waMessageId": ack.get("messageId"), "deliveryStatus": "sent"}},
        )
        await _bump_conversation(conversation_id)
    except Exception as e:
        log.exception("MSG91 send failed: %s", e)
        await db.whatsapp_messages.update_one({"id": msg.id}, {"$set": {"deliveryStatus": "failed"}})
    return msg.id


async def send_template_message(*, conversation_id: Optional[str], phone: str, template_name: str, variables: List[str]) -> str:
    """Send a WhatsApp template message. If no conversation exists, create one."""
    # Ensure customer + conversation
    cust = await db.customers.find_one({"phone": phone})
    if not cust:
        from models import Customer
        c = Customer(phone=phone)
        await db.customers.insert_one(c.model_dump())
        cust = c.model_dump()

    if not conversation_id:
        conv = await db.conversations.find_one({"customerId": cust["id"]})
        if not conv:
            from models import Conversation
            c = Conversation(customerId=cust["id"], waConversationId=f"wa-{cust['id']}")
            await db.conversations.insert_one(c.model_dump())
            conv = c.model_dump()
        conversation_id = conv["id"]

    rendered = template_name + " | " + " ".join(variables)
    msg = WhatsappMessage(
        conversationId=conversation_id,
        direction="OUTBOUND",
        type="template",
        content=rendered,
        deliveryStatus="sending",
    )
    await db.whatsapp_messages.insert_one(msg.model_dump())
    try:
        ack = await _send_to_msg91({"type": "template", "to": phone, "templateName": template_name, "variables": variables})
        await db.whatsapp_messages.update_one(
            {"id": msg.id},
            {"$set": {"waMessageId": ack.get("messageId"), "deliveryStatus": "sent"}},
        )
        await _bump_conversation(conversation_id)
    except Exception as e:
        log.exception("MSG91 template send failed: %s", e)
        await db.whatsapp_messages.update_one({"id": msg.id}, {"$set": {"deliveryStatus": "failed"}})
    return msg.id


async def _bump_conversation(conversation_id: str):
    await db.conversations.update_one(
        {"id": conversation_id},
        {"$set": {"lastMessageAt": datetime.now(timezone.utc).isoformat()}},
    )

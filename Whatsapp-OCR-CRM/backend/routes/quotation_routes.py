"""Quotation routes — generate PNG, fetch, send."""
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request

from database import db
from auth import get_current_user
from models import Quotation
from storage import save_bytes, presign_url
from services.quotation import render_quotation_png
from services.whatsapp import send_image_message
from services.automation_service import schedule_inactivity_followup
from services.activity import log_activity

router = APIRouter(prefix="/quotations", tags=["quotations"])

COMPANY_NAME = os.environ.get("COMPANY_NAME", "Your Company")
COMPANY_ADDRESS = os.environ.get("COMPANY_ADDRESS", "")
COMPANY_GSTIN = os.environ.get("COMPANY_GSTIN", "")
COMPANY_PHONE = os.environ.get("COMPANY_PHONE", "")
COMPANY_WEBSITE = os.environ.get("COMPANY_WEBSITE", "")
QUOTE_VALID_DAYS = int(os.environ.get("QUOTE_VALID_DAYS", "30"))


async def _next_quotation_number() -> str:
    """Generate QT-YYYY-MM-NNNNN, sequence resets monthly. Uses findOneAndUpdate atomic increment."""
    now = datetime.now(timezone.utc)
    key = f"quotation:{now.year:04d}-{now.month:02d}"
    # Motor doc returned has $set first time; we use the upsert+inc combo
    res = await db.sequences.find_one_and_update(
        {"key": key},
        {"$inc": {"value": 1}, "$setOnInsert": {"key": key}},
        upsert=True,
        return_document=True,
    )
    if res is None:
        res = await db.sequences.find_one({"key": key})
    seq = res.get("value", 1) if res else 1
    return f"QT-{now.year:04d}-{now.month:02d}-{seq:05d}"


async def generate_quotation_for_enquiry(enquiry_id: str, gst_percent: float = 18.0) -> dict:
    e = await db.enquiries.find_one({"id": enquiry_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Enquiry not found")

    # If a quotation already exists, regenerate (allow updates)
    cust = await db.customers.find_one({"id": e["customerId"]}, {"_id": 0}) or {}
    items = await db.enquiry_items.find({"enquiryId": enquiry_id}, {"_id": 0}).sort("createdAt", 1).to_list(500)

    rendered_items = []
    subtotal = 0.0
    for it in items:
        rate = float(it.get("rate") or 0)
        qty = float(it.get("qty") or 0)
        amount = round(rate * qty, 2)
        subtotal += amount
        rendered_items.append({
            "name": it.get("productName"),
            "qty": qty,
            "unit": it.get("unit"),
            "rate": rate,
            "amount": amount,
        })
    subtotal = round(subtotal, 2)
    gst_amount = round(subtotal * (gst_percent / 100.0), 2)
    grand_total = round(subtotal + gst_amount, 2)

    existing = await db.quotations.find_one({"enquiryId": enquiry_id}, {"_id": 0})
    number = existing["number"] if existing else await _next_quotation_number()
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%d/%m/%Y")
    valid_until = (now + timedelta(days=QUOTE_VALID_DAYS)).strftime("%d/%m/%Y")
    short_cust_id = (e["customerId"] or "")[-6:].upper() if e.get("customerId") else ""

    png_bytes = render_quotation_png(
        number=number, date_str=date_str, valid_until=valid_until,
        customer_id=short_cust_id,
        customer_name=cust.get("name") or "Customer",
        customer_company=cust.get("company") or "",
        customer_address="",
        customer_phone=cust.get("phone") or "",
        company_name=COMPANY_NAME, company_address=COMPANY_ADDRESS,
        company_gstin=COMPANY_GSTIN, company_phone=COMPANY_PHONE,
        company_website=COMPANY_WEBSITE,
        items=rendered_items, subtotal=subtotal,
        gst_percent=gst_percent, gst_amount=gst_amount, grand_total=grand_total,
    )

    key = f"quotations/{now.year}/{now.month:02d}/{number}.png"
    save_bytes(key, png_bytes)

    quotation_data = {
        "s3Key": key, "s3Url": key, "number": number,
        "gstPercent": gst_percent, "subtotal": subtotal,
        "gstAmount": gst_amount, "grandTotal": grand_total,
    }

    if existing:
        await db.quotations.update_one({"enquiryId": enquiry_id}, {"$set": quotation_data})
        return {**existing, **quotation_data}
    else:
        q = Quotation(enquiryId=enquiry_id, **quotation_data)
        await db.quotations.insert_one(q.model_dump())
        return q.model_dump()


@router.get("/{quotation_id}")
async def get_quotation(quotation_id: str, request: Request, user: dict = Depends(get_current_user)):
    q = await db.quotations.find_one({"id": quotation_id}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Not found")
    enquiry = await db.enquiries.find_one({"id": q["enquiryId"]}, {"_id": 0})
    cust = await db.customers.find_one({"id": enquiry["customerId"]}, {"_id": 0}) if enquiry else None
    items = await db.enquiry_items.find({"enquiryId": q["enquiryId"]}, {"_id": 0}).sort("createdAt", 1).to_list(500)

    # Presigned URL — return as relative path; frontend prepends REACT_APP_BACKEND_URL
    presigned = presign_url(q["s3Key"], 3600)

    # Delivery status from latest outbound message that referenced this image
    delivery = None
    if q.get("sentAt"):
        # find outbound msg whose mediaUrl ends with the s3 key
        msg = await db.whatsapp_messages.find_one(
            {"direction": "OUTBOUND", "type": "image", "mediaUrl": {"$regex": q["s3Key"].replace("/", "\\/")}}, {"_id": 0}
        )
        delivery = msg.get("deliveryStatus") if msg else None
    return {**q, "presignedUrl": presigned, "enquiry": enquiry, "customer": cust, "items": items, "deliveryStatus": delivery}


@router.post("/{quotation_id}/send")
async def send_quotation(quotation_id: str, request: Request, user: dict = Depends(get_current_user)):
    q = await db.quotations.find_one({"id": quotation_id}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Not found")
    enquiry = await db.enquiries.find_one({"id": q["enquiryId"]}, {"_id": 0})
    cust = await db.customers.find_one({"id": enquiry["customerId"]}, {"_id": 0})
    if not cust:
        raise HTTPException(status_code=400, detail="Customer missing")

    base = str(request.base_url).rstrip("/")
    # For WhatsApp delivery we need an absolute URL the customer's phone can reach
    presigned = presign_url(q["s3Key"], 24 * 3600, public_base=base)
    caption = f"Quotation {q['number']} — Grand Total Rs {q['grandTotal']:,.2f}"

    msg_id = await send_image_message(
        conversation_id=enquiry["conversationId"], phone=cust["phone"], image_url=presigned, caption=caption,
    )
    now = datetime.now(timezone.utc).isoformat()
    await db.quotations.update_one({"id": quotation_id}, {"$set": {"sentAt": now}})
    await db.enquiries.update_one({"id": enquiry["id"]}, {"$set": {"status": "SENT"}})

    # Trigger inactivity_followup rules
    rules = await db.automation_rules.find({"triggerType": "inactivity_followup", "isActive": True}).to_list(20)
    for rule in rules:
        days = int(rule.get("triggerParams", {}).get("days", 3))
        await schedule_inactivity_followup(rule, cust["id"], days)

    await log_activity(user["id"], "send", "quotation", quotation_id)
    return {"ok": True, "sentAt": now, "messageId": msg_id}

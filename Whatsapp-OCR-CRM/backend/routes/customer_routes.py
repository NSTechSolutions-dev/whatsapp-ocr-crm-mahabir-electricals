"""CRM (customers) routes."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from collections import Counter

from database import db
from auth import get_current_user

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("")
async def list_customers(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    customers = await db.customers.find({}, {"_id": 0}).sort("updatedAt", -1).to_list(2000)
    if q:
        ql = q.lower()
        customers = [c for c in customers if ql in (c.get("phone") or "").lower() or ql in (c.get("name") or "").lower() or ql in (c.get("company") or "").lower()]

    # Enrich with counts and last activity
    result = []
    for c in customers:
        enquiry_count = await db.enquiries.count_documents({"customerId": c["id"]})
        last_enquiry = await db.enquiries.find({"customerId": c["id"]}, {"_id": 0}).sort("createdAt", -1).limit(1).to_list(1)
        last_activity = last_enquiry[0]["createdAt"] if last_enquiry else c.get("updatedAt")
        result.append({**c, "enquiryCount": enquiry_count, "lastActivity": last_activity})
    return {"items": result}


@router.get("/{customer_id}")
async def get_customer(customer_id: str, user: dict = Depends(get_current_user)):
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Not found")
    enquiries = await db.enquiries.find({"customerId": customer_id}, {"_id": 0}).sort("createdAt", -1).to_list(500)
    # Enrich enquiries with item count and quotation
    enriched_enquiries = []
    product_counter: Counter = Counter()
    for e in enquiries:
        items = await db.enquiry_items.find({"enquiryId": e["id"]}, {"_id": 0}).to_list(200)
        quot = await db.quotations.find_one({"enquiryId": e["id"]}, {"_id": 0})
        for it in items:
            product_counter[it["productName"]] += 1
        enriched_enquiries.append({**e, "itemsCount": len(items), "quotation": quot})

    convs = await db.conversations.find({"customerId": customer_id}, {"_id": 0}).to_list(50)
    messages = []
    for c in convs:
        msgs = await db.whatsapp_messages.find({"conversationId": c["id"]}, {"_id": 0}).sort("createdAt", 1).to_list(2000)
        messages.extend(msgs)
    messages.sort(key=lambda m: m["createdAt"])

    quotation_count = sum(1 for e in enriched_enquiries if e.get("quotation"))
    top_products = [{"name": n, "count": c} for n, c in product_counter.most_common(5)]

    return {
        "customer": cust,
        "stats": {
            "totalEnquiries": len(enriched_enquiries),
            "quotationsSent": quotation_count,
            "lastActivity": enriched_enquiries[0]["createdAt"] if enriched_enquiries else cust.get("updatedAt"),
        },
        "enquiries": enriched_enquiries,
        "messages": messages,
        "topProducts": top_products,
    }

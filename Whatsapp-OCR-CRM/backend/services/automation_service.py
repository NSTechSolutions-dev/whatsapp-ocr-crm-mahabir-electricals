"""Automation service.

Implements four trigger handlers and a simple scheduler that runs in the
background. We don't have BullMQ; we use asyncio + DB-backed ScheduledJob rows.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

from database import db
from models import ScheduledJob
from services.whatsapp import send_template_message

log = logging.getLogger(__name__)


async def schedule_inactivity_followup(rule: Dict[str, Any], customer_id: str, days: int):
    """Schedule a follow-up N days after a quotation is sent."""
    when = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    job = ScheduledJob(
        ruleId=rule["id"], customerId=customer_id, scheduledAt=when, payload={"type": "inactivity_followup"}
    )
    await db.scheduled_jobs.insert_one(job.model_dump())
    return job.id


async def trigger_price_drop(inventory_id: str, old_rate: float, new_rate: float):
    """When inventory rate drops, find customers who enquired about it & notify."""
    if new_rate >= (old_rate or new_rate):
        return  # not a drop
    rules = await db.automation_rules.find({"triggerType": "price_drop_alert", "isActive": True}).to_list(20)
    if not rules:
        return

    # Find customers who enquired about this product
    items = await db.enquiry_items.find({"inventoryId": inventory_id}, {"_id": 0}).to_list(500)
    enquiry_ids = list({it["enquiryId"] for it in items})
    if not enquiry_ids:
        return
    enquiries = await db.enquiries.find({"id": {"$in": enquiry_ids}}, {"_id": 0}).to_list(500)
    customer_ids = list({e["customerId"] for e in enquiries})
    inv = await db.inventory.find_one({"id": inventory_id}, {"_id": 0})
    if not inv:
        return

    for rule in rules:
        template = rule.get("actionParams", {}).get("templateName", "price_drop_alert")
        for cid in customer_ids:
            cust = await db.customers.find_one({"id": cid}, {"_id": 0})
            if not cust:
                continue
            variables = [cust.get("name") or "Customer", inv["name"], f"{old_rate:.2f}", f"{new_rate:.2f}"]
            await send_template_message(
                conversation_id=None, phone=cust["phone"], template_name=template, variables=variables
            )
            # log a scheduled_jobs row for audit
            job = ScheduledJob(
                ruleId=rule["id"], customerId=cid,
                scheduledAt=datetime.now(timezone.utc).isoformat(),
                status="COMPLETED",
                payload={"type": "price_drop_alert", "inventoryId": inventory_id, "oldRate": old_rate, "newRate": new_rate},
            )
            await db.scheduled_jobs.insert_one(job.model_dump())


async def trigger_enquiry_reminder():
    """For DRAFT enquiries older than N hours, log an internal alert (no WhatsApp)."""
    rules = await db.automation_rules.find({"triggerType": "enquiry_reminder", "isActive": True}).to_list(20)
    for rule in rules:
        hours = int(rule.get("triggerParams", {}).get("hours", 24))
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        stale = await db.enquiries.find({"status": "DRAFT", "createdAt": {"$lt": cutoff}}, {"_id": 0}).to_list(200)
        for e in stale:
            # avoid duplicate alerts: only log once per enquiry per rule
            existing = await db.scheduled_jobs.find_one({"ruleId": rule["id"], "payload.enquiryId": e["id"]})
            if existing:
                continue
            job = ScheduledJob(
                ruleId=rule["id"], customerId=e["customerId"],
                scheduledAt=datetime.now(timezone.utc).isoformat(),
                status="COMPLETED",
                payload={"type": "enquiry_reminder", "enquiryId": e["id"]},
            )
            await db.scheduled_jobs.insert_one(job.model_dump())


async def trigger_repeat_engagement():
    """For customers whose last enquiry was > N days ago, send re-engagement template."""
    rules = await db.automation_rules.find({"triggerType": "repeat_engagement", "isActive": True}).to_list(20)
    for rule in rules:
        days = int(rule.get("triggerParams", {}).get("days", 30))
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        # find customers whose latest enquiry is older than cutoff
        # naive scan: list customers, find their max enquiry createdAt
        customers = await db.customers.find({}, {"_id": 0}).to_list(2000)
        for cust in customers:
            latest = await db.enquiries.find({"customerId": cust["id"]}, {"_id": 0}).sort("createdAt", -1).limit(1).to_list(1)
            if not latest:
                continue
            if latest[0]["createdAt"] > cutoff:
                continue
            # avoid sending more than once a month per rule per customer
            recent_job = await db.scheduled_jobs.find_one({
                "ruleId": rule["id"], "customerId": cust["id"],
                "scheduledAt": {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()},
            })
            if recent_job:
                continue
            template = rule.get("actionParams", {}).get("templateName", "repeat_engagement")
            await send_template_message(conversation_id=None, phone=cust["phone"], template_name=template, variables=[cust.get("name") or "Customer"])
            job = ScheduledJob(
                ruleId=rule["id"], customerId=cust["id"],
                scheduledAt=datetime.now(timezone.utc).isoformat(),
                status="COMPLETED",
                payload={"type": "repeat_engagement"},
            )
            await db.scheduled_jobs.insert_one(job.model_dump())


async def run_due_jobs():
    """Process scheduled jobs whose time has come (inactivity_followup type)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    due = await db.scheduled_jobs.find({"status": "PENDING", "scheduledAt": {"$lte": now_iso}}, {"_id": 0}).to_list(50)
    for job in due:
        await db.scheduled_jobs.update_one({"id": job["id"]}, {"$set": {"status": "PROCESSING"}})
        try:
            ptype = job.get("payload", {}).get("type")
            rule = await db.automation_rules.find_one({"id": job["ruleId"]}, {"_id": 0})
            cust = await db.customers.find_one({"id": job["customerId"]}, {"_id": 0})
            if not rule or not cust:
                await db.scheduled_jobs.update_one({"id": job["id"]}, {"$set": {"status": "FAILED"}})
                continue

            if ptype == "inactivity_followup":
                # Check no reply since quotation sent
                template = rule.get("actionParams", {}).get("templateName", "inactivity_followup")
                await send_template_message(conversation_id=None, phone=cust["phone"], template_name=template, variables=[cust.get("name") or "Customer"])
            await db.scheduled_jobs.update_one({"id": job["id"]}, {"$set": {"status": "COMPLETED"}})
        except Exception as e:
            log.exception("Job failed: %s", e)
            await db.scheduled_jobs.update_one({"id": job["id"]}, {"$set": {"status": "FAILED"}})


async def automation_loop():
    """Background loop. Runs every 30s in MOCK mode."""
    while True:
        try:
            await run_due_jobs()
            await trigger_enquiry_reminder()
        except Exception as e:
            log.exception("automation_loop tick failed: %s", e)
        await asyncio.sleep(30)

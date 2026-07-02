"""Automation rule management + manual trigger endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone

from database import db
from auth import get_current_user, require_role
from models import AutomationRule, CreateRuleIn, UpdateRuleIn
from services.automation_service import trigger_enquiry_reminder, trigger_repeat_engagement, run_due_jobs

router = APIRouter(prefix="/automation", tags=["automation"])


@router.get("/rules")
async def list_rules(user: dict = Depends(get_current_user)):
    rules = await db.automation_rules.find({}, {"_id": 0}).sort("createdAt", -1).to_list(200)
    return {"items": rules}


@router.post("/rules")
async def create_rule(data: CreateRuleIn, user: dict = Depends(get_current_user)):
    rule = AutomationRule(**data.model_dump())
    await db.automation_rules.insert_one(rule.model_dump())
    return rule.model_dump()


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: str, data: UpdateRuleIn, user: dict = Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updatedAt"] = datetime.now(timezone.utc).isoformat()
    res = await db.automation_rules.update_one({"id": rule_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.automation_rules.find_one({"id": rule_id}, {"_id": 0})


@router.delete("/rules/{rule_id}", dependencies=[Depends(require_role("ADMIN"))])
async def delete_rule(rule_id: str, user: dict = Depends(get_current_user)):
    res = await db.automation_rules.delete_one({"id": rule_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.get("/jobs")
async def list_scheduled_jobs(user: dict = Depends(get_current_user), limit: int = 100):
    jobs = await db.scheduled_jobs.find({}, {"_id": 0}).sort("scheduledAt", -1).limit(limit).to_list(limit)
    # enrich with rule and customer
    out = []
    for j in jobs:
        rule = await db.automation_rules.find_one({"id": j["ruleId"]}, {"_id": 0})
        cust = await db.customers.find_one({"id": j["customerId"]}, {"_id": 0})
        out.append({**j, "rule": rule, "customer": cust})
    return {"items": out}


@router.post("/run-now")
async def run_now(user: dict = Depends(get_current_user)):
    """Manually trigger automation ticks (useful in testing)."""
    await trigger_enquiry_reminder()
    await trigger_repeat_engagement()
    await run_due_jobs()
    return {"ok": True}

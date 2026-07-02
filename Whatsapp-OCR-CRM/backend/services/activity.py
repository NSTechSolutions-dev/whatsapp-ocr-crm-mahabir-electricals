"""Activity logging helper."""
from database import db
from models import ActivityLog


async def log_activity(user_id: str, action: str, entity_type: str, entity_id: str = None):
    if not user_id:
        return
    a = ActivityLog(userId=user_id, action=action, entityType=entity_type, entityId=entity_id)
    await db.activity_logs.insert_one(a.model_dump())

"""MongoDB connection module."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_mongo_url = os.environ['MONGO_URL']
_db_name = os.environ['DB_NAME']

client = AsyncIOMotorClient(_mongo_url)
db = client[_db_name]


async def ensure_indexes():
    """Create indexes on collections we query."""
    await db.users.create_index("email", unique=True)
    await db.customers.create_index("phone", unique=True)
    await db.conversations.create_index("waConversationId", unique=True)
    await db.conversations.create_index([("lastMessageAt", -1)])
    await db.whatsapp_messages.create_index([("conversationId", 1), ("createdAt", 1)])
    await db.enquiries.create_index([("createdAt", -1)])
    await db.enquiries.create_index("customerId")
    await db.enquiry_items.create_index("enquiryId")
    await db.inventory.create_index("name", unique=True)
    await db.inventory.create_index("aliases")
    await db.quotations.create_index("enquiryId", unique=True)
    await db.quotations.create_index("number", unique=True)
    await db.automation_rules.create_index("triggerType")
    await db.scheduled_jobs.create_index([("scheduledAt", 1), ("status", 1)])
    await db.sequences.create_index("key", unique=True)
    await db.refresh_tokens.create_index("userId")
    await db.activity_logs.create_index([("createdAt", -1)])

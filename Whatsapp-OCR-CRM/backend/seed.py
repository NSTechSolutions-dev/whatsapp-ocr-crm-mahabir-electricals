"""Seed initial admin user + sample inventory."""
import asyncio
from database import db
from auth import hash_password
from models import User, Inventory


ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "Admin@1234"

SAMPLE_INVENTORY = [
    {"name": "A4 Copier Paper", "aliases": ["a4 paper", "a4", "copier paper"], "unit": "Ream", "currentRate": 280.0, "category": "Paper"},
    {"name": "Legal Size Paper", "aliases": ["legal paper", "fs paper", "fullscape"], "unit": "Ream", "currentRate": 320.0, "category": "Paper"},
    {"name": "Blue Ball Pen", "aliases": ["blue pen", "ball pen blue", "bp blue"], "unit": "Pcs", "currentRate": 8.0, "category": "Writing"},
    {"name": "Black Ball Pen", "aliases": ["black pen", "ball pen black", "bp black"], "unit": "Pcs", "currentRate": 8.0, "category": "Writing"},
    {"name": "Whiteboard Marker", "aliases": ["wb marker", "marker"], "unit": "Pcs", "currentRate": 35.0, "category": "Writing"},
    {"name": "Stapler No. 10", "aliases": ["stapler", "small stapler"], "unit": "Pcs", "currentRate": 65.0, "category": "Office"},
    {"name": "Stapler Pins No. 10", "aliases": ["stapler pins", "pins"], "unit": "Box", "currentRate": 15.0, "category": "Office"},
    {"name": "File Folder A4", "aliases": ["folder", "file folder", "box file"], "unit": "Pcs", "currentRate": 45.0, "category": "Filing"},
    {"name": "Sticky Notes 3x3", "aliases": ["post it", "sticky", "sticky notes"], "unit": "Pad", "currentRate": 55.0, "category": "Office"},
    {"name": "Notebook 200 Pages", "aliases": ["notebook", "register", "long book"], "unit": "Pcs", "currentRate": 95.0, "category": "Books"},
    {"name": "Highlighter Yellow", "aliases": ["highlighter", "marker yellow"], "unit": "Pcs", "currentRate": 25.0, "category": "Writing"},
    {"name": "Glue Stick", "aliases": ["glue", "gum stick"], "unit": "Pcs", "currentRate": 30.0, "category": "Office"},
]


async def seed():
    # Ensure indexes first
    from database import ensure_indexes
    await ensure_indexes()

    # Seed admin (idempotent)
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        admin = User(
            name="Admin",
            email=ADMIN_EMAIL,
            passwordHash=hash_password(ADMIN_PASSWORD),
            role="ADMIN",
        )
        await db.users.insert_one(admin.model_dump())
        print(f"Seeded admin: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    else:
        print("Admin already exists")

    # Seed inventory (idempotent on name)
    for item in SAMPLE_INVENTORY:
        if not await db.inventory.find_one({"name": item["name"]}):
            inv = Inventory(**item)
            await db.inventory.insert_one(inv.model_dump())
    print(f"Inventory seeded ({len(SAMPLE_INVENTORY)} items)")


if __name__ == "__main__":
    asyncio.run(seed())

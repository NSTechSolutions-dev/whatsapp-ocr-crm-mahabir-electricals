"""Admin user management."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone

from database import db
from auth import get_current_user, require_role, hash_password
from models import User, CreateUserIn, UpdateUserIn

router = APIRouter(prefix="/users", tags=["users"])


def _strip(user: dict) -> dict:
    user.pop("passwordHash", None)
    return user


@router.get("", dependencies=[Depends(require_role("ADMIN"))])
async def list_users(user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "passwordHash": 0}).sort("createdAt", -1).to_list(500)
    return {"items": users}


@router.post("", dependencies=[Depends(require_role("ADMIN"))])
async def create_user(data: CreateUserIn, user: dict = Depends(get_current_user)):
    email_lc = data.email.lower()
    if await db.users.find_one({"email": email_lc}):
        raise HTTPException(status_code=400, detail="Email already in use")
    u = User(name=data.name, email=email_lc, passwordHash=hash_password(data.password), role=data.role)
    await db.users.insert_one(u.model_dump())
    return _strip(u.model_dump())


@router.put("/{user_id}", dependencies=[Depends(require_role("ADMIN"))])
async def update_user(user_id: str, data: UpdateUserIn, user: dict = Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updatedAt"] = datetime.now(timezone.utc).isoformat()
    res = await db.users.update_one({"id": user_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "passwordHash": 0})
    return u

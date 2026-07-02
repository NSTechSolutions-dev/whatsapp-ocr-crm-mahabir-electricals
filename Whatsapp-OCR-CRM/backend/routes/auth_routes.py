"""Auth routes."""
from fastapi import APIRouter, Response, Request, HTTPException, Depends

from database import db
from models import LoginIn, UserPublic
from auth import (
    verify_password, sign_access_token, sign_refresh_token, verify_refresh,
    set_auth_cookies, clear_auth_cookies, get_current_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(data: LoginIn, response: Response):
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user or not user.get("isActive"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(data.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access = sign_access_token(user["id"], user["role"])
    refresh = sign_refresh_token(user["id"])
    # Track refresh token in DB for rotation
    await db.refresh_tokens.update_one(
        {"userId": user["id"]},
        {"$set": {"userId": user["id"], "token": refresh}},
        upsert=True,
    )
    set_auth_cookies(response, access, refresh)
    return {
        "user": {
            "id": user["id"], "name": user["name"], "email": user["email"],
            "role": user["role"], "isActive": user["isActive"], "createdAt": user["createdAt"],
        },
        "accessToken": access,  # also returned for clients that prefer Authorization header
    }


@router.post("/logout")
async def logout(response: Response, request: Request):
    token = request.cookies.get("refresh_token")
    if token:
        try:
            payload = verify_refresh(token)
            await db.refresh_tokens.delete_one({"userId": payload["sub"]})
        except Exception:
            pass
    clear_auth_cookies(response)
    return {"ok": True}


@router.post("/refresh")
async def refresh(response: Response, request: Request):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = verify_refresh(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    stored = await db.refresh_tokens.find_one({"userId": payload["sub"]})
    if not stored or stored.get("token") != token:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "passwordHash": 0})
    if not user or not user.get("isActive"):
        raise HTTPException(status_code=401, detail="User inactive")
    new_access = sign_access_token(user["id"], user["role"])
    new_refresh = sign_refresh_token(user["id"])
    await db.refresh_tokens.update_one(
        {"userId": user["id"]}, {"$set": {"token": new_refresh}}, upsert=True
    )
    set_auth_cookies(response, new_access, new_refresh)
    return {"ok": True, "accessToken": new_access}


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"], "name": user["name"], "email": user["email"],
        "role": user["role"], "isActive": user["isActive"], "createdAt": user["createdAt"],
    }

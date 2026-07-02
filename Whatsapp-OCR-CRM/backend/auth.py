"""JWT authentication using httpOnly cookies."""
import os
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import Request, HTTPException, Depends
from passlib.context import CryptContext

from database import db

JWT_SECRET = os.environ['JWT_SECRET']
JWT_REFRESH_SECRET = os.environ['JWT_REFRESH_SECRET']
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=7)

# bcrypt for passwords
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_ctx.verify(password, hashed)


def sign_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + ACCESS_TTL).timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def sign_refresh_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + REFRESH_TTL).timestamp()),
        "type": "refresh",
        "jti": os.urandom(8).hex(),
    }
    return jwt.encode(payload, JWT_REFRESH_SECRET, algorithm="HS256")


def verify_access(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def verify_refresh(token: str) -> dict:
    return jwt.decode(token, JWT_REFRESH_SECRET, algorithms=["HS256"])


def set_auth_cookies(response, access: str, refresh: str):
    # httpOnly, SameSite=None for cross-site (frontend on different domain in preview)
    common = dict(httponly=True, secure=True, samesite="none", path="/")
    response.set_cookie("access_token", access, max_age=int(ACCESS_TTL.total_seconds()), **common)
    response.set_cookie("refresh_token", refresh, max_age=int(REFRESH_TTL.total_seconds()), **common)


def clear_auth_cookies(response):
    common = dict(path="/", samesite="none", secure=True)
    response.delete_cookie("access_token", **common)
    response.delete_cookie("refresh_token", **common)


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency. Returns the user dict {id, email, name, role}. Raises 401 if invalid."""
    # Prefer cookie; fallback to Authorization: Bearer (helps testing)
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = verify_access(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "passwordHash": 0})
    if not user or not user.get("isActive"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_role(role: str):
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") != role:
            raise HTTPException(status_code=403, detail=f"Requires {role} role")
        return user

    return _checker

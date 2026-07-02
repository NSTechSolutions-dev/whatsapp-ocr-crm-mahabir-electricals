"""Local file storage with presigned-like URL via signed token.

In production this would be S3. Here we store files under uploads/ and serve them via
/api/files/{key}?sig=... where sig is an HMAC-SHA256 of key + expiry.
"""
import os
import hmac
import hashlib
import time
from pathlib import Path

ROOT = Path(__file__).parent / "uploads"
ROOT.mkdir(exist_ok=True)
_SIG_SECRET = os.environ.get("JWT_SECRET", "fallback-storage-secret")


def save_bytes(key: str, data: bytes) -> str:
    """Save bytes at uploads/<key>. Returns the storage key."""
    path = ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


def read_bytes(key: str) -> bytes:
    return (ROOT / key).read_bytes()


def exists(key: str) -> bool:
    return (ROOT / key).exists()


def presign_url(key: str, ttl_seconds: int = 3600, public_base: str = "") -> str:
    """Generate a signed URL token. Returns a path (no scheme/host) by default so the
    frontend can prepend its own REACT_APP_BACKEND_URL. Pass public_base to embed a host.
    """
    exp = int(time.time()) + ttl_seconds
    msg = f"{key}|{exp}".encode()
    sig = hmac.new(_SIG_SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return f"{public_base}/api/files/{key}?sig={sig}&exp={exp}"


def verify_signature(key: str, sig: str, exp: str) -> bool:
    try:
        exp_int = int(exp)
    except Exception:
        return False
    if exp_int < int(time.time()):
        return False
    msg = f"{key}|{exp_int}".encode()
    expected = hmac.new(_SIG_SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

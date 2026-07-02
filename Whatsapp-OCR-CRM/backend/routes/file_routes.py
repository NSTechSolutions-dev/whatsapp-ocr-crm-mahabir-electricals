"""File serving with signed URL verification."""
import mimetypes
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from storage import read_bytes, exists, verify_signature

router = APIRouter(tags=["files"])


@router.get("/files/{path:path}")
async def serve_file(path: str, request: Request):
    sig = request.query_params.get("sig")
    exp = request.query_params.get("exp")
    if not sig or not exp or not verify_signature(path, sig, exp):
        raise HTTPException(status_code=403, detail="Invalid or expired signature")
    if not exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    data = read_bytes(path)
    content_type, _ = mimetypes.guess_type(path)
    return Response(content=data, media_type=content_type or "application/octet-stream")

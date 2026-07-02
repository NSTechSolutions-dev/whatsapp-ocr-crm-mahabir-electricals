"""OCR pipeline routes: upload, poll result.

Flow:
1. POST /api/ocr/process  ← multipart image upload OR { mediaUrl }
2. Server stores image, kicks off background task that runs OCR + Gemini extraction
3. GET /api/ocr/{jobId} polls until status == 'done' with rows
"""
import os
import asyncio
import logging
import uuid
import base64
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, BackgroundTasks
from pydantic import BaseModel

from auth import get_current_user
from database import db
from storage import save_bytes
from services.gemini import extract_from_image

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ocr", tags=["ocr"])

# In-memory job store (fine for single-process preview)
_JOBS: Dict[str, Dict[str, Any]] = {}


def _detect_mime(filename: Optional[str], image_bytes: bytes) -> str:
    """Return a Gemini-acceptable mime: image/jpeg | image/png | image/webp."""
    # Magic bytes
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    # Fallback to extension hint
    ext = (filename or "").lower().rsplit(".", 1)[-1]
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    if ext == "webp":
        return "image/webp"
    return "image/png"


async def _process_image(job_id: str, image_bytes: bytes, mime_type: str):
    try:
        # Step: AI extraction (vision OCR + structuring + catalogue matching in one call)
        _JOBS[job_id]["step"] = "ocr"
        catalogue = await db.inventory.find({}, {"_id": 0}).to_list(2000)

        _JOBS[job_id]["step"] = "ai_structuring"
        try:
            rows = await extract_from_image(
                image_bytes=image_bytes, mime_type=mime_type,
                catalogue=catalogue, session_id=job_id,
            )
        except Exception as ex:
            log.exception("Gemini extraction failed: %s", ex)
            _JOBS[job_id]["status"] = "failed"
            _JOBS[job_id]["error"] = f"AI extraction failed: {ex}"
            return

        if not rows:
            _JOBS[job_id]["status"] = "failed"
            _JOBS[job_id]["error"] = (
                "Gemini returned no rows. The slip may be unreadable, or the EMERGENT_LLM_KEY balance is exhausted."
            )
            return

        _JOBS[job_id]["step"] = "matching"
        # All matching info is already inline from Gemini; just expose it.
        _JOBS[job_id]["status"] = "done"
        _JOBS[job_id]["step"] = "done"
        _JOBS[job_id]["rows"] = rows
    except Exception as e:
        log.exception("OCR job failed: %s", e)
        _JOBS[job_id]["status"] = "failed"
        _JOBS[job_id]["error"] = str(e)


class OcrProcessJsonIn(BaseModel):
    imageDataUrl: Optional[str] = None
    conversationId: Optional[str] = None


@router.post("/process")
async def process_ocr(
    background: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    conversationId: Optional[str] = Form(default=None),
    user: dict = Depends(get_current_user),
):
    if not file:
        raise HTTPException(status_code=400, detail="Image file is required (form field 'file')")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    mime = _detect_mime(file.filename, contents)
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Only PNG / JPEG / WEBP are supported")

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
    key = f"uploads/ocr/{day}/{uuid.uuid4().hex}.{ext}"
    save_bytes(key, contents)

    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "processing", "step": "queued", "s3Key": key, "mime": mime,
        "conversationId": conversationId, "createdAt": datetime.now(timezone.utc).isoformat(),
        "userId": user["id"],
    }
    background.add_task(_process_image, job_id, contents, mime)
    return {"jobId": job_id, "status": "processing"}


@router.post("/process-base64")
async def process_ocr_base64(payload: OcrProcessJsonIn, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Alternative endpoint accepting data URL JSON."""
    if not payload.imageDataUrl or not payload.imageDataUrl.startswith("data:"):
        raise HTTPException(status_code=400, detail="imageDataUrl required (data: URL)")
    try:
        header, b64 = payload.imageDataUrl.split(",", 1)
        contents = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid imageDataUrl")
    mime = _detect_mime(None, contents)
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Only PNG / JPEG / WEBP are supported")
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
    key = f"uploads/ocr/{day}/{uuid.uuid4().hex}.{ext}"
    save_bytes(key, contents)
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "processing", "step": "queued", "s3Key": key, "mime": mime,
        "conversationId": payload.conversationId, "createdAt": datetime.now(timezone.utc).isoformat(),
        "userId": user["id"],
    }
    background.add_task(_process_image, job_id, contents, mime)
    return {"jobId": job_id, "status": "processing"}


@router.get("/{job_id}")
async def get_ocr_result(job_id: str, user: dict = Depends(get_current_user)):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": job["status"],
        "step": job.get("step"),
        "rows": job.get("rows", []),
        "rawText": job.get("rawText"),
        "ocrConfidence": job.get("ocrConfidence"),
        "conversationId": job.get("conversationId"),
        "s3Key": job.get("s3Key"),
        "error": job.get("error"),
    }

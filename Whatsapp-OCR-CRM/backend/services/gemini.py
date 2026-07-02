"""Gemini wrapper.

Two operations:
  1) extract_products(raw_text, ...)        — kept for backward compat (text-only)
  2) extract_from_image(image_bytes, mime, catalog, ...)
     — REAL OCR + structuring + inventory matching in a single Gemini Vision call.
"""
import os
import json
import base64
import logging
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

log = logging.getLogger(__name__)


SYSTEM_TEXT = (
    "You are a data extraction assistant for an Indian office supply business. "
    "Parse the following handwritten enquiry OCR text into a JSON array. Rules: "
    '1) Each line is one product row. 2) Ditto marks (") mean repeat the product name from the line above. '
    "3) Normalize product names to canonical form (e.g. 'A4 Paper' -> 'A4 Copier Paper'). "
    "4) Extract qty as a number and unit separately. "
    "5) Set confidence 0.0-1.0 based on clarity. "
    "6) Return ONLY valid JSON, no markdown, no explanation. "
    'Format: [{"raw":"original line","product":"Name","qty":10,"unit":"Ream","confidence":0.92}]'
)

SYSTEM_VISION = (
    "You are an OCR + data-extraction assistant for Mahabir Electricals, an Indian electrical wholesale "
    "and retail business. You will receive a PHOTO of a handwritten product enquiry slip "
    "(or a clear text screenshot) and a CATALOGUE of inventory items the shop carries.\n\n"
    "Your job:\n"
    "1) Read every product row from the image. Do not be confused by line indices like '(1)', '1)', '1.', or '①' at the start of a line; strip these prefix numbers entirely and do NOT treat them as the product quantity.\n"
    "2) Ignore non-product lines completely: do NOT extract metadata, headers, titles, locations, addresses, dates, or contact details (such as 'Location', 'mob no', 'phone', or addresses) as product rows.\n"
    "3) Honor ditto marks (\") or lines repeating information — they repeat the product name from the previous line.\n"
    "4) Consolidate multi-line product descriptions: if a line contains only descriptors/properties (e.g., 'alag alag color' or 'blue ink') following a product line, append it to the previous product's description rather than creating a new product row.\n"
    "5) For each valid product row produce:\n"
    "   - rawText: the exact text read from the image for this item (including the consolidated description if multi-line)\n"
    "   - productName: the catalogue name if it clearly matches one (use canonical name from the catalogue), or your best canonical guess if not in the catalogue\n"
    "   - qty: the numeric quantity extracted (do NOT use line numbers or index numbers here; use the actual quantity from the line like '2 bandal' -> 2, '02 pes' -> 2, '5 ream' -> 5)\n"
    "   - unit: the unit of measurement (e.g., 'Bandal', 'Pcs', 'Ream', 'Box', etc.)\n"
    "   - confidence: 0.0 to 1.0 based on legibility\n"
    "   - inventoryId: the id from the catalogue if matched, else null\n"
    "   - matchType: 'exact' | 'alias' | 'fuzzy' | 'new'\n"
    "   - matchScore: 0.0 to 1.0\n\n"
    "6) Return ONLY a strict JSON array. No prose, no markdown fences.\n"
    'Schema: [{"rawText":"...","productName":"...","qty":5,"unit":"Ream","confidence":0.92,"inventoryId":"cxxx","matchType":"exact","matchScore":1.0}]'
)


def _strip_code_fences(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


def _parse_json_array(text: str) -> List[Dict[str, Any]]:
    text = _strip_code_fences(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            log.warning("Gemini returned non-JSON: %s", text[:200])
            return []
        try:
            data = json.loads(m.group(0))
        except Exception:
            return []
    return data if isinstance(data, list) else []


async def extract_products(raw_text: str, session_id: str) -> List[Dict[str, Any]]:
    """Text-only extraction (legacy)."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        log.warning("EMERGENT_LLM_KEY not set")
        return []
    chat = LlmChat(
        api_key=api_key, session_id=session_id, system_message=SYSTEM_TEXT,
    ).with_model("gemini", "gemini-2.5-flash")
    response = await chat.send_message(UserMessage(text=f"OCR text:\n\n{raw_text}\n\nReturn JSON array only."))
    text = response if isinstance(response, str) else getattr(response, "content", str(response))
    data = _parse_json_array(text)
    cleaned = []
    for row in data:
        if not isinstance(row, dict):
            continue
        cleaned.append({
            "raw": str(row.get("raw", "")),
            "product": str(row.get("product", "")).strip(),
            "qty": float(row.get("qty", 0) or 0),
            "unit": (str(row.get("unit") or "").strip() or None),
            "confidence": float(row.get("confidence", 0.8) or 0.8),
        })
    return cleaned


async def extract_from_image(
    *,
    image_bytes: bytes,
    mime_type: str,
    catalogue: List[Dict[str, Any]],
    session_id: str,
) -> List[Dict[str, Any]]:
    """Single Gemini Vision call: OCR + structuring + catalogue matching.

    `catalogue` is a list of {id, name, aliases, unit, currentRate, category}.
    Returns rows in the canonical UI shape used by the OCR worker.
    """
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        log.warning("EMERGENT_LLM_KEY not set")
        return []

    # Compact the catalogue for the prompt (truncate aliases to keep tokens reasonable)
    compact = [
        {
            "id": c["id"],
            "name": c["name"],
            "aliases": (c.get("aliases") or [])[:6],
            "unit": c.get("unit"),
        }
        for c in catalogue
    ]
    catalogue_json = json.dumps(compact, ensure_ascii=False)

    chat = LlmChat(
        api_key=api_key, session_id=session_id, system_message=SYSTEM_VISION,
    ).with_model("gemini", "gemini-2.5-flash")

    img = ImageContent(image_base64=base64.b64encode(image_bytes).decode("ascii"))
    user_text = (
        "CATALOGUE (json array of inventory items the shop carries):\n"
        + catalogue_json
        + "\n\nRead the attached enquiry slip image and return the JSON array as instructed."
    )

    # Log the inputs for debugging and system optimization
    logs_dir = Path(__file__).parent.parent / "logs"
    logs_dir.mkdir(exist_ok=True)
    io_log_file = logs_dir / "gemini_io.log"
    
    try:
        with open(io_log_file, "a", encoding="utf-8") as f:
            f.write(f"\n=== GEMINI VISION CALL {datetime.now().isoformat()} (Session: {session_id}) ===\n")
            f.write(f"IMAGE MIME: {mime_type}\n")
            f.write(f"CATALOGUE SIZE: {len(catalogue)} items\n")
            f.write(f"USER PROMPT:\n{user_text}\n")
            f.write("-" * 40 + "\n")
    except Exception as le:
        log.warning("Failed to write input log to %s: %s", io_log_file, le)

    try:
        response = await chat.send_message(UserMessage(text=user_text, file_contents=[img]))
    except Exception as e:
        log.exception("Gemini Vision call failed: %s", e)
        try:
            with open(io_log_file, "a", encoding="utf-8") as f:
                f.write(f"ERROR: {str(e)}\n")
        except Exception:
            pass
        raise

    text = response if isinstance(response, str) else getattr(response, "content", str(response))
    
    try:
        with open(io_log_file, "a", encoding="utf-8") as f:
            f.write(f"RAW RESPONSE:\n{text}\n")
            f.write("=" * 60 + "\n")
    except Exception as le:
        log.warning("Failed to write output log to %s: %s", io_log_file, le)

    data = _parse_json_array(text)

    # Map to the canonical OCR-worker row shape
    out: List[Dict[str, Any]] = []
    cat_by_id = {c["id"]: c for c in catalogue}
    for row in data:
        if not isinstance(row, dict):
            continue
        name = str(row.get("productName") or row.get("product") or "").strip()
        if not name:
            continue
        inv_id = row.get("inventoryId") or None
        match_type = row.get("matchType") or ("exact" if inv_id else "new")
        match_score = float(row.get("matchScore") or (1.0 if inv_id else 0.0))
        inv = cat_by_id.get(inv_id) if inv_id else None
        unit = (str(row.get("unit") or "").strip() or None)
        if inv and not unit:
            unit = inv.get("unit")
        rate = None
        if inv:
            rate = inv.get("currentRate")
        out.append({
            "raw": str(row.get("rawText") or row.get("raw") or ""),
            "product": name,
            "matchedName": inv["name"] if inv else name,
            "qty": float(row.get("qty", 0) or 0),
            "unit": unit,
            "confidence": float(row.get("confidence", 0.8) or 0.8),
            "inventoryId": inv["id"] if inv else None,
            "matchType": match_type,
            "matchScore": match_score,
            "rate": rate,
        })
    return out

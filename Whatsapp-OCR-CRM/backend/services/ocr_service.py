"""OCR service.

In production this would call Google Cloud Vision DOCUMENT_TEXT_DETECTION.
For Emergent preview we MOCK the OCR step: it returns a realistic handwritten
slip transcription. The downstream Gemini extraction is REAL.

The mock cycles through a few sample slips so users see variety.
"""
import hashlib
from typing import Tuple

# MOCKED sample handwritten slips that a small Indian stationery shop would receive
_SAMPLES = [
    """A4 paper - 5 ream
Blue pen - 2 dozen
"   - black, 1 dozen
Stapler small - 3 pcs
Pins box - 5
File folder - 10 pcs""",
    """Notebook 200 pg - 25 nos
Highlighter yellow - 12 pcs
"   - pink, 6 pcs
Sticky note 3x3 - 8 pads
Glue stick - 15 pcs""",
    """Legal size paper - 3 ream
A4 paper - 10 ream
WB marker - 6 pcs
Stapler no.10 - 4
Pins - 10 box""",
    """Black ball pen - 50 pcs
Blue ball pen - 50 pcs
A4 copier paper - 8 ream
File folder a4 - 25 nos
Sticky notes - 6 pad""",
]


async def run_ocr(image_bytes: bytes) -> Tuple[str, float]:
    """Returns (raw_text, average_word_confidence).

    MOCKED for now. The text returned is deterministic per image (hash-based)
    so the same upload always extracts the same products in tests.
    """
    h = int(hashlib.sha1(image_bytes).hexdigest(), 16)
    sample = _SAMPLES[h % len(_SAMPLES)]
    confidence = 0.78 + ((h % 20) / 100.0)  # 0.78..0.97
    return sample, round(confidence, 2)

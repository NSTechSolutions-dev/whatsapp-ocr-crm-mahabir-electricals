"""Quotation image rendering — matches the 'Buhay Development' reference layout.

Layout (1600x2000 PNG, 2x scale):
- Top: logo on left (placeholder triangle), company contact lines right-aligned (green)
- Centered title 'QUOTATION' (large, green)
- Two-column header block: left = Quotation No / Date / Valid Until / Customer ID,
  right = Customer name / company / address / phone
- Horizontal green divider
- 'PROJECT DESCRIPTION' section
- Items table: green header bar, alternating beige/white rows, columns:
  Description, Quantity, Price, Total
- Totals box bottom-right: Subtotal, Value-Added Tax, Others, Total (green highlight)
- Horizontal green divider
- 'TERMS & CONDITIONS' paragraph (left label, right body)
- 'PLEASE CONFIRM YOUR ACCEPTANCE OF THIS QUOTE' headline
- Signature lines: 'Signature over printed name' / 'Date signed'
"""
import os
from io import BytesIO
from typing import List, Dict
from PIL import Image, ImageDraw, ImageFont

# Render at 2x scale, downscale not needed - target final width ~1600px
WIDTH = 1600
PADDING = 96

BRAND = "#7F1D1D"        # Mahabir maroon
BRAND_DARK = "#991B1B"   # darker maroon
INK = "#1B1B1B"
MUTED = "#444444"
LINE = BRAND
ROW_ALT = "#F2F2F2"
ROW_WHITE = "#FFFFFF"


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates_bold = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    candidates_reg = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in (candidates_bold if bold else candidates_reg):
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _text_w(d: ImageDraw.ImageDraw, text: str, font) -> int:
    bbox = d.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _draw_right(d: ImageDraw.ImageDraw, x_right: int, y: int, text: str, font, fill):
    """Draw text right-aligned ending at x_right."""
    w = _text_w(d, text, font)
    d.text((x_right - w, y), text, fill=fill, font=font)


def _draw_center(d: ImageDraw.ImageDraw, cx: int, y: int, text: str, font, fill):
    w = _text_w(d, text, font)
    d.text((cx - w // 2, y), text, fill=fill, font=font)


def _draw_logo(d: ImageDraw.ImageDraw, x: int, y: int):
    """Simple house-roof logo placeholder (matches the style of the reference)."""
    # Two overlapping triangles in brand green
    d.polygon([(x + 10, y + 70), (x + 80, y + 10), (x + 150, y + 70)], fill=BRAND)
    d.polygon([(x + 50, y + 70), (x + 110, y + 25), (x + 170, y + 70)], fill=BRAND_DARK)


def render_quotation_png(
    *,
    number: str,
    date_str: str,
    valid_until: str = "",
    customer_id: str = "",
    customer_name: str,
    customer_company: str = "",
    customer_address: str = "",
    customer_phone: str,
    company_name: str,
    company_address: str,
    company_gstin: str,
    company_phone: str,
    company_website: str = "",
    project_description: str = "",
    items: List[Dict],  # name, qty, unit, rate, amount
    subtotal: float,
    gst_percent: float,
    gst_amount: float,
    others: float = 0.0,
    grand_total: float,
    currency_symbol: str = "Rs ",
) -> bytes:

    # Heights
    header_h = 220
    title_h = 180
    info_h = 240
    divider_pad = 40
    desc_h = 160 if project_description else 60
    table_header_h = 70
    row_h = 70
    table_h = table_header_h + max(1, len(items)) * row_h
    totals_h = 280
    terms_h = 260
    signature_h = 200
    bottom_pad = 80

    height = (
        header_h + title_h + info_h + divider_pad +
        desc_h + 20 + table_h + totals_h + divider_pad +
        terms_h + signature_h + bottom_pad
    )

    img = Image.new("RGB", (WIDTH, height), color="#FFFFFF")
    d = ImageDraw.Draw(img)

    # ---------- Header band ----------
    _draw_logo(d, PADDING, 50)
    # Company name under logo
    d.text((PADDING, 140), company_name.upper(), fill=BRAND_DARK, font=_font(22, bold=True))

    # Right-aligned company contact (green)
    right_x = WIDTH - PADDING
    d.text((PADDING, 0), "", fill=INK)  # noop anchor
    line1 = company_address.upper() if company_address else ""
    line2 = company_phone
    line3 = company_website.upper() if company_website else ""
    _draw_right(d, right_x, 70, line1, _font(22, bold=True), BRAND_DARK)
    _draw_right(d, right_x, 105, line2, _font(22, bold=True), BRAND_DARK)
    if line3:
        _draw_right(d, right_x, 140, line3, _font(22, bold=True), BRAND_DARK)

    # ---------- Title ----------
    title_y = header_h + 20
    _draw_center(d, WIDTH // 2, title_y, "QUOTATION", _font(96, bold=True), BRAND_DARK)

    # ---------- Info block ----------
    info_y = header_h + title_h
    label_font = _font(24, bold=True)
    value_font = _font(24)

    # Left column
    lx = PADDING
    rx_cust = WIDTH // 2 + 40

    def left_line(y, label, value):
        d.text((lx, y), label, fill=INK, font=label_font)
        lw = _text_w(d, label, label_font)
        d.text((lx + lw + 8, y), value, fill=INK, font=value_font)

    left_line(info_y + 0,  "Quotation No:", f" #{number}")
    left_line(info_y + 44, "Date:", f" {date_str}")
    left_line(info_y + 88, "Valid Until:", f" {valid_until or '—'}")
    left_line(info_y + 132,"Customer ID:", f" {customer_id or '—'}")

    # Right column (customer)
    d.text((rx_cust, info_y + 0), customer_name or "Customer", fill=INK, font=_font(26, bold=True))
    if customer_company:
        d.text((rx_cust, info_y + 44), customer_company, fill=INK, font=value_font)
    if customer_address:
        d.text((rx_cust, info_y + 88), customer_address, fill=INK, font=value_font)
    d.text((rx_cust, info_y + 132), customer_phone or "", fill=INK, font=value_font)

    # ---------- Divider ----------
    div_y = info_y + info_h
    d.rectangle([(PADDING, div_y), (WIDTH - PADDING, div_y + 5)], fill=BRAND)

    # ---------- Project description ----------
    desc_y = div_y + 40
    d.text((PADDING, desc_y), "PROJECT DESCRIPTION", fill=INK, font=_font(22, bold=True))
    if project_description:
        # wrap at ~58 chars
        words = project_description.split()
        lines, cur = [], ""
        for w in words:
            if len(cur) + len(w) + 1 > 58:
                lines.append(cur); cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)
        for i, ln in enumerate(lines[:3]):
            d.text((WIDTH // 2 - 100, desc_y + i * 36), ln, fill=INK, font=_font(22))

    # ---------- Items table ----------
    tbl_y = desc_y + desc_h + 20
    # Column boundaries
    col_x = [PADDING, PADDING + 720, PADDING + 980, PADDING + 1200, WIDTH - PADDING]
    # Header
    d.rectangle([(col_x[0], tbl_y), (col_x[-1], tbl_y + table_header_h)], fill=BRAND)
    header_labels = ["Description", "Quantity", "Price", "Total"]
    header_centers = [
        col_x[0] + 32, (col_x[1] + col_x[2]) // 2,
        (col_x[2] + col_x[3]) // 2, (col_x[3] + col_x[4]) // 2,
    ]
    hf = _font(26, bold=True)
    # Description is left-aligned, others centered
    d.text((col_x[0] + 32, tbl_y + 18), "Description", fill="#FFFFFF", font=hf)
    for i in range(1, 4):
        _draw_center(d, header_centers[i], tbl_y + 18, header_labels[i], hf, "#FFFFFF")

    # Body rows
    row_y = tbl_y + table_header_h
    body_font = _font(22)
    for i, it in enumerate(items):
        bg = ROW_WHITE if i % 2 == 0 else ROW_ALT
        d.rectangle([(col_x[0], row_y), (col_x[-1], row_y + row_h)], fill=bg)
        name = (it.get("name") or "")[:62]
        qty = it.get("qty", "")
        rate = float(it.get("rate") or 0)
        amount = float(it.get("amount") or 0)
        # Description (left)
        d.text((col_x[0] + 32, row_y + 22), name, fill=INK, font=body_font)
        # Qty (center)
        _draw_center(d, header_centers[1], row_y + 22, f"{qty:g}" if isinstance(qty, (int, float)) else str(qty), body_font, INK)
        # Price (center)
        _draw_center(d, header_centers[2], row_y + 22, f"{currency_symbol}{rate:,.2f}", body_font, INK)
        # Total (center)
        _draw_center(d, header_centers[3], row_y + 22, f"{currency_symbol}{amount:,.2f}", body_font, INK)
        row_y += row_h

    # ---------- Totals box ----------
    totals_top = row_y + 30
    val_x = WIDTH - PADDING
    label_x = WIDTH - PADDING - 480

    bold_22 = _font(22, bold=True)
    reg_22 = _font(22)
    d.text((label_x, totals_top + 0),  "Subtotal", fill=INK, font=bold_22)
    _draw_right(d, val_x, totals_top + 0, f"{currency_symbol}{subtotal:,.2f}", reg_22, INK)

    d.text((label_x, totals_top + 44), "Value-Added Tax", fill=INK, font=bold_22)
    _draw_right(d, val_x, totals_top + 44, f"{currency_symbol}{gst_amount:,.2f}", reg_22, INK)

    d.text((label_x, totals_top + 88), "Others", fill=INK, font=bold_22)
    _draw_right(d, val_x, totals_top + 88, f"{currency_symbol}{others:,.2f}", reg_22, INK)

    # Grand total — green band
    band_y = totals_top + 132
    d.text((label_x, band_y + 14), "Total", fill=INK, font=_font(26, bold=True))
    band_left = label_x + 200
    d.rectangle([(band_left, band_y), (val_x + 10, band_y + 56)], fill=BRAND)
    _draw_right(d, val_x - 16, band_y + 14, f"{currency_symbol}{grand_total:,.2f}", _font(28, bold=True), "#FFFFFF")

    # ---------- Bottom divider ----------
    bot_div = band_y + 100
    d.rectangle([(PADDING, bot_div), (WIDTH - PADDING, bot_div + 5)], fill=BRAND)

    # ---------- Terms & Conditions ----------
    terms_y = bot_div + 50
    d.text((PADDING, terms_y), "TERMS & CONDITIONS", fill=INK, font=_font(22, bold=True))
    body = (
        "Above information is not an invoice and only an estimate of goods/services. "
        "Payment will be due prior to provision or delivery of goods/services. "
        f"GSTIN: {company_gstin}." if company_gstin else
        "Above information is not an invoice and only an estimate of goods/services. "
        "Payment will be due prior to provision or delivery of goods/services."
    )
    # wrap right column body at ~62 chars
    words = body.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > 62:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    for i, ln in enumerate(lines[:4]):
        d.text((WIDTH // 2 - 100, terms_y + i * 36), ln, fill=INK, font=_font(22))

    # ---------- Acceptance + signatures ----------
    accept_y = terms_y + 200
    d.text((WIDTH // 2 - 100, accept_y), "PLEASE CONFIRM YOUR ACCEPTANCE OF THIS QUOTE",
           fill=INK, font=_font(22, bold=True))

    sig_y = accept_y + 100
    # Two underlines for signatures
    sig1_x1, sig1_x2 = WIDTH // 2 - 100, WIDTH // 2 + 300
    sig2_x1, sig2_x2 = WIDTH // 2 + 360, WIDTH - PADDING
    d.line([(sig1_x1, sig_y), (sig1_x2, sig_y)], fill=INK, width=2)
    d.line([(sig2_x1, sig_y), (sig2_x2, sig_y)], fill=INK, width=2)
    _draw_center(d, (sig1_x1 + sig1_x2) // 2, sig_y + 14, "Signature over printed name", _font(20), INK)
    _draw_center(d, (sig2_x1 + sig2_x2) // 2, sig_y + 14, "Date signed", _font(20), INK)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

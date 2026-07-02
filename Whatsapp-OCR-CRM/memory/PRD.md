# WhatsApp Enquiry Automation & CRM Platform — PRD

## Problem Statement (verbatim summary)
Full-stack WhatsApp Enquiry Automation & CRM Platform for an Indian stationery and office supply business. Captures product enquiries received on WhatsApp (text + handwritten slip photos), extracts product data via OCR + Gemini AI, matches against an inventory catalogue, lets staff edit/finalize, generates a professional quotation image, sends it back on WhatsApp, manages customers via CRM, and automates follow-up messages.

## Tech Choices (user-confirmed)
- **Stack**: Emergent platform default — React + FastAPI + MongoDB (not Next.js + Prisma + Postgres in the original prompt)
- **LLM**: Gemini 2.5 Flash via Emergent Universal LLM Key (model name `gemini-2.5-flash`)
- **MSG91 / Google Cloud Vision / AWS S3**: MOCKED with swap-ready service abstractions
- **Quotation rendering**: Pillow (PIL) — lightweight, no Puppeteer
- **Background queues**: asyncio loop (no Redis/BullMQ; same trigger types & DB-backed scheduled jobs)
- **Seed admin**: `admin@example.com / Admin@1234` ✅

## User Personas
- **Admin (shop owner)**: manages inventory, automation rules, users
- **Staff (counter)**: handles inbox, OCR scanning, enquiry editing, quotation send

## Core Requirements (static)
1. WhatsApp inbox: list conversations, view chat threads (text + images)
2. OCR + AI extraction pipeline for handwritten slips
3. Smart Enquiry Editor with inventory autocomplete, low-confidence highlighting, GST/total calculator
4. Quotation PNG generation + WhatsApp delivery
5. CRM customer list + profile timeline + top products
6. Inventory management with inline rate editing + rate history + price-drop automation
7. Automation rules: inactivity follow-up, price drop alert, repeat engagement, enquiry reminder
8. JWT auth (httpOnly cookies + Bearer fallback), Admin/Staff roles
9. Admin-only user management

## What's Implemented (2026-06-05)
- ✅ Auth (login/logout/refresh/me) with httpOnly cookies + accessToken fallback
- ✅ MSG91 webhook handler (real signature path + simulate-inbound for testing)
- ✅ Inbox list + conversation thread, real-time-ish via 5s polling
- ✅ OCR pipeline: image upload → mocked OCR → Gemini structured extraction → inventory matching (exact/alias/fuzzy via rapidfuzz)
- ✅ Smart Enquiry Editor: autocomplete, low-confidence amber bg, GST + grand total
- ✅ Quotation generator: PIL renders A4-style PNG, atomic monthly sequence (QT-YYYY-MM-NNNNN)
- ✅ WhatsApp send (MOCKED MSG91), delivery status logged
- ✅ CRM: customer list + detail (stats, timeline, top products)
- ✅ Inventory: list, search, inline rate edit, rate history, admin-only add product
- ✅ Automation: 4 trigger types, 3-step rule builder, asyncio background loop
- ✅ Settings: admin user management (create/toggle active)
- ✅ MOCKED APIs cleanly abstracted in `services/` — swap is a single-file change

## Prioritized Backlog (P1/P2 — for next iterations)
**P1**
- Real MSG91 wiring (HTTP POST + signature) — replace `services/whatsapp._send_to_msg91`
- Real Google Cloud Vision OCR — replace `services/ocr_service.run_ocr`
- Real S3 (boto3) — replace `services/storage.save_bytes/presign_url`
- WebSocket real-time inbox updates (replace 5s polling)
- Sticky "Create Enquiry" footer in conversation sidebar (testing-agent observation)

**P2**
- Bull Board–style admin queues panel
- Activity log viewer (UI for existing `activity_logs` collection)
- Loading skeleton components
- Multi-user permissions per inventory category
- PDF export option alongside PNG quotation

## Next Action Items
1. Wire real MSG91 (await keys from client)
2. Add Google Cloud Vision and S3 credentials
3. Real-time websockets for inbox

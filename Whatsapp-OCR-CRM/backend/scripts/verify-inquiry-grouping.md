# Inquiry grouping — manual verification

Run after `npx prisma migrate deploy` and restarting the backend (workers + poller).

## 1. Multi-page within 60s

1. Simulate 3 images from the same customer in inbox within 60 seconds.
2. Expect: one `WAITING` enquiry with `imageCount: 3`, then `PROCESSING`, then one `DRAFT` with merged items.
3. DB: one `Enquiry`, three `EnquiryImage` rows, one inventory-score job id `inventory-batch-{enquiryId}`.

## 2. Late page (new enquiry)

1. Send image 1, wait 70+ seconds.
2. Send image 2.
3. Expect: two separate enquiries (first → DRAFT/IGNORED, second → new WAITING batch).

## 3. Timer not extended

1. Note `processAt` on first image.
2. Send second image at +30s.
3. Expect: `processAt` unchanged; OCR still runs ~60s after first image.

## 4. Staff upload bypass

1. Upload via inbox OCR (staff path) `/api/ocr`.
2. Expect: immediate per-image pipeline, no `WAITING` enquiry.

## 5. Poller recovery

1. Stop backend before `processAt`, restart after expiry.
2. Expect: poller enqueues batch within 15s; enquiry moves to `PROCESSING` then `DRAFT`.

## 6. Concurrent webhooks

1. Fire two simulate-inbound image requests in parallel for same customer.
2. Expect: single `WAITING` enquiry with two images (Redis lock + unique `messageId`).

## 7. No products

1. Send non-inventory image(s).
2. Expect: single `IGNORED` enquiry after batch, not multiple DRAFTs.

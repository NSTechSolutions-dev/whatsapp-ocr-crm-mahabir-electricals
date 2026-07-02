# Automation Audit — Implementation Spec

> Mahabir Electricals CRM · Node + BullMQ + MSG91  
> Status: **Implemented** per this document

---

## 1. Design principles

| Principle | Decision |
|-----------|----------|
| Rule model | Exactly **5 fixed rule types** — no arbitrary “new rule” creation in UI |
| Configuration | All parameters **editable** per rule; toggle on/off per rule |
| Scheduling | **node-cron** (Asia/Kolkata) for daily rules; BullMQ delayed jobs for event-driven rules |
| Messaging | MSG91 WhatsApp templates (documented below) + text for stage-change discount |
| Tracking | `ScheduledJob` rows with `messageId`, `messageContent`, `metadata`, `errorMsg` |
| UI | List of 5 cards → click opens **detail page** with Executions + Conversations tabs |

---

## 2. Rule types & business logic

### 2.1 Inactivity follow-up (`inactivity_followup`)

| | |
|---|---|
| **Trigger** | Quotation sent via WhatsApp |
| **Schedule** | BullMQ delayed job (`days` after send) |
| **Params** | `days` (default 3), `templateName` |
| **Logic** | After N days, send template if no inbound reply since quotation `sentAt` |
| **Stages** | All except skip if customer replied |

### 2.2 Price drop alert (`price_drop_alert`)

| | |
|---|---|
| **Trigger** | Inventory rate decreased |
| **Params** | `threshold` (% min drop, 0 = any), `maxInquiryAgeDays` (default **30**), `templateName` |
| **Logic** | Notify customers who enquired about that SKU **only if** their **last enquiry is &lt; 30 days old** and stage ≠ Closed |
| **Threshold** | Enforced: `((old - new) / old) * 100 >= threshold` |

### 2.3 Repeat engagement (`repeat_engagement`)

| | |
|---|---|
| **Trigger** | **Daily cron** at user-configurable `scheduleTime` (default `09:00` IST) |
| **Params** | `inactiveDays` (default 30), `scheduleTime`, `stages` (default Lead/Contacted/Proposal/Negotiation), `templateName` |
| **Logic** | For customers in open pipeline stages, if last enquiry older than `inactiveDays`, send re-engagement template |
| **Dedup** | No repeat to same customer within `inactiveDays` |

### 2.4 Enquiry reminder (`enquiry_reminder`)

| | |
|---|---|
| **Trigger** | **Daily cron** at `scheduleTime` (default `09:00` IST) |
| **Params** | `daysSinceSent` (default 7), `scheduleTime`, `templateName` |
| **Logic** | Customer **not in Closed**. Last enquiry status **SENT** with quotation `sentAt`. No inbound reply after send. Remind after `daysSinceSent` |
| **Note** | Replaces old “DRAFT stale” behaviour |

### 2.5 Stage change (`stage_change`)

| | |
|---|---|
| **Trigger** | Customer CRM stage updated |
| **Params** | `stage` (e.g. Negotiation), `actionType`: `draft_discount_offer` |
| **Logic** | Send 10% discount text on top 2 priced items from latest enquiry |

---

## 3. Cron jobs

| Cron | Expression | Rules | Timezone |
|------|------------|-------|----------|
| Repeat engagement | `{minute} {hour} * * *` from rule `scheduleTime` | `repeat_engagement` | `Asia/Kolkata` |
| Enquiry reminder | `{minute} {hour} * * *` from rule `scheduleTime` | `enquiry_reminder` | `Asia/Kolkata` |

- Cron reschedules on server start and when rule `scheduleTime` / `isActive` changes.
- `lastExecutedAt` updated on each cron tick and job completion.

**File:** `backend/src/jobs/automation-cron.ts`

---

## 4. MSG91 template configuration

Register these templates in MSG91 WhatsApp dashboard (namespace per your account):

| Template name | Category | Body variables | Sample body |
|---------------|----------|----------------|-------------|
| `mahabir_inactivity_followup` | Utility | `{{1}}` name | Hi {{1}}, we sent your quotation a few days ago. Reply if you'd like to proceed or need changes. — Mahabir Electricals |
| `mahabir_price_drop` | Marketing | `{{1}}` name, `{{2}}` product, `{{3}}` old rate, `{{4}}` new rate | Hi {{1}}, good news! {{2}} price dropped from ₹{{3}} to ₹{{4}}. Order now — Mahabir Electricals |
| `mahabir_repeat_engagement` | Marketing | `{{1}}` name | Hi {{1}}, we miss you at Mahabir Electricals! Need wires, switches, or fittings? Reply with your list for a quick quote. |
| `mahabir_enquiry_reminder` | Utility | `{{1}}` name, `{{2}}` quote ref | Hi {{1}}, following up on quote {{2}}. Let us know if you'd like to confirm or revise. — Mahabir Electricals |

**Env:** `MSG91_AUTH_KEY`, `MSG91_INTEGRATED_NUMBER` (existing `.env`)

**Mock mode:** `MSG91_MOCK` unset or ≠ `0` logs sends without API call (dev default).

Stage-change discount uses **free text** (not a template).

---

## 5. Database changes

### `AutomationRule`
- `lastExecutedAt DateTime?` — last successful tick

### `ScheduledJob`
- `messageId String?` — links to `WhatsappMessage`
- `messageContent String?` — rendered message for UI
- `errorMsg String?` — failure reason
- `metadata Json?` — template name, variables, enquiryId, etc.
- `isTest Boolean` — already in migration

**Bootstrap:** `ensureAutomationRules()` upserts one row per `triggerType`.

---

## 6. API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/automation/rules` | List 5 rules (ordered, bootstrapped) |
| GET | `/api/automation/rules/:id` | Single rule |
| PUT | `/api/automation/rules/:id` | Update params + isActive (reschedules cron) |
| GET | `/api/automation/rules/:id/stats` | Summary counts |
| GET | `/api/automation/rules/:id/executions` | Paginated execution table |
| GET | `/api/automation/rules/:id/conversations` | Customers + messages from executions |
| POST | `/api/automation/run-now` | Manual tick (repeat + enquiry reminder) |

---

## 7. Frontend

### `/automation`
- 5 fixed cards (no “New rule”)
- Switch toggles `isActive`
- Click card → `/automation/[id]`

### `/automation/[id]`
- **Header:** rule name, toggle, editable parameters form, Save
- **Tab — Executions:** stat cards (total / completed / failed / last 7 days) + table
- **Tab — Conversations:** customers messaged, message text, timestamp per execution

---

## 8. Key files

| Area | Path |
|------|------|
| Rule defaults & templates | `backend/src/config/automation-rules.ts` |
| Bootstrap | `backend/src/services/automation-rules.bootstrap.ts` |
| Triggers | `backend/src/services/automation.service.ts` |
| Worker | `backend/src/jobs/automation.job.ts` |
| Cron | `backend/src/jobs/automation-cron.ts` |
| API | `backend/src/api/controllers/automation.controller.ts` |
| List UI | `frontend/app/(dashboard)/automation/page.tsx` |
| Detail UI | `frontend/app/(dashboard)/automation/[id]/page.tsx` |

---

## 9. Gaps closed (from prior audit)

- [x] Price drop gated by last enquiry age (30 days)
- [x] Repeat engagement daily cron + pipeline stage filter
- [x] Enquiry reminder based on last **sent** inquiry, excludes Closed
- [x] Inactivity follow-up payload fixed (phone + template)
- [x] Execution tracking with message content
- [x] Fixed 5-rule UI with editable params + history tabs
- [x] Price drop threshold enforced

---

## 10. Operations checklist

1. Run `npx prisma migrate dev` in `backend/`
2. Run `npm install` (adds `node-cron`)
3. Register MSG91 templates (section 4)
4. Set template names in each rule’s **Template name** field if using custom names
5. Restart backend to load cron schedules

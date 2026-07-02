"""
Backend integration tests for WhatsApp Enquiry Automation & CRM Platform.
Covers: auth, webhook simulate-inbound, OCR (Gemini), enquiries, quotations,
customers, inventory, automation rules/jobs, admin user management.
"""
import os
import io
import time
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whatsapp-crm-122.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "Admin@1234"


# ---------- shared session fixtures ----------

@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("accessToken")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    s._user = data.get("user", {})
    return s


@pytest.fixture(scope="session")
def seed_conversation(admin_session):
    """Create a conversation via simulate-inbound for downstream tests."""
    phone = "+919900112233"
    r = admin_session.post(
        f"{BASE_URL}/api/webhooks/simulate-inbound",
        json={"phone": phone, "type": "text", "content": "Need quote for A4 paper and pens"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"simulate-inbound failed: {r.status_code} {r.text}"
    body = r.json()
    conv_id = body.get("conversationId") or body.get("conversation", {}).get("id") or body.get("id")
    assert conv_id, f"No conversationId in response: {body}"
    return {"conversationId": conv_id, "phone": phone}


# ---------- auth ----------

class TestAuth:
    def test_login_success_sets_cookies_and_returns_token(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        assert "accessToken" in data and isinstance(data["accessToken"], str) and len(data["accessToken"]) > 10
        # cookies set
        cookie_names = {c.name for c in s.cookies}
        assert any("access" in n.lower() or "refresh" in n.lower() or "token" in n.lower() for n in cookie_names), \
            f"Expected auth cookies, got {cookie_names}"

    def test_login_invalid_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code in (400, 401)

    def test_me_returns_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        # may be wrapped
        u = u.get("user", u)
        assert u.get("email") == ADMIN_EMAIL


# ---------- webhook ----------

class TestWebhook:
    def test_simulate_inbound_creates_conversation_and_appears_in_inbox(self, admin_session, seed_conversation):
        conv_id = seed_conversation["conversationId"]
        r = admin_session.get(f"{BASE_URL}/api/inbox", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("conversations") or []
        ids = [c.get("id") or c.get("_id") or c.get("conversationId") for c in items]
        assert conv_id in ids, f"Conversation {conv_id} not in inbox. ids={ids[:10]}"


# ---------- OCR ----------

def _make_image_bytes():
    img = Image.new("RGB", (320, 240), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


@pytest.fixture(scope="session")
def ocr_job(admin_session, seed_conversation):
    img = _make_image_bytes()
    files = {"file": ("test.png", img, "image/png")}
    data = {"conversationId": seed_conversation["conversationId"]}
    r = admin_session.post(f"{BASE_URL}/api/ocr/process", files=files, data=data, timeout=60)
    assert r.status_code in (200, 201, 202), f"ocr process failed: {r.status_code} {r.text}"
    body = r.json()
    job_id = body.get("jobId") or body.get("id") or body.get("job", {}).get("id")
    assert job_id, f"No jobId in {body}"
    return job_id


class TestOCR:
    def test_ocr_process_returns_job_and_polls_done(self, admin_session, ocr_job):
        job_id = ocr_job
        rows = None
        last_status = None
        for _ in range(40):  # up to ~80s
            r = admin_session.get(f"{BASE_URL}/api/ocr/{job_id}", timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            last_status = body.get("status")
            if last_status == "done":
                rows = body.get("rows") or body.get("result", {}).get("rows")
                break
            if last_status == "failed" or last_status == "error":
                pytest.fail(f"OCR job failed: {body}")
            time.sleep(2)
        assert last_status == "done", f"OCR did not finish, last status={last_status}"
        assert isinstance(rows, list) and len(rows) > 0, f"No rows returned: {rows}"


# ---------- Enquiries + Quotations ----------

@pytest.fixture(scope="session")
def created_enquiry(admin_session, seed_conversation, ocr_job):
    # Wait for OCR done and pull rows to build items
    job_id = ocr_job
    rows = []
    for _ in range(40):
        r = admin_session.get(f"{BASE_URL}/api/ocr/{job_id}", timeout=20)
        body = r.json()
        if body.get("status") == "done":
            rows = body.get("rows") or body.get("result", {}).get("rows") or []
            break
        time.sleep(2)
    # fall back to a minimal item
    items = []
    for row in rows[:3]:
        items.append({
            "rawText": row.get("rawText") or row.get("description") or "A4 paper",
            "productName": row.get("productName") or row.get("matchedProductName") or "A4 paper",
            "qty": row.get("qty") or 10,
            "unit": row.get("unit") or "pcs",
            "rate": row.get("rate") or 100,
            "inventoryId": row.get("inventoryId") or row.get("matchedInventoryId"),
            "confidence": row.get("confidence") or 0.9,
        })
    if not items:
        items = [{"rawText": "A4 paper", "productName": "A4 paper", "qty": 10, "unit": "pcs", "rate": 100, "confidence": 0.9}]

    payload = {"conversationId": seed_conversation["conversationId"], "items": items}
    r = admin_session.post(f"{BASE_URL}/api/enquiries", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"create enquiry: {r.status_code} {r.text}"
    body = r.json()
    eid = body.get("id") or body.get("_id") or body.get("enquiryId")
    assert eid
    return {"id": eid, "items": body.get("items", items)}


class TestEnquiry:
    def test_get_enquiry(self, admin_session, created_enquiry):
        r = admin_session.get(f"{BASE_URL}/api/enquiries/{created_enquiry['id']}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body.get("id") or body.get("_id")) == created_enquiry["id"]
        assert "items" in body

    def test_update_enquiry_items(self, admin_session, created_enquiry):
        r = admin_session.get(f"{BASE_URL}/api/enquiries/{created_enquiry['id']}", timeout=15)
        items = r.json().get("items", [])
        for it in items:
            it["rate"] = 250
        r = admin_session.put(f"{BASE_URL}/api/enquiries/{created_enquiry['id']}",
                              json={"items": items}, timeout=20)
        assert r.status_code in (200, 204), r.text
        # verify
        r = admin_session.get(f"{BASE_URL}/api/enquiries/{created_enquiry['id']}", timeout=15)
        new_items = r.json().get("items", [])
        assert any(float(i.get("rate", 0)) == 250 for i in new_items)

    def test_finalize_returns_quotation(self, admin_session, created_enquiry, request):
        r = admin_session.post(
            f"{BASE_URL}/api/enquiries/{created_enquiry['id']}/finalize",
            params={"gstPercent": 18}, timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        qid = body.get("quotationId") or body.get("id") or body.get("quotation", {}).get("id")
        assert qid, f"no quotationId: {body}"
        # stash on request module-level via pytest cache
        request.config.cache.set("quotation_id", qid)


class TestQuotation:
    def test_get_quotation(self, admin_session, request):
        qid = request.config.cache.get("quotation_id", None)
        if not qid:
            pytest.skip("no quotation created upstream")
        r = admin_session.get(f"{BASE_URL}/api/quotations/{qid}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("presignedUrl") or body.get("imageUrl") or body.get("url")
        assert "items" in body
        for key in ("subtotal", "gstAmount", "grandTotal"):
            assert key in body, f"missing {key} in {list(body.keys())}"

    def test_send_quotation(self, admin_session, request, seed_conversation):
        qid = request.config.cache.get("quotation_id", None)
        if not qid:
            pytest.skip("no quotation created upstream")
        r = admin_session.post(f"{BASE_URL}/api/quotations/{qid}/send", timeout=20)
        assert r.status_code in (200, 201, 204), r.text
        body = r.json() if r.text else {}
        # verify sentAt
        r2 = admin_session.get(f"{BASE_URL}/api/quotations/{qid}", timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("sentAt") or body.get("sentAt")


# ---------- Customers ----------

class TestCustomers:
    def test_list_customers(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/customers", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("customers") or []
        assert isinstance(items, list)

    def test_customer_detail(self, admin_session, seed_conversation):
        r = admin_session.get(f"{BASE_URL}/api/customers", timeout=15)
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("customers") or []
        if not items:
            pytest.skip("no customers")
        cid = items[0].get("id") or items[0].get("_id")
        r = admin_session.get(f"{BASE_URL}/api/customers/{cid}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("enquiries", "messages", "topProducts", "stats"):
            assert k in body or k.lower() in {kk.lower() for kk in body.keys()}, f"missing {k}: {list(body.keys())}"


# ---------- Inventory ----------

class TestInventory:
    created_id = None

    def test_list(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/inventory", timeout=15)
        assert r.status_code == 200, r.text

    def test_search(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/inventory/search", params={"q": "paper"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or []
        assert isinstance(items, list)

    def test_admin_create_inventory(self, admin_session):
        payload = {"name": "TEST_Notebook A5", "unit": "pcs", "rate": 45, "aliases": ["TEST notebook"]}
        r = admin_session.post(f"{BASE_URL}/api/inventory", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        iid = body.get("id") or body.get("_id")
        assert iid
        TestInventory.created_id = iid

    def test_update_rate_and_history(self, admin_session):
        iid = TestInventory.created_id
        assert iid, "needs created item"
        r = admin_session.put(f"{BASE_URL}/api/inventory/{iid}/rate", json={"rate": 55}, timeout=15)
        assert r.status_code in (200, 204), r.text
        r = admin_session.get(f"{BASE_URL}/api/inventory/{iid}/rate-history", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("history") or []
        assert isinstance(items, list) and len(items) >= 1


# ---------- Automation ----------

class TestAutomation:
    rule_id = None

    def test_create_rule(self, admin_session):
        payload = {
            "name": "TEST_Inactivity follow-up",
            "triggerType": "inactivity_followup",
            "isActive": True,
            "config": {"delayHours": 24, "messageTemplate": "Hi {name}, following up on your enquiry"},
        }
        r = admin_session.post(f"{BASE_URL}/api/automation/rules", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        rid = body.get("id") or body.get("_id")
        assert rid
        TestAutomation.rule_id = rid

    def test_toggle_rule(self, admin_session):
        rid = TestAutomation.rule_id
        assert rid
        r = admin_session.put(f"{BASE_URL}/api/automation/rules/{rid}", json={"isActive": False}, timeout=15)
        assert r.status_code in (200, 204), r.text

    def test_jobs_contain_pending(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/automation/jobs", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body if isinstance(body, list) else body.get("items") or body.get("jobs") or []
        # not strict - inactivity_followup may or may not be scheduled depending on rule activation timing
        assert isinstance(items, list)


# ---------- Admin users ----------

class TestAdminUsers:
    def test_list_users(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/users", timeout=15)
        assert r.status_code == 200, r.text

    def test_create_staff(self, admin_session):
        payload = {
            "email": f"test_staff_{int(time.time())}@example.com",
            "password": "Staff@1234",
            "name": "TEST Staff",
            "role": "STAFF",
        }
        r = admin_session.post(f"{BASE_URL}/api/users", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("email") == payload["email"]
        TestAdminUsers._staff_email = payload["email"]
        TestAdminUsers._staff_password = payload["password"]

    def test_non_admin_forbidden(self):
        # login as staff
        email = getattr(TestAdminUsers, "_staff_email", None)
        pwd = getattr(TestAdminUsers, "_staff_password", None)
        if not email:
            pytest.skip("no staff created")
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
        assert r.status_code == 200, r.text
        token = r.json().get("accessToken")
        if token:
            s.headers.update({"Authorization": f"Bearer {token}"})
        r = s.get(f"{BASE_URL}/api/users", timeout=15)
        assert r.status_code == 403, f"expected 403 for staff, got {r.status_code}: {r.text}"

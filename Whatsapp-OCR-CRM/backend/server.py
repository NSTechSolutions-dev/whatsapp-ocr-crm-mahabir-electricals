"""WhatsApp Enquiry Automation & CRM — FastAPI server."""
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import asyncio
import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Configure logging early
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("server")

# Imports that read env vars must come AFTER load_dotenv
from database import client, ensure_indexes  # noqa: E402
from seed import seed  # noqa: E402
from services.automation_service import automation_loop  # noqa: E402

from routes.auth_routes import router as auth_router  # noqa: E402
from routes.inbox_routes import router as inbox_router  # noqa: E402
from routes.webhook_routes import router as webhook_router  # noqa: E402
from routes.ocr_routes import router as ocr_router  # noqa: E402
from routes.enquiry_routes import router as enquiry_router  # noqa: E402
from routes.quotation_routes import router as quotation_router  # noqa: E402
from routes.inventory_routes import router as inventory_router  # noqa: E402
from routes.customer_routes import router as customer_router  # noqa: E402
from routes.automation_routes import router as automation_router  # noqa: E402
from routes.user_routes import router as user_router  # noqa: E402
from routes.file_routes import router as file_router  # noqa: E402

app = FastAPI(title="Mahabir Electricals CRM")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_origin_regex=".*",  # preview environment
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"service": "whatsapp-crm", "status": "ok"}


api.include_router(auth_router)
api.include_router(inbox_router)
api.include_router(ocr_router)
api.include_router(enquiry_router)
api.include_router(quotation_router)
api.include_router(inventory_router)
api.include_router(customer_router)
api.include_router(automation_router)
api.include_router(user_router)
api.include_router(file_router)

app.include_router(api)
# Webhooks are mounted at root (no /api prefix is required for incoming third-party calls,
# but k8s ingress only forwards /api/* to backend in this environment) -> mount under /api/webhooks
app.include_router(webhook_router, prefix="/api")


@app.on_event("startup")
async def on_startup():
    try:
        await ensure_indexes()
    except Exception as e:
        log.exception("ensure_indexes failed: %s", e)
    try:
        await seed()
    except Exception as e:
        log.exception("seed failed: %s", e)
    # background automation loop
    asyncio.create_task(automation_loop())
    log.info("startup complete")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()

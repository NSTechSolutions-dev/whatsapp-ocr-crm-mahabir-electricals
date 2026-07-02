import { Router } from "express";
import { msg91Webhook, simulateInbound } from "../controllers/webhook.controller";

const router = Router();

// MSG91 webhook mounted at /webhooks/msg91
router.post("/msg91", msg91Webhook);
router.post("/simulate-inbound", simulateInbound);

export default router;

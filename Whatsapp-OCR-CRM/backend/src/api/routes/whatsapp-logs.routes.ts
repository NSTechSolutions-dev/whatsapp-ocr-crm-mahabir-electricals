import { Router } from "express";
import { listWhatsappDeliveryLogs } from "../controllers/whatsapp-logs.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listWhatsappDeliveryLogs);

export default router;

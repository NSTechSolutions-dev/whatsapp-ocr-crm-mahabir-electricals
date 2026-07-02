import { Router } from "express";
import { listConversations, getConversation } from "../controllers/inbox.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listConversations);
router.get("/:conversationId", authenticate, getConversation);

export default router;

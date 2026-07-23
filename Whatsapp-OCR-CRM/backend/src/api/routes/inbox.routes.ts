import { Router } from "express";
import { listConversations, getConversation, sendConversationMessage } from "../controllers/inbox.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listConversations);
router.get("/:conversationId", authenticate, getConversation);
router.post("/:conversationId/messages", authenticate, sendConversationMessage);

export default router;

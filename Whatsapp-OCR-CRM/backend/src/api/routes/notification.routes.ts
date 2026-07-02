import { Router } from "express";
import { listNotifications, markAsRead, readAll } from "../controllers/notification.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listNotifications);
router.post("/read-all", authenticate, readAll);
router.post("/:id/read", authenticate, markAsRead);

export default router;

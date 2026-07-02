import { Router } from "express";
import { learningStats } from "../controllers/learning.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/stats", authenticate, requireRole("ADMIN"), learningStats);

export default router;

import { Router } from "express";
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  listScheduledJobs,
  runNow,
  getRuleStats,
  getRuleExecutions,
  getRuleConversations,
  getAutomationMeta,
  devTestRule,
  devTestAllRules,
} from "../controllers/automation.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/meta", authenticate, getAutomationMeta);
router.get("/rules", authenticate, listRules);
router.get("/rules/:id", authenticate, getRule);
router.get("/rules/:id/stats", authenticate, getRuleStats);
router.get("/rules/:id/executions", authenticate, getRuleExecutions);
router.get("/rules/:id/conversations", authenticate, getRuleConversations);
router.post("/rules", authenticate, createRule);
router.put("/rules/:id", authenticate, updateRule);
router.delete("/rules/:id", authenticate, requireRole("ADMIN"), deleteRule);
router.get("/jobs", authenticate, listScheduledJobs);
router.post("/run-now", authenticate, runNow);
router.post("/dev/test/:triggerType", authenticate, devTestRule);
router.post("/dev/test-all", authenticate, devTestAllRules);

export default router;

import { Router } from "express";
import {
  listInventory,
  search,
  vectorSearch,
  createItem,
  updateItem,
  updateRate,
  rateHistory,
  deleteItem,
  clearInventory,
} from "../controllers/inventory.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listInventory);
router.get("/search", authenticate, search);
router.get("/vector-search", authenticate, vectorSearch);
router.post("/", authenticate, requireRole("ADMIN"), createItem);
router.delete("/", authenticate, requireRole("ADMIN"), clearInventory);
router.put("/:id", authenticate, requireRole("ADMIN"), updateItem);
router.delete("/:id", authenticate, requireRole("ADMIN"), deleteItem);
router.put("/:id/rate", authenticate, updateRate);
router.get("/:id/rate-history", authenticate, rateHistory);

export default router;

import { Router } from "express";
import {
  getQuotation,
  sendQuotation,
  regenerateQuotation,
  exportQuotationsTally,
} from "../controllers/quotation.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/tally-export", authenticate, exportQuotationsTally);
router.get("/:id", authenticate, getQuotation);
router.post("/:id/regenerate", authenticate, regenerateQuotation);
router.post("/:id/send", authenticate, sendQuotation);

export default router;

import { Router } from "express";
import { getQuotation, sendQuotation } from "../controllers/quotation.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/:id", authenticate, getQuotation);
router.post("/:id/send", authenticate, sendQuotation);

export default router;

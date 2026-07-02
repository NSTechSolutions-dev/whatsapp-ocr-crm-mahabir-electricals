import { Router } from "express";
import { createEnquiry, listEnquiries, getEnquiry, updateEnquiry, finalizeEnquiry, reparseSourceData } from "../controllers/enquiry.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/", authenticate, createEnquiry);
router.get("/", authenticate, listEnquiries);
router.get("/:id", authenticate, getEnquiry);
router.put("/:id", authenticate, updateEnquiry);
router.post("/:id/finalize", authenticate, finalizeEnquiry);
router.post("/:id/reparse", authenticate, reparseSourceData);

export default router;

import { Router } from "express";
import multer from "multer";
import {
  getCompanySettings,
  updateCompanySettings,
  uploadPaymentQr,
} from "../controllers/settings.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get("/company", authenticate, getCompanySettings);
router.put("/company", authenticate, requireRole("ADMIN"), updateCompanySettings);
router.post(
  "/company/qr",
  authenticate,
  requireRole("ADMIN"),
  upload.single("file"),
  uploadPaymentQr
);

export default router;

import { Router } from "express";
import multer from "multer";
import {
  getCompanySettings,
  updateCompanySettings,
  uploadPaymentQr,
  listBrandLogos,
  uploadBrandLogo,
  deleteBrandLogo,
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

router.get("/brand-logos", authenticate, listBrandLogos);
router.post(
  "/brand-logos",
  authenticate,
  requireRole("ADMIN"),
  upload.single("file"),
  uploadBrandLogo
);
router.delete("/brand-logos/:id", authenticate, requireRole("ADMIN"), deleteBrandLogo);

export default router;

import { Router } from "express";
import multer from "multer";
import {
  listGalleries,
  getGallery,
  createGallery,
  updateGallery,
  uploadGalleryImage,
  deleteGalleryImage,
  deleteGallery,
  sendGalleryToCustomer,
} from "../controllers/gallery.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/", authenticate, listGalleries);
router.get("/:id", authenticate, getGallery);
router.post("/", authenticate, requireRole("ADMIN"), createGallery);
router.put("/:id", authenticate, requireRole("ADMIN"), updateGallery);
router.post("/:id/images", authenticate, requireRole("ADMIN"), upload.single("file"), uploadGalleryImage);
router.delete("/:id/images/:imageId", authenticate, requireRole("ADMIN"), deleteGalleryImage);
router.delete("/:id", authenticate, requireRole("ADMIN"), deleteGallery);
router.post("/:id/send", authenticate, sendGalleryToCustomer);

export default router;

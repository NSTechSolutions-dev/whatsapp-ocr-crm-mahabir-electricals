import { Router } from "express";
import multer from "multer";
import { processOcr, processOcrBase64, getOcrResult, listActiveJobs, retryOcrJob, cancelActiveJobs } from "../controllers/ocr.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/process", authenticate, upload.single("file"), processOcr);
router.post("/process-base64", authenticate, processOcrBase64);
router.get("/active-jobs/list", authenticate, listActiveJobs);
router.post("/active-jobs/cancel", authenticate, cancelActiveJobs);
router.post("/:jobId/retry", authenticate, retryOcrJob);
router.get("/:jobId", authenticate, getOcrResult);

export default router;

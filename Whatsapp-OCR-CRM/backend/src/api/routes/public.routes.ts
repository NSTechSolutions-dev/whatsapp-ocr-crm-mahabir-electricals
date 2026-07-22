import { Router } from "express";
import { downloadQuotationPdf, downloadQuotationTally } from "../controllers/public-quotation.controller";
import { downloadGalleryPdf } from "../controllers/public-gallery.controller";

const router = Router();

router.get("/quotations/:id/pdf", downloadQuotationPdf);
router.get("/quotations/:id/tally", downloadQuotationTally);
router.get("/galleries/:id/pdf", downloadGalleryPdf);

export default router;

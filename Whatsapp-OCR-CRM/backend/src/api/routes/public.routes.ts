import { Router } from "express";
import { downloadQuotationPdf, downloadQuotationTally } from "../controllers/public-quotation.controller";

const router = Router();

router.get("/quotations/:id/pdf", downloadQuotationPdf);
router.get("/quotations/:id/tally", downloadQuotationTally);

export default router;

import { Router } from "express";
import { downloadQuotationPdf } from "../controllers/public-quotation.controller";

const router = Router();

router.get("/quotations/:id/pdf", downloadQuotationPdf);

export default router;

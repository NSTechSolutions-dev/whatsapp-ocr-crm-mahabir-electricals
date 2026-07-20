import { Router } from "express";
import {
  listQuotationTemplates,
  getQuotationTemplate,
  createQuotationTemplate,
  createTemplateFromEnquiry,
  updateQuotationTemplate,
  deleteQuotationTemplate,
  sendQuotationTemplate,
} from "../controllers/quotation-template.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listQuotationTemplates);
router.post("/", authenticate, createQuotationTemplate);
router.post("/from-enquiry/:enquiryId", authenticate, createTemplateFromEnquiry);
router.get("/:id", authenticate, getQuotationTemplate);
router.put("/:id", authenticate, updateQuotationTemplate);
router.delete("/:id", authenticate, deleteQuotationTemplate);
router.post("/:id/send", authenticate, sendQuotationTemplate);

export default router;

import { Router } from "express";
import { listCustomers, getCustomer, updateCustomerStage, hideCustomerFromPipeline } from "../controllers/customer.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listCustomers);
router.get("/:id", authenticate, getCustomer);
router.put("/:id/stage", authenticate, updateCustomerStage);
router.delete("/:id/pipeline", authenticate, hideCustomerFromPipeline);

export default router;

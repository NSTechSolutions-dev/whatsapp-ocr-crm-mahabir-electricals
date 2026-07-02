import { Router } from "express";
import { listCustomers, getCustomer, updateCustomerStage } from "../controllers/customer.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listCustomers);
router.get("/:id", authenticate, getCustomer);
router.put("/:id/stage", authenticate, updateCustomerStage);

export default router;

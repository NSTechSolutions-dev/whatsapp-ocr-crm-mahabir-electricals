import { Router } from "express";
import {
  listCustomers,
  getCustomer,
  updateCustomer,
  updateCustomerStage,
  updateCustomerDnd,
  hideCustomerFromPipeline,
} from "../controllers/customer.controller";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, listCustomers);
router.get("/:id", authenticate, getCustomer);
router.patch("/:id", authenticate, updateCustomer);
router.put("/:id/stage", authenticate, updateCustomerStage);
router.patch("/:id/dnd", authenticate, updateCustomerDnd);
router.delete("/:id/pipeline", authenticate, hideCustomerFromPipeline);

export default router;

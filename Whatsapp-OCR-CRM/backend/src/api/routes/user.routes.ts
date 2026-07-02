import { Router } from "express";
import { listUsers, createUser, updateUser } from "../controllers/user.controller";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/", authenticate, requireRole("ADMIN"), listUsers);
router.post("/", authenticate, requireRole("ADMIN"), createUser);
router.put("/:id", authenticate, requireRole("ADMIN"), updateUser);

export default router;

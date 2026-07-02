import { Router } from "express";
import { login, logout, refresh, me } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth";
import rateLimit from "express-rate-limit";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { detail: "Too many login attempts. Please try again later." },
});

router.post("/login", authLimiter, login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.get("/me", authenticate, me);

export default router;

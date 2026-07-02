import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefresh,
  setAuthCookies,
  clearAuthCookies,
} from "../middlewares/auth";
import { logger } from "../../utils/logger";

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ detail: "Email and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ detail: "Invalid credentials" });
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ detail: "Invalid credentials" });
    }

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);

    // Save refresh token key or trace (Sequence-like or directly in DB or sequence update)
    // Wait, the schema does not have a RefreshToken table, so we can just verify the JTI or sign with refresh secret.
    // The prompt database schema does not list a RefreshToken table, but we can verify it crypto-graphically
    // via JWT verification, which is completely correct. Or we can store refresh tokens in Redis or use JWT state-less verification.
    // Let's check: in Python, there was a refresh_tokens collection in MongoDB. Since the Prisma schema does not have a RefreshToken model,
    // we can save refresh tokens in Redis under `refresh:${user.id}`! This is incredibly fast, correct, and conforms to the database schema.
    await req.app.get("redis").setex(`refresh:${user.id}`, 7 * 24 * 60 * 60, refreshToken);

    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
    });
  } catch (error) {
    logger.error("Login controller error: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.refresh_token;
  if (token) {
    try {
      const payload = verifyRefresh(token) as any;
      await req.app.get("redis").del(`refresh:${payload.sub}`);
    } catch (error) {
      // ignore invalid tokens on logout
    }
  }
  clearAuthCookies(res);
  return res.json({ ok: true });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.refresh_token;
  if (!token) {
    return res.status(401).json({ detail: "No refresh token" });
  }

  try {
    const payload = verifyRefresh(token) as any;
    if (payload.type !== "refresh") {
      return res.status(401).json({ detail: "Invalid token type" });
    }

    const storedToken = await req.app.get("redis").get(`refresh:${payload.sub}`);
    if (!storedToken || storedToken !== token) {
      return res.status(401).json({ detail: "Refresh token revoked" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ detail: "User inactive or not found" });
    }

    const newAccessToken = signAccessToken(user.id, user.role);
    const newRefreshToken = signRefreshToken(user.id);

    await req.app.get("redis").setex(`refresh:${user.id}`, 7 * 24 * 60 * 60, newRefreshToken);
    setAuthCookies(res, newAccessToken, newRefreshToken);

    return res.json({ ok: true, accessToken: newAccessToken });
  } catch (error) {
    logger.error("Refresh token controller error: " + error);
    return res.status(401).json({ detail: "Invalid refresh token" });
  }
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ detail: "Not authenticated" });
  }
  return res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    isActive: req.user.isActive,
  });
}

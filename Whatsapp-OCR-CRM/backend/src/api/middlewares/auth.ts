import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: "ADMIN" | "STAFF";
        isActive: boolean;
      };
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role, type: "access" },
    env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

export function signRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh" },
    env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyAccess(token: string): any {
  return jwt.verify(token, env.JWT_SECRET);
}

export function verifyRefresh(token: string): any {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

export function setAuthCookies(res: Response, access: string, refresh: string) {
  const isProd = env.NODE_ENV === "production";
  const common = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
  };
  res.cookie("access_token", access, { ...common, maxAge: 15 * 60 * 1000 });
  res.cookie("refresh_token", refresh, { ...common, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookies(res: Response) {
  const common = {
    secure: true,
    sameSite: "none" as const,
    path: "/",
  };
  res.clearCookie("access_token", common);
  res.clearCookie("refresh_token", common);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.access_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    }
  }

  if (!token) {
    return res.status(401).json({ detail: "Not authenticated" });
  }

  try {
    const payload = verifyAccess(token) as any;
    if (payload.type !== "access") {
      return res.status(401).json({ detail: "Invalid token type" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ detail: "User not found or inactive" });
    }

    req.user = user as any;
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ detail: "Token expired" });
    }
    return res.status(401).json({ detail: "Invalid token" });
  }
}

export function requireRole(role: "ADMIN" | "STAFF") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ detail: "Not authenticated" });
    }
    if (req.user.role !== role && req.user.role !== "ADMIN") {
      return res.status(403).json({ detail: `Requires ${role} role` });
    }
    next();
  };
}

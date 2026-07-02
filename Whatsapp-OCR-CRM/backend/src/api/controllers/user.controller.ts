import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../middlewares/auth";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";

export async function listUsers(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return res.json({ items: users });
  } catch (error) {
    logger.error("Error listing users: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createUser(req: Request, res: Response) {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ detail: "Name, email, and password are required" });
  }

  const emailLc = email.toLowerCase();

  try {
    const existing = await prisma.user.findUnique({ where: { email: emailLc } });
    if (existing) {
      return res.status(400).json({ detail: "Email already in use" });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name,
        email: emailLc,
        passwordHash,
        role: role || "STAFF",
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await logActivity(req.user!.id, "create", "user", user.id);
    return res.json(user);
  } catch (error) {
    logger.error("Error creating user: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { name, role, isActive } = req.body;

  try {
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await logActivity(req.user!.id, "update", "user", id);
    return res.json(updated);
  } catch (error) {
    logger.error(`Error updating user ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

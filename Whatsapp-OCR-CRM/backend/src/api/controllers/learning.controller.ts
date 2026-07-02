import { Request, Response } from "express";
import { getLearningStats } from "../../services/learning.service";
import { logger } from "../../utils/logger";

export async function learningStats(req: Request, res: Response) {
  try {
    const stats = await getLearningStats();
    return res.json(stats);
  } catch (error) {
    logger.error("Error fetching learning stats: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

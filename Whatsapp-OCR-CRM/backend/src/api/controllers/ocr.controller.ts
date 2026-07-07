import { Request, Response } from "express";
import crypto from "crypto";
import { upload } from "../../lib/s3";
import { inboundQueue, inventoryScoreQueue } from "../../jobs/queues";
import { redisConnection } from "../../lib/redis";
import { cancelConversationJobs, markStaleJobsFailed } from "../../lib/ocr-job-state";
import { formatUserErrorMessage } from "../../utils/user-error-message";
import { logger } from "../../utils/logger";

function detectMime(filename: string | undefined, buffer: Buffer): string {
  // Check magic bytes
  if (buffer.length > 8 && buffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return "image/png";
  }
  if (buffer.length > 3 && buffer.slice(0, 3).toString("hex") === "ffd8ff") {
    return "image/jpeg";
  }
  if (buffer.length > 4 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export async function processOcr(req: Request, res: Response) {
  const file = req.file;
  const conversationId = req.body.conversationId;

  if (!file) {
    return res.status(400).json({ detail: "Image file is required (form field 'file')" });
  }

  try {
    const buffer = file.buffer;
    const mime = detectMime(file.originalname, buffer);
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      return res.status(400).json({ detail: "Only PNG / JPEG / WEBP are supported" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const ext = mime.split("/")[1];
    const uuid = crypto.randomUUID();
    const key = `uploads/ocr/${today}/${uuid}.${ext}`;

    await upload(key, buffer, mime);

    const jobId = crypto.randomUUID();
    const jobState = {
      status: "processing",
      step: "queued",
      s3Key: key,
      mime,
      conversationId: conversationId || null,
      createdAt: new Date().toISOString(),
      userId: req.user?.id || null,
    };

    // Cache initial state in Redis for 1 hour
    await redisConnection.setex(`ocr:job:${jobId}`, 3600, JSON.stringify(jobState));

    // Dispatch to inboundQueue (unified pipeline)
    await inboundQueue.add("processMessage", {
      jobId,
      msgType: "image",
      mediaUrl: key,
      conversationId,
      source: "staff_upload",
    });

    return res.json({ jobId, status: "processing" });
  } catch (error) {
    logger.error("Error processing OCR multipart: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function processOcrBase64(req: Request, res: Response) {
  const { imageDataUrl, conversationId } = req.body;

  if (!imageDataUrl || !imageDataUrl.startsWith("data:")) {
    return res.status(400).json({ detail: "imageDataUrl required (data: URL)" });
  }

  try {
    const [header, b64] = imageDataUrl.split(",");
    const buffer = Buffer.from(b64, "base64");
    const mime = detectMime(undefined, buffer);
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      return res.status(400).json({ detail: "Only PNG / JPEG / WEBP are supported" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const ext = mime.split("/")[1];
    const uuid = crypto.randomUUID();
    const key = `uploads/ocr/${today}/${uuid}.${ext}`;

    await upload(key, buffer, mime);

    const jobId = crypto.randomUUID();
    const jobState = {
      status: "processing",
      step: "queued",
      s3Key: key,
      mime,
      conversationId: conversationId || null,
      createdAt: new Date().toISOString(),
      userId: req.user?.id || null,
    };

    await redisConnection.setex(`ocr:job:${jobId}`, 3600, JSON.stringify(jobState));

    // Dispatch to inboundQueue (unified pipeline)
    await inboundQueue.add("processMessage", {
      jobId,
      msgType: "image",
      mediaUrl: key,
      conversationId,
      source: "staff_upload",
    });

    return res.json({ jobId, status: "processing" });
  } catch (error) {
    logger.error("Error processing OCR base64: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getOcrResult(req: Request, res: Response) {
  const { jobId } = req.params;

  try {
    const state = await redisConnection.get(`ocr:job:${jobId}`);
    if (!state) {
      return res.status(404).json({ detail: "Job not found" });
    }

    const parsed = JSON.parse(state);
    return res.json({
      status: parsed.status,
      step: parsed.step,
      enquiryId: parsed.enquiryId || null,
      ignored: parsed.ignored || false,
      rows: parsed.rows || [],
      quotation: parsed.quotation || null,
      rawText: parsed.rawText || null,
      ocrConfidence: parsed.ocrConfidence || null,
      conversationId: parsed.conversationId || null,
      s3Key: parsed.s3Key || null,
      error: parsed.error ? formatUserErrorMessage(parsed.error) : null,
      retryable: parsed.retryable ?? false,
      failedStep: parsed.failedStep || null,
    });
  } catch (error) {
    logger.error(`Error retrieving OCR job ${jobId}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function retryOcrJob(req: Request, res: Response) {
  const { jobId } = req.params;

  try {
    const state = await redisConnection.get(`ocr:job:${jobId}`);
    if (!state) {
      return res.status(404).json({ detail: "Job not found" });
    }

    const parsed = JSON.parse(state);
    if (parsed.status !== "failed") {
      return res.status(400).json({ detail: "Only failed jobs can be retried" });
    }

    const failedStep = parsed.failedStep || "ocr";
    const nextStep = failedStep === "inventory_score" && parsed.rawText ? "inventory_score" : "queued";

    await redisConnection.setex(
      `ocr:job:${jobId}`,
      3600,
      JSON.stringify({
        ...parsed,
        status: "processing",
        step: nextStep,
        error: null,
        failedStep: null,
        retryable: false,
      })
    );

    if (failedStep === "inventory_score" && parsed.rawText) {
      await inventoryScoreQueue.add("scoreProducts", {
        rawText: parsed.rawText,
        ocrConfidence: parsed.ocrConfidence ?? 1,
        conversationId: parsed.conversationId,
        customerId: parsed.customerId,
        jobId,
        source: parsed.source || "staff_upload",
        messageId: parsed.messageId,
        msgType: parsed.msgType || "image",
      });
    } else if (parsed.s3Key || parsed.mediaUrl) {
      await inboundQueue.add("processMessage", {
        jobId,
        messageId: parsed.messageId,
        msgType: parsed.msgType || "image",
        mediaUrl: parsed.s3Key || parsed.mediaUrl,
        conversationId: parsed.conversationId,
        customerId: parsed.customerId,
        source: parsed.source || "staff_upload",
      });
    } else {
      return res.status(400).json({ detail: "Job has no retryable payload" });
    }

    return res.json({ jobId, status: "processing", step: nextStep });
  } catch (error) {
    logger.error(`Error retrying OCR job ${jobId}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function listActiveJobs(req: Request, res: Response) {
  const { conversationId } = req.query;

  if (!conversationId || typeof conversationId !== "string") {
    return res.status(400).json({ detail: "conversationId required" });
  }

  try {
    await markStaleJobsFailed(conversationId);

    // Scan for all job keys
    const jobKeys: string[] = [];
    let cursor = "0";
    
    do {
      const [nextCursor, keys] = await redisConnection.scan(
        cursor,
        "MATCH",
        "ocr:job:*",
        "COUNT",
        100
      );
      cursor = nextCursor;
      jobKeys.push(...keys);
    } while (cursor !== "0");

    // Get all job states and filter by conversation
    const jobs = [];
    for (const key of jobKeys) {
      const state = await redisConnection.get(key);
      if (state) {
        const parsed = JSON.parse(state);
        if (
          parsed.conversationId === conversationId &&
          (parsed.status === "processing" || parsed.status === "failed")
        ) {
          jobs.push({
            jobId: key.replace("ocr:job:", ""),
            step: parsed.step,
            status: parsed.status,
            createdAt: parsed.createdAt,
            error: parsed.error ? formatUserErrorMessage(parsed.error) : null,
            retryable: parsed.retryable ?? false,
            enquiryId: parsed.enquiryId || null,
          });
        }
      }
    }

    return res.json({ items: jobs });
  } catch (error) {
    logger.error("Error listing active OCR jobs: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function cancelActiveJobs(req: Request, res: Response) {
  const { conversationId } = req.body as { conversationId?: string };

  if (!conversationId) {
    return res.status(400).json({ detail: "conversationId required" });
  }

  try {
    const cancelled = await cancelConversationJobs(conversationId);
    return res.json({ ok: true, cancelled });
  } catch (error) {
    logger.error("Error cancelling active OCR jobs: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

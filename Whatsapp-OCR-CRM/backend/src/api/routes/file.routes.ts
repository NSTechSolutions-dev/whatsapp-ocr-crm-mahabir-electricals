import { Router, Request, Response } from "express";
import { getBuffer } from "../../lib/s3";
import { logger } from "../../utils/logger";

const router = Router();

router.get("/files/:path(*)", async (req: Request, res: Response) => {
  const filePath = req.params.path || req.params[0];
  if (!filePath) {
    return res.status(400).send("File path is required");
  }

  try {
    const buffer = await getBuffer(filePath);
    
    // Simple mime check based on file extension
    const ext = filePath.split(".").pop()?.toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
    else if (ext === "png") contentType = "image/png";
    else if (ext === "webp") contentType = "image/webp";
    else if (ext === "pdf") contentType = "application/pdf";

    res.setHeader("Content-Type", contentType);
    return res.send(buffer);
  } catch (error) {
    logger.error(`Failed to serve file ${filePath}: ${error}`);
    return res.status(404).send("File not found");
  }
});

export default router;
// 

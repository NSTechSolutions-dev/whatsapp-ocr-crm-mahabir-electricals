import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import fs from "fs";
import path from "path";

export const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

function isMockS3() {
  const key = env.AWS_ACCESS_KEY_ID || "";
  return !key || key === "your_access_key" || key.includes("placeholder") || key.includes("mock");
}

export async function upload(key: string, body: Buffer, contentType?: string): Promise<string> {
  if (isMockS3()) {
    try {
      const localPath = path.join(process.cwd(), "uploads", key);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, body);
      logger.info(`Mock S3: Saved file locally at ${localPath}`);
      return key;
    } catch (err) {
      logger.error(`Mock S3 upload failed locally: ${err}`);
      throw err;
    }
  }

  try {
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await s3Client.send(command);
    return key;
  } catch (error) {
    logger.error(`S3 upload failed for key ${key}: ${error}`);
    throw error;
  }
}

export async function getPresignedUrl(key: string, expirySeconds: number = 3600): Promise<string> {
  if (isMockS3()) {
    const base = process.env.BACKEND_URL || `http://localhost:${env.PORT}`;
    return `${base}/api/files/${key}`;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: expirySeconds });
    return url;
  } catch (error) {
    logger.error(`S3 getPresignedUrl failed for key ${key}: ${error}`);
    throw error;
  }
}

export async function getBuffer(key: string): Promise<Buffer> {
  if (isMockS3()) {
    try {
      const localPath = path.join(process.cwd(), "uploads", key);
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
      throw new Error(`File not found locally: ${localPath}`);
    } catch (err) {
      logger.error(`Mock S3 getBuffer failed: ${err}`);
      throw err;
    }
  }

  try {
    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error("S3 response body is empty");
    }
    const streamToBuffer = async (stream: any): Promise<Buffer> => {
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: any[] = [];
        stream.on("data", (chunk: any) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
    };
    return await streamToBuffer(response.Body);
  } catch (error) {
    logger.error(`S3 getBuffer failed for key ${key}: ${error}`);
    throw error;
  }
}

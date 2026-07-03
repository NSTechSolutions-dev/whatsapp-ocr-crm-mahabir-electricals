import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

function loadEnvFiles() {
  const candidates = [
    process.env.ENV_FILE,
    path.join(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env"),
  ].filter((p): p is string => Boolean(p));

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return envPath;
    }
  }
  return null;
}

const loadedEnvPath = loadEnvFiles();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  MSG91_AUTH_KEY: z.string(),
  MSG91_WEBHOOK_SECRET: z.string(),
  MSG91_INTEGRATED_NUMBER: z.string(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_VISION_MODEL: z.string().default("gemini-2.5-flash-lite"),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIMENSION: z.coerce.number().default(768),
  EMBEDDING_MATCH_THRESHOLD: z.coerce.number().default(0.82),
  EMBEDDING_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v !== false && v !== "0" && v !== "false")
    .default(true),
  LEARNING_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v !== false && v !== "0" && v !== "false")
    .default(true),
  LEARNING_MIN_HITS: z.coerce.number().int().min(1).default(1),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_S3_BUCKET: z.string(),
  AWS_REGION: z.string().default("ap-south-1"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  COMPANY_NAME: z.string().default("Mahabir Electricals"),
  COMPANY_ADDRESS: z.string().default("Mahabir Electricals, India"),
  COMPANY_GSTIN: z.string().default("YOUR_GSTIN"),
  COMPANY_PHONE: z.string().default("+91XXXXXXXXXX"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  if (loadedEnvPath) {
    console.error(`   Loaded .env from: ${loadedEnvPath}`);
  } else {
    console.error("   No .env file found (check PM2 env or $APP_ROOT/.env permissions)");
  }
  process.exit(1);
}

export const env = parsed.data;

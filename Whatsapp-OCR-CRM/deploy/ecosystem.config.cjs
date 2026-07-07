/** PM2 process file — paths resolved at deploy time */
const fs = require("fs");
const path = require("path");

const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "..");
const domain = process.env.DEPLOY_DOMAIN || "crm.mahabirelectricals.in";
const socketUrl = `https://${domain}`;

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const dotenv = require(path.join(appRoot, "backend/node_modules/dotenv"));
    const result = dotenv.config({ path: filePath });
    const parsed = result.parsed || {};
    // Skip empty values so PM2 does not inject GEMINI_API_KEY= and block the real key from .env
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value != null && String(value).trim() !== "")
    );
  } catch (err) {
    console.warn(`[ecosystem] dotenv failed for ${filePath}:`, err.message);
    return {};
  }
}

const rootEnvPath = path.join(appRoot, ".env");
const backendEnvPath = path.join(appRoot, "backend", ".env");
const fileEnv = {
  ...loadEnvFile(rootEnvPath),
  ...loadEnvFile(backendEnvPath),
};

if (!Object.keys(fileEnv).length) {
  console.warn(`[ecosystem] No .env loaded from ${rootEnvPath} or ${backendEnvPath}`);
} else {
  console.log(`[ecosystem] Loaded ${Object.keys(fileEnv).length} env vars from .env`);
}

const backendEnv = {
  NODE_ENV: "production",
  ENV_FILE: rootEnvPath,
  ...fileEnv,
};

const frontendEnv = {
  NODE_ENV: "production",
  HOSTNAME: "0.0.0.0",
  PORT: "3000",
  NEXT_PUBLIC_SOCKET_URL: fileEnv.NEXT_PUBLIC_SOCKET_URL || socketUrl,
};

const pm2Logs = {
  merge_logs: true,
  time: true,
};

const pm2Stability = {
  max_restarts: 15,
  min_uptime: 5000,
  restart_delay: 3000,
};

module.exports = {
  apps: [
    {
      name: "mahabir-crm-backend",
      cwd: path.join(appRoot, "backend"),
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: backendEnv,
      error_file: path.join(appRoot, "logs", "backend-error.log"),
      out_file: path.join(appRoot, "logs", "backend-out.log"),
      ...pm2Logs,
      ...pm2Stability,
    },
    {
      name: "mahabir-crm-frontend",
      cwd: path.join(appRoot, "frontend"),
      script: "npm",
      args: "run start",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: frontendEnv,
      error_file: path.join(appRoot, "logs", "frontend-error.log"),
      out_file: path.join(appRoot, "logs", "frontend-out.log"),
      ...pm2Logs,
      autorestart: true,
      max_restarts: 50,
      min_uptime: 2000,
      restart_delay: 2000,
    },
  ],
};

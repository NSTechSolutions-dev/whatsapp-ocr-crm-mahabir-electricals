/** PM2 process file — paths resolved at deploy time */
const fs = require("fs");
const path = require("path");

const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "..");
const domain = process.env.DEPLOY_DOMAIN || "crm.mahabirelectricals.in";
const socketUrl = `https://${domain}`;

function loadEnvFile(filePath) {
  const env = {};
  if (!filePath || !fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const rootEnvPath = path.join(appRoot, ".env");
const backendEnvPath = path.join(appRoot, "backend", ".env");
const fileEnv = {
  ...loadEnvFile(rootEnvPath),
  ...loadEnvFile(backendEnvPath),
};

if (!Object.keys(fileEnv).length) {
  console.warn(`[ecosystem] No .env loaded from ${rootEnvPath} or ${backendEnvPath}`);
}

const backendEnv = {
  NODE_ENV: "production",
  ENV_FILE: rootEnvPath,
  ...fileEnv,
};

const frontendEnv = {
  NODE_ENV: "production",
  HOSTNAME: "0.0.0.0",
  NEXT_PUBLIC_SOCKET_URL: fileEnv.NEXT_PUBLIC_SOCKET_URL || socketUrl,
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
      merge_logs: true,
      time: true,
    },
    {
      name: "mahabir-crm-frontend",
      cwd: path.join(appRoot, "frontend"),
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 0.0.0.0",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: frontendEnv,
      error_file: path.join(appRoot, "logs", "frontend-error.log"),
      out_file: path.join(appRoot, "logs", "frontend-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};

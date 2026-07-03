/** PM2 process file — paths resolved at deploy time */
const path = require("path");
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "..");
const domain = process.env.DEPLOY_DOMAIN || "crm.mahabirelectricals.in";
const socketUrl = `https://${domain}`;

module.exports = {
  apps: [
    {
      name: "mahabir-crm-backend",
      cwd: path.join(appRoot, "backend"),
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
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
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        NEXT_PUBLIC_SOCKET_URL: socketUrl,
      },
      error_file: path.join(appRoot, "logs", "frontend-error.log"),
      out_file: path.join(appRoot, "logs", "frontend-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};

#!/usr/bin/env bash
# Quick production diagnostics — run as root from repo root.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${DEPLOY_USER:-mahabir}"
export APP_ROOT

PM2="$APP_ROOT/deploy/pm2.sh"

echo "=== APP_ROOT: $APP_ROOT ==="
echo

echo "=== .env file ==="
if [[ -f "$APP_ROOT/.env" ]]; then
  ls -la "$APP_ROOT/.env"
  echo "Keys defined: $(grep -cE '^[A-Z_]+=' "$APP_ROOT/.env" || true)"
else
  echo "MISSING: $APP_ROOT/.env"
fi
echo

echo "=== Ecosystem env load test ==="
(cd "$APP_ROOT" && sudo -u "$APP_USER" env HOME="$APP_ROOT" PM2_HOME="$APP_ROOT/.pm2" APP_ROOT="$APP_ROOT" \
  node -e "
const c = require('./deploy/ecosystem.config.cjs');
const e = c.apps[0].env;
const keys = ['DATABASE_URL','REDIS_URL','JWT_SECRET','AWS_ACCESS_KEY_ID','MSG91_AUTH_KEY'];
for (const k of keys) console.log(k + ':', e[k] ? 'SET' : 'MISSING');
")
echo

echo "=== PM2 status (mahabir user) ==="
"$PM2" ls || true
echo

echo "=== Backend logs (last 15 lines) ==="
tail -15 "$APP_ROOT/logs/backend-error.log" 2>/dev/null || echo "(no error log)"
echo

echo "=== Health checks ==="
curl -sf "http://127.0.0.1:4000/api/health" && echo || echo "Backend: DOWN on :4000"
curl -sf -o /dev/null "http://127.0.0.1:3000/" && echo "Frontend: OK on :3000" || echo "Frontend: DOWN on :3000"

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

echo "=== Frontend PM2 / logs ==="
"$PM2" describe mahabir-crm-frontend 2>/dev/null | grep -E 'status|restarts|uptime|error' || echo "Frontend not in PM2"
tail -20 "$APP_ROOT/logs/frontend-error.log" 2>/dev/null || echo "(no frontend error log)"
echo

echo "=== Port 3000 listener ==="
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep ':3000 ' || echo "Nothing on :3000"
  listen_pid="$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
  if [[ -n "$listen_pid" ]]; then
    echo "PID ${listen_pid} cwd: $(readlink -f /proc/${listen_pid}/cwd 2>/dev/null || echo unknown)"
  fi
else
  echo "(ss not available)"
fi
echo

echo "=== Frontend build vs HTML ==="
server_chunk="$(grep -roh 'main-app-[a-f0-9]\+\.js' "$APP_ROOT/frontend/.next/server" 2>/dev/null | sort -u | head -1 || true)"
html_chunk="$(curl -sf -H 'Cache-Control: no-cache' http://127.0.0.1:3000/ 2>/dev/null | grep -oE 'main-app-[a-f0-9]+\.js' | head -1 || true)"
echo "Server build chunk: ${server_chunk:-MISSING}"
echo "HTML chunk:         ${html_chunk:-MISSING}"
echo

echo "=== Health checks ==="
curl -sf "http://127.0.0.1:4000/api/health" && echo || echo "Backend: DOWN on :4000"
curl -sf -o /dev/null "http://127.0.0.1:3000/" && echo "Frontend: OK on :3000" || echo "Frontend: DOWN on :3000"

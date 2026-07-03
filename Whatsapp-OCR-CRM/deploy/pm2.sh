#!/usr/bin/env bash
# Run PM2 as the deploy user with correct HOME/PM2_HOME (never use bare `sudo -u mahabir pm2`).
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${DEPLOY_USER:-mahabir}"
export APP_ROOT

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  exec sudo -u "$APP_USER" env \
    HOME="$APP_ROOT" \
    PM2_HOME="$APP_ROOT/.pm2" \
    APP_ROOT="$APP_ROOT" \
    DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-crm.mahabirelectricals.in}" \
    pm2 "$@"
fi

export HOME="$APP_ROOT"
export PM2_HOME="$APP_ROOT/.pm2"
exec pm2 "$@"

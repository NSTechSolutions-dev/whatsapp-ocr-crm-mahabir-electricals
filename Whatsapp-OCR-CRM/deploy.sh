#!/usr/bin/env bash
# =============================================================================
# Mahabir Electricals CRM — AWS Linux ARM (t4g.small) deploy script
# Postgres + Redis on host (no Docker). Backend + Frontend via PM2. Apache httpd.
#
# Usage (from repo root, e.g. /opt/mahabirelectricals-crm):
#   sudo ./deploy.sh              # full first-time setup
#   sudo ./deploy.sh --update     # incremental: pull, build, migrate, reload PM2
#
# Prerequisites:
#   - Amazon Linux 2023 (aarch64) or RHEL-compatible with dnf
#   - DNS A record: crm.mahabirelectricals.in → this server's public IP
#   - Security group: inbound TCP 80, 443
#   - Run as root or with passwordless sudo
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DOMAIN="${DEPLOY_DOMAIN:-crm.mahabirelectricals.in}"
APP_USER="${DEPLOY_USER:-mahabir}"
APP_GROUP="${DEPLOY_GROUP:-mahabir}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@mahabirelectricals.in}"
DB_NAME="${DB_NAME:-whatsapp_crm}"
DB_USER="${DB_USER:-whatsapp_crm}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${APP_ROOT:-$SCRIPT_DIR}"
ENV_FILE="$APP_ROOT/.env"
SECRETS_FILE="$APP_ROOT/.deploy-secrets"
LOG_DIR="$APP_ROOT/logs"
HTTPD_CONF="/etc/httpd/conf.d/mahabir-crm.conf"
ECOSYSTEM="$APP_ROOT/deploy/ecosystem.config.cjs"

UPDATE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE_ONLY=1 ;;
    -h|--help)
      echo "Usage: sudo $0 [--update]"
      echo "  (no flag)   Full install: OS packages, Postgres, Redis, SSL, PM2, httpd"
      echo "  --update    Incremental: git pull, npm build, prisma sync, PM2 reload"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# Run commands as the deploy user with a writable HOME/npm cache under APP_ROOT.
# Avoids EACCES when the user's passwd home differs from the checkout path.
run_as_app_user() {
  mkdir -p "$APP_ROOT/.npm" "$APP_ROOT/.tmp" "$APP_ROOT/.cache"
  chown -R "$APP_USER:$APP_GROUP" "$APP_ROOT/.npm" "$APP_ROOT/.tmp" "$APP_ROOT/.cache" 2>/dev/null \
    || chown -R "$APP_USER:$APP_USER" "$APP_ROOT/.npm" "$APP_ROOT/.tmp" "$APP_ROOT/.cache"
  sudo -u "$APP_USER" env \
    HOME="$APP_ROOT" \
    NPM_CONFIG_CACHE="$APP_ROOT/.npm" \
    npm_config_cache="$APP_ROOT/.npm" \
    TMPDIR="$APP_ROOT/.tmp" \
    "$@"
}

ensure_app_ownership() {
  local target="${1:-$APP_ROOT}"
  chown -R "$APP_USER:$APP_GROUP" "$target" 2>/dev/null || chown -R "$APP_USER:$APP_USER" "$target"
}

npm_install_project() {
  local project_dir="$1"
  local label="$2"
  log "Installing npm dependencies for $label…"
  cd "$project_dir"
  ensure_app_ownership "$project_dir"
  # Remove corrupted/partial installs (common after failed deploys or root-owned node_modules).
  rm -rf node_modules
  if [[ -f package-lock.json ]]; then
    if ! run_as_app_user npm ci; then
      warn "npm ci failed for $label — removing lock artifacts and retrying"
      rm -rf node_modules
      run_as_app_user npm install
    fi
  else
    run_as_app_user npm install
  fi
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run as root: sudo $0 $*"
  fi
}

arch_ok() {
  local arch
  arch="$(uname -m)"
  [[ "$arch" == "aarch64" || "$arch" == "arm64" || "$arch" == "x86_64" ]] || \
    warn "Untested architecture: $arch (script targets AWS Graviton / AL2023)"
}

dnf_install() {
  log "Installing system packages via dnf…"
  # On Amazon Linux 2023, proxy/rewrite/headers modules ship inside httpd (not separate packages).
  dnf install -y \
    git \
    httpd \
    mod_ssl \
    certbot \
    python3-certbot-apache \
    redis6 \
    postgresql15 \
    postgresql15-server \
    postgresql15-server-devel \
    gcc \
    make \
    openssl \
    which \
    tar \
    gzip \
    alsa-lib \
    atk \
    at-spi2-atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    xorg-x11-fonts-Type1 \
    xorg-x11-fonts-misc \
    nss \
    nspr \
    libdrm \
    mesa-libgbm
  verify_httpd_modules
}

verify_httpd_modules() {
  log "Verifying Apache modules (bundled with httpd on AL2023)…"
  local required=(proxy proxy_http proxy_wstunnel rewrite headers ssl)
  local missing=()
  for mod in "${required[@]}"; do
    if ! httpd -M 2>/dev/null | grep -q "${mod}_module"; then
      missing+=("$mod")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing Apache modules: ${missing[*]}. Ensure httpd is installed and modules are enabled."
  fi
  log "Required Apache modules are loaded"
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      log "Node.js $(node -v) already installed"
      return
    fi
  fi
  log "Installing Node.js ${NODE_MAJOR} from dnf…"
  dnf install -y "nodejs${NODE_MAJOR}" npm || dnf install -y nodejs npm
  command -v node >/dev/null 2>&1 || die "Node.js installation failed"
  log "Node $(node -v) / npm $(npm -v)"
}

install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 already installed: $(pm2 -v)"
    return
  fi
  log "Installing PM2 globally…"
  npm install -g pm2
}

install_pgvector() {
  if sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'" 2>/dev/null | grep -q 1; then
    log "pgvector extension already enabled"
    return
  fi
  local build_dir="/tmp/pgvector-build-$$"
  log "Building pgvector from source (ARM-compatible)…"
  rm -rf "$build_dir"
  git clone --depth 1 --branch v0.8.0 https://github.com/pgvector/pgvector.git "$build_dir"
  make -C "$build_dir" OPTFLAGS=""
  make -C "$build_dir" install
  rm -rf "$build_dir"
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  log "pgvector installed"
}

setup_app_user() {
  if id "$APP_USER" &>/dev/null; then
    log "User $APP_USER exists"
    local current_home
    current_home="$(getent passwd "$APP_USER" | cut -d: -f6)"
    if [[ -n "$current_home" && "$current_home" != "$APP_ROOT" ]]; then
      warn "Updating $APP_USER home: $current_home → $APP_ROOT"
      usermod -d "$APP_ROOT" -m "$APP_USER" 2>/dev/null || usermod -d "$APP_ROOT" "$APP_USER" 2>/dev/null || true
    fi
  else
    log "Creating system user $APP_USER…"
    useradd --system --home-dir "$APP_ROOT" --shell /sbin/nologin "$APP_USER"
  fi
  mkdir -p "$LOG_DIR" "$APP_ROOT" "$APP_ROOT/.npm" "$APP_ROOT/.tmp" "$APP_ROOT/.cache"
  ensure_app_ownership "$APP_ROOT"
}

setup_postgres() {
  log "Configuring PostgreSQL…"
  if [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
    postgresql-setup --initdb
  fi
  systemctl enable postgresql
  systemctl start postgresql

  # Load secrets
  # shellcheck disable=SC1090
  [[ -f "$SECRETS_FILE" ]] && source "$SECRETS_FILE"
  DB_PASS="${DB_PASS:-}"

  if [[ -z "$DB_PASS" ]]; then
    DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
    echo "DB_PASS='$DB_PASS'" >> "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    chown root:root "$SECRETS_FILE"
  fi

  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" || true

  # Allow password auth from localhost
  local pg_hba="/var/lib/pgsql/data/pg_hba.conf"
  if [[ -f "$pg_hba" ]] && ! grep -q "127.0.0.1/32.*scram-sha-256" "$pg_hba"; then
    echo "host    $DB_NAME    $DB_USER    127.0.0.1/32    scram-sha-256" >> "$pg_hba"
    systemctl reload postgresql
  fi

  install_pgvector
}

setup_redis() {
  log "Configuring Redis…"
  systemctl enable redis6 2>/dev/null || systemctl enable redis
  systemctl start redis6 2>/dev/null || systemctl start redis
  # Bind localhost only
  local redis_conf="/etc/redis6/redis6.conf"
  [[ -f "$redis_conf" ]] || redis_conf="/etc/redis/redis.conf"
  if [[ -f "$redis_conf" ]]; then
    sed -i 's/^bind .*/bind 127.0.0.1/' "$redis_conf" 2>/dev/null || true
    sed -i 's/^protected-mode .*/protected-mode yes/' "$redis_conf" 2>/dev/null || true
    systemctl restart redis6 2>/dev/null || systemctl restart redis
  fi
}

read_env_val() {
  local key="$1" default="${2:-}"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE"; then
    grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//'
  else
    echo "$default"
  fi
}

write_env() {
  log "Writing $ENV_FILE…"
  # shellcheck disable=SC1090
  [[ -f "$SECRETS_FILE" ]] && source "$SECRETS_FILE"

  local jwt_secret jwt_refresh db_pass
  jwt_secret="$(read_env_val JWT_SECRET)"
  jwt_refresh="$(read_env_val JWT_REFRESH_SECRET)"
  db_pass="${DB_PASS:-$(read_env_val DB_PASS)}"

  if [[ -z "$jwt_secret" ]]; then
    jwt_secret="$(openssl rand -hex 32)"
  fi
  if [[ -z "$jwt_refresh" ]]; then
    jwt_refresh="$(openssl rand -hex 32)"
  fi
  if [[ -z "$db_pass" ]]; then
    db_pass="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
    echo "DB_PASS='$db_pass'" >> "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
  fi

  local database_url="postgresql://${DB_USER}:${db_pass}@127.0.0.1:5432/${DB_NAME}"
  local redis_url="redis://127.0.0.1:6379"
  local frontend_url="https://${DOMAIN}"

  # Preserve existing third-party keys if .env already has them
  local msg91_key msg91_secret msg91_number aws_key aws_secret aws_bucket aws_region gemini_key
  msg91_key="$(read_env_val MSG91_AUTH_KEY "CHANGE_ME_MSG91_AUTH_KEY")"
  msg91_secret="$(read_env_val MSG91_WEBHOOK_SECRET "CHANGE_ME_MSG91_WEBHOOK_SECRET")"
  msg91_number="$(read_env_val MSG91_INTEGRATED_NUMBER "91XXXXXXXXXX")"
  aws_key="$(read_env_val AWS_ACCESS_KEY_ID "CHANGE_ME_AWS_ACCESS_KEY")"
  aws_secret="$(read_env_val AWS_SECRET_ACCESS_KEY "CHANGE_ME_AWS_SECRET_KEY")"
  aws_bucket="$(read_env_val AWS_S3_BUCKET "mahabirelectrical-quotation-pdfs")"
  aws_region="$(read_env_val AWS_REGION "ap-south-1")"
  gemini_key="$(read_env_val GEMINI_API_KEY "")"
  local company_name company_address company_gstin company_phone
  company_name="$(read_env_val COMPANY_NAME "Mahabir Electricals")"
  company_address="$(read_env_val COMPANY_ADDRESS "Mahabir Electricals, India")"
  company_gstin="$(read_env_val COMPANY_GSTIN "YOUR_GSTIN")"
  company_phone="$(read_env_val COMPANY_PHONE "+91XXXXXXXXXX")"

  cat > "$ENV_FILE" <<EOF
# Generated by deploy.sh — edit secrets marked CHANGE_ME before going live
DATABASE_URL=${database_url}
REDIS_URL=${redis_url}
JWT_SECRET=${jwt_secret}
JWT_REFRESH_SECRET=${jwt_refresh}
MSG91_AUTH_KEY=${msg91_key}
MSG91_WEBHOOK_SECRET=${msg91_secret}
MSG91_INTEGRATED_NUMBER=${msg91_number}
MSG91_MOCK=0
GEMINI_API_KEY=${gemini_key}
AWS_ACCESS_KEY_ID=${aws_key}
AWS_SECRET_ACCESS_KEY=${aws_secret}
AWS_S3_BUCKET=${aws_bucket}
AWS_REGION=${aws_region}
PORT=${BACKEND_PORT}
FRONTEND_URL=${frontend_url}
NODE_ENV=production
COMPANY_NAME="${company_name}"
COMPANY_ADDRESS="${company_address}"
COMPANY_GSTIN="${company_gstin}"
COMPANY_PHONE="${company_phone}"
NEXT_PUBLIC_SOCKET_URL=${frontend_url}
PUPPETEER_CACHE_DIR=${APP_ROOT}/.cache/puppeteer
EOF

  cp "$ENV_FILE" "$APP_ROOT/backend/.env"
  chmod 640 "$ENV_FILE" "$APP_ROOT/backend/.env"
  chown "$APP_USER:$APP_GROUP" "$ENV_FILE" "$APP_ROOT/backend/.env" 2>/dev/null || true

  if grep -q "CHANGE_ME" "$ENV_FILE"; then
    warn "Edit $ENV_FILE and set MSG91 / AWS / GEMINI keys before production use."
  fi
}

git_pull() {
  if [[ -d "$APP_ROOT/.git" ]]; then
    log "Pulling latest code…"
    run_as_app_user git -C "$APP_ROOT" pull --ff-only || warn "git pull failed — continuing with current tree"
  else
    warn "No .git directory — skipping git pull"
  fi
}

build_backend() {
  log "Building backend…"
  npm_install_project "$APP_ROOT/backend" "backend"
  cd "$APP_ROOT/backend"
  run_as_app_user npx prisma generate
  run_as_app_user npm run build
  # Puppeteer Chromium for quotation PDFs (ARM)
  run_as_app_user env PUPPETEER_CACHE_DIR="$APP_ROOT/.cache/puppeteer" \
    npx puppeteer browsers install chrome 2>/dev/null || \
    warn "Puppeteer browser install failed — quotation PDF generation may not work until fixed"
}

sync_database() {
  log "Syncing database schema…"
  cd "$APP_ROOT/backend"
  if [[ "$UPDATE_ONLY" -eq 0 ]]; then
    run_as_app_user npx prisma db push --accept-data-loss
    run_as_app_user npx prisma db seed || warn "Seed skipped or failed (may already be seeded)"
  else
    run_as_app_user npx prisma db push
  fi
}

build_frontend() {
  log "Building frontend…"
  npm_install_project "$APP_ROOT/frontend" "frontend"
  cd "$APP_ROOT/frontend"
  run_as_app_user env \
    NODE_ENV=production \
    NEXT_PUBLIC_SOCKET_URL="https://${DOMAIN}" \
    npm run build
}

setup_pm2() {
  log "Starting / reloading PM2 processes…"
  mkdir -p "$LOG_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$LOG_DIR" "$APP_ROOT/.cache" 2>/dev/null || true

  export APP_ROOT DEPLOY_DOMAIN="$DOMAIN"
  cd "$APP_ROOT"

  if run_as_app_user pm2 describe mahabir-crm-backend &>/dev/null; then
    run_as_app_user env APP_ROOT="$APP_ROOT" DEPLOY_DOMAIN="$DOMAIN" \
      pm2 reload "$ECOSYSTEM" --update-env
  else
    run_as_app_user env APP_ROOT="$APP_ROOT" DEPLOY_DOMAIN="$DOMAIN" \
      pm2 start "$ECOSYSTEM"
  fi

  run_as_app_user pm2 save
  if [[ "$UPDATE_ONLY" -eq 0 ]]; then
    env PATH="$PATH:$(npm root -g)/../bin" pm2 startup systemd -u "$APP_USER" --hp "$APP_ROOT" 2>/dev/null | \
      grep -E '^sudo' | bash || warn "Run 'pm2 startup' manually if PM2 does not survive reboot"
  fi
}

write_httpd_conf() {
  log "Writing Apache vhost $HTTPD_CONF…"
  cat > "$HTTPD_CONF" <<EOF
# Mahabir Electricals CRM — generated by deploy.sh
<VirtualHost *:80>
    ServerName ${DOMAIN}
    RewriteEngine On
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName ${DOMAIN}

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/${DOMAIN}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/${DOMAIN}/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
    RequestHeader set X-Real-IP "%{REMOTE_ADDR}s"

    # WebSocket (Socket.io)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/socket.io/(.*) ws://127.0.0.1:${BACKEND_PORT}/socket.io/\$1 [P,L]

    ProxyPass /socket.io/ http://127.0.0.1:${BACKEND_PORT}/socket.io/
    ProxyPassReverse /socket.io/ http://127.0.0.1:${BACKEND_PORT}/socket.io/

    # Backend API + MSG91 webhooks
    ProxyPass /api http://127.0.0.1:${BACKEND_PORT}/api
    ProxyPassReverse /api http://127.0.0.1:${BACKEND_PORT}/api

    ProxyPass /webhooks http://127.0.0.1:${BACKEND_PORT}/api/webhooks
    ProxyPassReverse /webhooks http://127.0.0.1:${BACKEND_PORT}/api/webhooks

    # Next.js frontend
    ProxyPass / http://127.0.0.1:${FRONTEND_PORT}/
    ProxyPassReverse / http://127.0.0.1:${FRONTEND_PORT}/

    ErrorLog  /var/log/httpd/mahabir-crm-error.log
    CustomLog /var/log/httpd/mahabir-crm-access.log combined
</VirtualHost>
EOF
}

setup_httpd_plain() {
  log "Configuring Apache (HTTP only, pre-cert)…"
  cat > "$HTTPD_CONF" <<EOF
<VirtualHost *:80>
    ServerName ${DOMAIN}

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "http"

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/socket.io/(.*) ws://127.0.0.1:${BACKEND_PORT}/socket.io/\$1 [P,L]

    ProxyPass /socket.io/ http://127.0.0.1:${BACKEND_PORT}/socket.io/
    ProxyPassReverse /socket.io/ http://127.0.0.1:${BACKEND_PORT}/socket.io/

    ProxyPass /api http://127.0.0.1:${BACKEND_PORT}/api
    ProxyPassReverse /api http://127.0.0.1:${BACKEND_PORT}/api

    ProxyPass /webhooks http://127.0.0.1:${BACKEND_PORT}/api/webhooks
    ProxyPassReverse /webhooks http://127.0.0.1:${BACKEND_PORT}/api/webhooks

    ProxyPass / http://127.0.0.1:${FRONTEND_PORT}/
    ProxyPassReverse / http://127.0.0.1:${FRONTEND_PORT}/

    ErrorLog  /var/log/httpd/mahabir-crm-error.log
    CustomLog /var/log/httpd/mahabir-crm-access.log combined
</VirtualHost>
EOF

  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
  systemctl enable httpd
  systemctl restart httpd
}

setup_ssl() {
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    log "SSL certificate already exists for ${DOMAIN}"
    write_httpd_conf
    systemctl reload httpd
    return
  fi
  log "Requesting Let's Encrypt certificate for ${DOMAIN}…"
  certbot --apache \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m "$CERTBOT_EMAIL" \
    --redirect || {
      warn "certbot failed — ensure DNS points to this server and ports 80/443 are open"
      warn "Site will remain HTTP-only until certbot succeeds"
      return
    }
  write_httpd_conf
  systemctl reload httpd
  systemctl enable certbot-renew.timer 2>/dev/null || true
}

health_check() {
  log "Health checks…"
  sleep 3
  local ok=0
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null && ok=1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "http://127.0.0.1:${BACKEND_PORT}/api/health" && ok=1
  else
    (echo >/dev/tcp/127.0.0.1/"${BACKEND_PORT}") 2>/dev/null && ok=1
  fi
  [[ "$ok" -eq 1 ]] && log "Backend OK (port ${BACKEND_PORT})" || warn "Backend health check failed"
  ok=0
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null && ok=1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "http://127.0.0.1:${FRONTEND_PORT}/" && ok=1
  else
    (echo >/dev/tcp/127.0.0.1/"${FRONTEND_PORT}") 2>/dev/null && ok=1
  fi
  [[ "$ok" -eq 1 ]] && log "Frontend OK (port ${FRONTEND_PORT})" || warn "Frontend health check failed"
}

full_install() {
  arch_ok
  dnf_install
  install_node
  install_pm2
  setup_app_user
  setup_postgres
  setup_redis
  write_env
  git_pull
  build_backend
  sync_database
  build_frontend
  setup_pm2
  setup_httpd_plain
  setup_ssl
  health_check

  log "════════════════════════════════════════════════════════════"
  log "Deploy complete: https://${DOMAIN}"
  log "Admin login (seeded): admin@example.com / Admin@1234"
  log "Edit secrets: $ENV_FILE"
  log "PM2 status:  sudo -u ${APP_USER} pm2 status"
  log "Logs:        sudo -u ${APP_USER} pm2 logs"
  log "MSG91 webhook URL: https://${DOMAIN}/webhooks/msg91"
  log "════════════════════════════════════════════════════════════"
}

incremental_update() {
  log "Incremental update (--update)…"
  write_env
  git_pull
  build_backend
  sync_database
  build_frontend
  setup_pm2
  systemctl reload httpd 2>/dev/null || true
  health_check
  log "Update complete: https://${DOMAIN}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
require_root
[[ -f "$APP_ROOT/backend/package.json" ]] || die "Run from repo root (expected backend/package.json in $APP_ROOT)"

if [[ "$UPDATE_ONLY" -eq 1 ]]; then
  incremental_update
else
  full_install
fi

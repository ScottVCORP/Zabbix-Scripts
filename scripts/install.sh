#!/usr/bin/env bash
# ==============================================================================
# Script: scripts/install.sh
# Purpose: Bootstrap installer for ScottVCORP/Zabbix-Scripts environment
# Target Host Path: /opt/zabbix/scripts/install.sh
# Target OS: Debian Linux
# ==============================================================================

set -euo pipefail

# Configuration
REPO_URL="https://github.com/ScottVCORP/Zabbix-Scripts.git"
REPO_BRANCH="main"
ZBXWMI_URL="https://raw.githubusercontent.com/13hakta/zbxwmi/master/zbxwmi"
TARGET_DIR="/opt/zabbix"
SCRIPTS_DIR="${TARGET_DIR}/scripts"
DOCKER_DIR="${TARGET_DIR}/docker"
EXTERNALSCRIPTS_DIR="${TARGET_DIR}/externalscripts"
LOG_DIR="/var/log/zabbix-scripts"
INSTALL_LOG="${LOG_DIR}/install.log"

# Prepare logging
mkdir -p "${LOG_DIR}"
touch "${INSTALL_LOG}"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg" | tee -a "${INSTALL_LOG}"
}

log_error() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*"
  echo "$msg" >&2
  echo "$msg" >> "${INSTALL_LOG}"
}

# ------------------------------------------------------------------------------
# 1. Root Privileges Check
# ------------------------------------------------------------------------------
check_privileges() {
  if [[ "${EUID}" -ne 0 ]]; then
    log_error "This script must be executed as root (or with sudo)."
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# 2. Debian Package Prerequisites
# ------------------------------------------------------------------------------
install_prerequisites() {
  log "Verifying Debian system dependencies..."

  local missing_pkgs=()
  for pkg in git curl ca-certificates logrotate; do
    if ! dpkg -s "${pkg}" >/dev/null 2>&1; then
      missing_pkgs+=("${pkg}")
    fi
  done

  if [[ ${#missing_pkgs[@]} -gt 0 ]]; then
    log "Installing missing prerequisites: ${missing_pkgs[*]}..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends "${missing_pkgs[@]}"
    log "Prerequisites installed successfully."
  else
    log "All baseline Debian packages are installed."
  fi
}

# ------------------------------------------------------------------------------
# 3. Directory Layout Initialization
# ------------------------------------------------------------------------------
initialize_directories() {
  log "Initializing directory structure under ${TARGET_DIR}..."
  mkdir -p "${SCRIPTS_DIR}"
  mkdir -p "${DOCKER_DIR}"
  mkdir -p "${EXTERNALSCRIPTS_DIR}"
  mkdir -p "${LOG_DIR}"
}

# ------------------------------------------------------------------------------
# 4. Clone or Update GitHub Repository
# ------------------------------------------------------------------------------
sync_repository() {
  log "Syncing repository from ${REPO_URL} into ${TARGET_DIR}..."

  if [[ -d "${TARGET_DIR}/.git" ]]; then
    log "Existing git repository found at ${TARGET_DIR}. Updating..."
    cd "${TARGET_DIR}"
    git config --global --add safe.directory "${TARGET_DIR}" || true
    git fetch --quiet --depth=1 origin "${REPO_BRANCH}" || git fetch --quiet origin "${REPO_BRANCH}"
    git reset --hard "origin/${REPO_BRANCH}" || git pull --ff-only
  else
    log "Cloning repository..."
    # If the target dir has temporary files, clone to temporary folder and move into place
    local temp_clone
    temp_clone=$(mktemp -d)
    git clone --depth=1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${temp_clone}"
    
    # Copy .git and files into TARGET_DIR preserving any pre-existing local files
    cp -a "${temp_clone}/." "${TARGET_DIR}/"
    rm -rf "${temp_clone}"
    git config --global --add safe.directory "${TARGET_DIR}" || true
  fi

  log "Repository files synchronized successfully."
}

# ------------------------------------------------------------------------------
# 5. Sync External Monitoring Tools (zbxwmi upstream)
# ------------------------------------------------------------------------------
sync_external_tools() {
  log "Synchronizing external monitoring script (zbxwmi) from upstream..."
  local zbxwmi_dest="${EXTERNALSCRIPTS_DIR}/zbxwmi"
  local temp_zbxwmi
  temp_zbxwmi=$(mktemp)

  if curl -fsSL --connect-timeout 5 --max-time 10 "${ZBXWMI_URL}" -o "${temp_zbxwmi}"; then
    mv "${temp_zbxwmi}" "${zbxwmi_dest}"
    chmod +x "${zbxwmi_dest}"
    log "zbxwmi successfully synchronized to ${zbxwmi_dest}."
  else
    rm -f "${temp_zbxwmi}"
    if [[ -f "${zbxwmi_dest}" ]]; then
      chmod +x "${zbxwmi_dest}"
      log "WARNING: Could not fetch remote zbxwmi; keeping existing local copy."
    else
      log_error "Failed to download zbxwmi from ${ZBXWMI_URL}."
      exit 1
    fi
  fi
}

# ------------------------------------------------------------------------------
# 6. Set Permissions
# ------------------------------------------------------------------------------
set_permissions() {
  log "Setting script permissions..."

  # Executable permissions for host system scripts
  if compgen -G "${SCRIPTS_DIR}/*.sh" > /dev/null; then
    chmod +x "${SCRIPTS_DIR}"/*.sh
  fi

  # Executable permissions for monitoring external scripts
  if [[ -d "${EXTERNALSCRIPTS_DIR}" ]]; then
    find "${EXTERNALSCRIPTS_DIR}" -type f -exec chmod +x {} + 2>/dev/null || true
  fi
}

# ------------------------------------------------------------------------------
# 6. Setup Log Rotation
# ------------------------------------------------------------------------------
setup_logrotate() {
  log "Configuring logrotate for /var/log/zabbix-scripts..."
  cat <<'EOF' > /etc/logrotate.d/zabbix-scripts
/var/log/zabbix-scripts/*.log {
    weekly
    rotate 4
    size 10M
    compress
    missingok
    notifempty
    copytruncate
}
EOF
  chmod 0644 /etc/logrotate.d/zabbix-scripts
}

# ------------------------------------------------------------------------------
# 7. Setup Automated Hourly Pull (Systemd Timer with Cron Fallback)
# ------------------------------------------------------------------------------
setup_hourly_updater() {
  log "Configuring automated hourly update service..."

  # Check if systemd is active
  if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1 || [[ -d /run/systemd/system ]]; then
    log "Configuring systemd service and timer for hourly updates..."

    # Systemd Service definition
    cat <<EOF > /etc/systemd/system/zabbix-scripts-update.service
[Unit]
Description=Zabbix Scripts Hourly Git Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
ExecStart=${SCRIPTS_DIR}/update.sh
StandardOutput=null
StandardError=journal
EOF

    # Systemd Timer definition (triggers hourly with a small random jitter to prevent spikes)
    cat <<EOF > /etc/systemd/system/zabbix-scripts-update.timer
[Unit]
Description=Run Zabbix Scripts Git Update hourly

[Timer]
OnCalendar=hourly
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
EOF

    systemctl daemon-reload
    systemctl enable --now zabbix-scripts-update.timer
    log "Systemd timer zabbix-scripts-update.timer enabled and started."
  else
    log "Systemd not detected or inactive. Configuring /etc/cron.d/zabbix-scripts-update as fallback..."
    cat <<EOF > /etc/cron.d/zabbix-scripts-update
# Hourly update for Zabbix Scripts
0 * * * * root ${SCRIPTS_DIR}/update.sh >/dev/null 2>&1
EOF
    chmod 0644 /etc/cron.d/zabbix-scripts-update
    log "Cron fallback configured."
  fi
}

# ------------------------------------------------------------------------------
# 8. Placeholders for Upcoming Capabilities
# ------------------------------------------------------------------------------
# Helper function to validate IPv4
validate_ipv4() {
  local ip=$1
  if [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  else
    return 1
  fi
}

setup_docker_environment() {
  log "Configuring Docker environment and Wireguard..."

  # Ensure Wireguard config directory exists
  local wg_dir="/var/lib/docker/wireguard/config/wg_confs"
  mkdir -p "${wg_dir}"

  # Prompt for Wireguard Private Key
  read -p "Enter the Wireguard Private Key: " wg_privkey < /dev/tty

  # Prompt for Wireguard Private IP Address
  local wg_ip
  while true; do
    read -p "Enter the Wireguard Private IP Address: " wg_ip < /dev/tty
    if validate_ipv4 "$wg_ip"; then break; fi
    echo "Invalid format. Please enter an IPv4 dot notation."
  done

  # Prompt for remote Wireguard Public Key
  read -p "Enter the remote Wireguard Public Key: " wg_pubkey < /dev/tty

  # Prompt for remote Wireguard Public hostname
  read -p "Enter the remote Wireguard Public hostname: " remote_wg_host < /dev/tty

  # Prompt for remote Wireguard Private Assigned IP
  local allowed_ips
  while true; do
    read -p "Enter the remote Wireguard Private Assigned IP: " allowed_ips < /dev/tty
    if validate_ipv4 "$allowed_ips"; then break; fi
    echo "Invalid format. Please enter an IPv4 dot notation."
  done

  # Prompt for Zabbix Hostname
  read -p "Enter Client-Site Code: " zabbix_hostname < /dev/tty

  # Prompt for Remote Zabbix IP address
  local zabbix_ip
  while true; do
    read -p "Enter Remote Zabbix IP address: " zabbix_ip < /dev/tty
    if validate_ipv4 "$zabbix_ip"; then break; fi
    echo "Invalid format. Please enter an IPv4 dot notation."
  done

  # Create wg0.conf
  local wg_conf="${wg_dir}/wg0.conf"
  cat <<EOF > "${wg_conf}"
[Interface]
PrivateKey = ${wg_privkey}
Address = ${wg_ip}

[Peer]
PublicKey = ${wg_pubkey}
Endpoint = ${remote_wg_host}:51820
AllowedIPs = ${allowed_ips}
PersistentKeepalive = 25
EOF
  log "Created ${wg_conf}"

  # Create .env
  local env_file="${DOCKER_DIR}/.env"
  cat <<EOF > "${env_file}"
ZBXNAME=${zabbix_hostname}
ZBXIP=${zabbix_ip}
EOF
  log "Created ${env_file}"
}

setup_credentials() {
  log "Configuring Windows domain credentials..."

  read -p "Enter the Zabbix user Active Directory Username: " ad_username < /dev/tty
  read -p "Enter the Zabbix user Active Directory Password: " ad_password < /dev/tty
  read -p "Enter the Active Directory Domain Name: " ad_domain < /dev/tty

  local wmi_dir="${TARGET_DIR}/etc"
  local wmi_pw="${wmi_dir}/wmi.pw"

  mkdir -p "${wmi_dir}"

  cat <<EOF > "${wmi_pw}"
${ad_username}
${ad_password}
${ad_domain}
EOF

  chmod 640 "${wmi_pw}"
  chown 1997:1995 "${wmi_pw}"

  log "Credentials saved to ${wmi_pw}"
}

# ------------------------------------------------------------------------------
# Main Execution Flow
# ------------------------------------------------------------------------------
main() {
  log "=========================================================="
  log " Starting ScottVCORP/Zabbix-Scripts Bootstrap Installer   "
  log "=========================================================="

  check_privileges
  install_prerequisites
  initialize_directories
  sync_repository
  sync_external_tools
  set_permissions
  setup_logrotate
  setup_hourly_updater

  # Future hooks (prepared for upcoming instructions)
  setup_docker_environment
  setup_credentials

  log "=========================================================="
  log " Bootstrap complete! Zabbix environment initialized at ${TARGET_DIR}"
  log " Automatic hourly update timer is active."
  log " Logs available at ${LOG_DIR}"
  log "=========================================================="
}

main "$@"

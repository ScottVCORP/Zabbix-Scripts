#!/usr/bin/env bash
# ==============================================================================
# Script: scripts/update.sh
# Purpose: Hourly updater for ScottVCORP/Zabbix-Scripts repository
# Host Path: /opt/zabbix/scripts/update.sh
# ==============================================================================

set -euo pipefail

REPO_DIR="/opt/zabbix"
LOG_DIR="/var/log/zabbix-scripts"
LOG_FILE="${LOG_DIR}/update.log"

# Ensure log directory exists
mkdir -p "${LOG_DIR}"

log_msg() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${LOG_FILE}"
}

# Verify repository directory exists
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log_msg "ERROR: Git repository not found at ${REPO_DIR}"
  exit 1
fi

# Fetch and fast-forward pull from origin
log_msg "Starting hourly update check..."
cd "${REPO_DIR}"

# Fetch updates with 10-second network timeout
if git fetch --quiet --timeout=10 origin; then
  LOCAL_HASH=$(git rev-parse HEAD)
  REMOTE_HASH=$(git rev-parse @{u} 2>/dev/null || echo "$LOCAL_HASH")

  if [[ "$LOCAL_HASH" != "$REMOTE_HASH" ]]; then
    log_msg "New changes detected. Pulling changes (HEAD: ${LOCAL_HASH} -> ${REMOTE_HASH})..."
    git pull --quiet --ff-only origin main || git pull --quiet --ff-only

    # Re-apply executable permissions on all host scripts
    chmod +x "${REPO_DIR}/scripts/"*.sh 2>/dev/null || true

    # Re-apply executable permissions on all externalscripts
    if [[ -d "${REPO_DIR}/externalscripts" ]]; then
      find "${REPO_DIR}/externalscripts" -type f -exec chmod +x {} + 2>/dev/null || true
    fi

    log_msg "Update successfully applied."
  else
    log_msg "Repository is already up to date."
  fi
else
  log_msg "WARNING: Failed to fetch updates from remote origin (network timeout or offline)."
  exit 1
fi

# ------------------------------------------------------------------------------
# Check and update zbxwmi external script from upstream repository
# ------------------------------------------------------------------------------
ZBXWMI_URL="https://raw.githubusercontent.com/13hakta/zbxwmi/master/zbxwmi"
ZBXWMI_DEST="${REPO_DIR}/externalscripts/zbxwmi"
TMP_ZBXWMI=$(mktemp)

if curl -fsSL --connect-timeout 5 --max-time 10 "${ZBXWMI_URL}" -o "${TMP_ZBXWMI}"; then
  if [[ ! -f "${ZBXWMI_DEST}" ]] || ! cmp -s "${TMP_ZBXWMI}" "${ZBXWMI_DEST}"; then
    mv "${TMP_ZBXWMI}" "${ZBXWMI_DEST}"
    chmod +x "${ZBXWMI_DEST}"
    log_msg "Updated zbxwmi to latest upstream version."
  else
    rm -f "${TMP_ZBXWMI}"
  fi
else
  rm -f "${TMP_ZBXWMI}"
  log_msg "WARNING: Failed to fetch zbxwmi from upstream (timeout or offline)."
fi

# Ensure executable permissions
chmod +x "${ZBXWMI_DEST}" 2>/dev/null || true

exit 0

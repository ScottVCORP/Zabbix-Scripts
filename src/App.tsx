import React, { useState } from 'react';
import { 
  Terminal, 
  Copy, 
  Check, 
  Clock, 
  FolderTree, 
  FileCode, 
  Shield, 
  RotateCcw, 
  Server, 
  ExternalLink,
  ChevronRight,
  HardDrive
} from 'lucide-react';

interface ScriptItem {
  path: string;
  targetPath: string;
  summary: string;
  permissions: string;
  testingCommand: string;
  code: string;
}

const INSTALL_SCRIPT = `#!/usr/bin/env bash
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
SCRIPTS_DIR="\${TARGET_DIR}/scripts"
DOCKER_DIR="\${TARGET_DIR}/docker"
EXTERNALSCRIPTS_DIR="\${TARGET_DIR}/externalscripts"
LOG_DIR="/var/log/zabbix-scripts"
INSTALL_LOG="\${LOG_DIR}/install.log"

# Prepare logging
mkdir -p "\${LOG_DIR}"
touch "\${INSTALL_LOG}"

log() {
  local msg="[\$(date '+%Y-%m-%d %H:%M:%S')] \$*"
  echo "\$msg" | tee -a "\${INSTALL_LOG}"
}

log_error() {
  local msg="[\$(date '+%Y-%m-%d %H:%M:%S')] ERROR: \$*"
  echo "\$msg" >&2
  echo "\$msg" >> "\${INSTALL_LOG}"
}

# 1. Root Privileges Check
check_privileges() {
  if [[ "\${EUID}" -ne 0 ]]; then
    log_error "This script must be executed as root (or with sudo)."
    exit 1
  fi
}

# 2. Debian Package Prerequisites
install_prerequisites() {
  log "Verifying Debian system dependencies..."
  local missing_pkgs=()
  for pkg in git curl ca-certificates logrotate; do
    if ! dpkg -s "\${pkg}" >/dev/null 2>&1; then
      missing_pkgs+=("\${pkg}")
    fi
  done

  if [[ \${#missing_pkgs[@]} -gt 0 ]]; then
    log "Installing missing prerequisites: \${missing_pkgs[*]}..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends "\${missing_pkgs[@]}"
    log "Prerequisites installed successfully."
  else
    log "All baseline Debian packages are installed."
  fi
}

# 3. Directory Layout Initialization
initialize_directories() {
  log "Initializing directory structure under \${TARGET_DIR}..."
  mkdir -p "\${SCRIPTS_DIR}"
  mkdir -p "\${DOCKER_DIR}"
  mkdir -p "\${EXTERNALSCRIPTS_DIR}"
  mkdir -p "\${LOG_DIR}"
}

# 4. Clone or Update GitHub Repository
sync_repository() {
  log "Syncing repository from \${REPO_URL} into \${TARGET_DIR}..."

  if [[ -d "\${TARGET_DIR}/.git" ]]; then
    log "Existing git repository found at \${TARGET_DIR}. Updating..."
    cd "\${TARGET_DIR}"
    git config --global --add safe.directory "\${TARGET_DIR}" || true
    git fetch --quiet --depth=1 origin "\${REPO_BRANCH}" || git fetch --quiet origin "\${REPO_BRANCH}"
    git reset --hard "origin/\${REPO_BRANCH}" || git pull --ff-only
  else
    log "Cloning repository..."
    local temp_clone
    temp_clone=\$(mktemp -d)
    git clone --depth=1 --branch "\${REPO_BRANCH}" "\${REPO_URL}" "\${temp_clone}"
    cp -a "\${temp_clone}/." "\${TARGET_DIR}/"
    rm -rf "\${temp_clone}"
    git config --global --add safe.directory "\${TARGET_DIR}" || true
  fi
  log "Repository files synchronized successfully."
}

# 5. Sync External Monitoring Tools (zbxwmi upstream)
sync_external_tools() {
  log "Synchronizing external monitoring script (zbxwmi) from upstream..."
  local zbxwmi_dest="\${EXTERNALSCRIPTS_DIR}/zbxwmi"
  local temp_zbxwmi
  temp_zbxwmi=\$(mktemp)

  if curl -fsSL --connect-timeout 5 --max-time 10 "\${ZBXWMI_URL}" -o "\${temp_zbxwmi}"; then
    mv "\${temp_zbxwmi}" "\${zbxwmi_dest}"
    chmod +x "\${zbxwmi_dest}"
    log "zbxwmi successfully synchronized to \${zbxwmi_dest}."
  else
    rm -f "\${temp_zbxwmi}"
    if [[ -f "\${zbxwmi_dest}" ]]; then
      chmod +x "\${zbxwmi_dest}"
      log "WARNING: Could not fetch remote zbxwmi; keeping existing local copy."
    else
      log_error "Failed to download zbxwmi from \${ZBXWMI_URL}."
      exit 1
    fi
  fi
}

# 6. Set Permissions
set_permissions() {
  log "Setting script permissions..."
  if compgen -G "\${SCRIPTS_DIR}/*.sh" > /dev/null; then
    chmod +x "\${SCRIPTS_DIR}"/*.sh
  fi
  if [[ -d "\${EXTERNALSCRIPTS_DIR}" ]]; then
    find "\${EXTERNALSCRIPTS_DIR}" -type f -exec chmod +x {} + 2>/dev/null || true
  fi
}

# 7. Setup Log Rotation
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

# 8. Setup Automated Hourly Pull
setup_hourly_updater() {
  log "Configuring automated hourly update service..."
  if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1 || [[ -d /run/systemd/system ]]; then
    cat <<EOF > /etc/systemd/system/zabbix-scripts-update.service
[Unit]
Description=Zabbix Scripts Hourly Git Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
ExecStart=\${SCRIPTS_DIR}/update.sh
StandardOutput=null
StandardError=journal
EOF

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
    cat <<EOF > /etc/cron.d/zabbix-scripts-update
0 * * * * root \${SCRIPTS_DIR}/update.sh >/dev/null 2>&1
EOF
    chmod 0644 /etc/cron.d/zabbix-scripts-update
    log "Cron fallback configured."
  fi
}

# 9. Modular stubs prepared for upcoming steps
setup_docker_environment() {
  log "Docker environment hook prepared."
}

setup_credentials() {
  log "Credentials setup hook prepared."
}

main() {
  log "Starting ScottVCORP/Zabbix-Scripts Bootstrap Installer"
  check_privileges
  install_prerequisites
  initialize_directories
  sync_repository
  sync_external_tools
  set_permissions
  setup_logrotate
  setup_hourly_updater
  setup_docker_environment
  setup_credentials
  log "Bootstrap complete! Zabbix environment initialized at \${TARGET_DIR}"
}

main "$@"`;

const UPDATE_SCRIPT = `#!/usr/bin/env bash
# ==============================================================================
# Script: scripts/update.sh
# Purpose: Hourly updater for ScottVCORP/Zabbix-Scripts repository
# Host Path: /opt/zabbix/scripts/update.sh
# ==============================================================================

set -euo pipefail

REPO_DIR="/opt/zabbix"
LOG_DIR="/var/log/zabbix-scripts"
LOG_FILE="\${LOG_DIR}/update.log"

mkdir -p "\${LOG_DIR}"

log_msg() {
  echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$*" >> "\${LOG_FILE}"
}

if [[ ! -d "\${REPO_DIR}/.git" ]]; then
  log_msg "ERROR: Git repository not found at \${REPO_DIR}"
  exit 1
fi

log_msg "Starting hourly update check..."
cd "\${REPO_DIR}"

if git fetch --quiet --timeout=10 origin; then
  LOCAL_HASH=\$(git rev-parse HEAD)
  REMOTE_HASH=\$(git rev-parse @{u} 2>/dev/null || echo "\$LOCAL_HASH")

  if [[ "\$LOCAL_HASH" != "\$REMOTE_HASH" ]]; then
    log_msg "New changes detected. Pulling changes (HEAD: \${LOCAL_HASH} -> \${REMOTE_HASH})..."
    git pull --quiet --ff-only origin main || git pull --quiet --ff-only
    chmod +x "\${REPO_DIR}/scripts/"*.sh 2>/dev/null || true
    if [[ -d "\${REPO_DIR}/externalscripts" ]]; then
      find "\${REPO_DIR}/externalscripts" -type f -exec chmod +x {} + 2>/dev/null || true
    fi
    log_msg "Update successfully applied."
  else
    log_msg "Repository is already up to date."
  fi
else
  log_msg "WARNING: Failed to fetch updates from remote origin (network timeout or offline)."
  exit 1
fi

# Check and update zbxwmi external script from upstream repository
ZBXWMI_URL="https://raw.githubusercontent.com/13hakta/zbxwmi/master/zbxwmi"
ZBXWMI_DEST="\${REPO_DIR}/externalscripts/zbxwmi"
TMP_ZBXWMI=\$(mktemp)

if curl -fsSL --connect-timeout 5 --max-time 10 "\${ZBXWMI_URL}" -o "\${TMP_ZBXWMI}"; then
  if [[ ! -f "\${ZBXWMI_DEST}" ]] || ! cmp -s "\${TMP_ZBXWMI}" "\${ZBXWMI_DEST}"; then
    mv "\${TMP_ZBXWMI}" "\${ZBXWMI_DEST}"
    chmod +x "\${ZBXWMI_DEST}"
    log_msg "Updated zbxwmi to latest upstream version."
  else
    rm -f "\${TMP_ZBXWMI}"
  fi
else
  rm -f "\${TMP_ZBXWMI}"
  log_msg "WARNING: Failed to fetch zbxwmi from upstream (timeout or offline)."
fi

chmod +x "\${ZBXWMI_DEST}" 2>/dev/null || true
exit 0`;

const DOCKERFILE_CONTENT = `# ==============================================================================
# Target Path: docker/Dockerfile
# Purpose: Custom Zabbix Proxy image with Python3 and Impacket for zbxwmi
# ==============================================================================

FROM zabbix/zabbix-proxy-sqlite3:ubuntu-latest

USER root

# Install Python3, pip, and impacket dependencies
RUN apt-get update && \\
    apt-get install -y --no-install-recommends \\
        python3 \\
        python3-pip \\
        python3-impacket \\
        ca-certificates && \\
    apt-get clean && \\
    rm -rf /var/lib/apt/lists/*

USER zabbix`;

const ZBXWMI_SNIPPET = `#!/usr/bin/env python3
# zbxwmi : discovery and bulk checks of WMI items with Zabbix
# Source: https://github.com/13hakta/zbxwmi/blob/master/zbxwmi
# Requires impacket (python pkg) and optionally zabbix_sender
# Target Host Path: /opt/zabbix/externalscripts/zbxwmi
# Target Container Path: /usr/lib/zabbix/externalscripts/zbxwmi

import argparse, sys, os
# ... (Full 286-line script synced into /opt/zabbix/externalscripts/zbxwmi)`;

const TEST_SCRIPT = `#!/usr/bin/env bash
# ==============================================================================
# Script: tests/test_scripts.sh
# Purpose: Test and validation runner for ScottVCORP/Zabbix-Scripts (Jules & CI)
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Running Automated Validation for ScottVCORP/Zabbix-Scripts"
echo "=========================================================="

FAILED=0

# 1. Syntax check for bash scripts
echo "[TEST] Validating bash syntax..."
for script in scripts/install.sh scripts/update.sh tests/test_scripts.sh; do
  if [[ -f "$script" ]]; then
    if bash -n "$script"; then
      echo "  [PASS] $script syntax valid"
    else
      echo "  [FAIL] $script syntax error" >&2
      FAILED=$((FAILED + 1))
    fi
  fi
done

# 2. Syntax check for Python scripts
echo "[TEST] Validating Python script compilation..."
for py_script in externalscripts/zbxwmi; do
  if [[ -f "$py_script" ]]; then
    if python3 -m py_compile "$py_script"; then
      echo "  [PASS] $py_script compiled cleanly"
    else
      echo "  [FAIL] $py_script compilation failed" >&2
      FAILED=$((FAILED + 1))
    fi
  fi
done

# 3. Check execute permissions
echo "[TEST] Verifying executable permissions..."
for exec_file in scripts/install.sh scripts/update.sh externalscripts/zbxwmi tests/test_scripts.sh; do
  if [[ -f "$exec_file" ]]; then
    if [[ -x "$exec_file" ]]; then
      echo "  [PASS] $exec_file is executable"
    else
      echo "  [WARN] $exec_file missing execute bit, fixing..."
      chmod +x "$exec_file"
    fi
  fi
done

# 4. Check critical files existence
echo "[TEST] Verifying required repository assets..."
for req in README.md docker/Dockerfile externalscripts/zbxwmi scripts/install.sh scripts/update.sh; do
  if [[ -f "$req" ]]; then
    echo "  [PASS] $req exists"
  else
    echo "  [FAIL] $req missing!" >&2
    FAILED=$((FAILED + 1))
  fi
done

if [[ "$FAILED" -eq 0 ]]; then
  echo " ALL TESTS PASSED SUCCESSFULLY"
  exit 0
else
  echo " $FAILED TEST(S) FAILED" >&2
  exit 1
fi`;

export default function App() {
  const [selectedScript, setSelectedScript] = useState<'install' | 'update' | 'zbxwmi' | 'dockerfile' | 'tests'>('install');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const scripts: Record<'install' | 'update' | 'zbxwmi' | 'dockerfile' | 'tests', ScriptItem> = {
    install: {
      path: 'scripts/install.sh',
      targetPath: '/opt/zabbix/scripts/install.sh',
      summary: 'Bootstrap installer that provisions Debian dependencies, clones ScottVCORP/Zabbix-Scripts, synchronizes zbxwmi, and schedules hourly updates.',
      permissions: 'chmod +x /opt/zabbix/scripts/install.sh',
      testingCommand: 'sudo /opt/zabbix/scripts/install.sh',
      code: INSTALL_SCRIPT,
    },
    update: {
      path: 'scripts/update.sh',
      targetPath: '/opt/zabbix/scripts/update.sh',
      summary: 'Hourly update script triggered by systemd timer or cron to silently pull git changes and auto-update externalscripts/zbxwmi with timeout protection.',
      permissions: 'chmod +x /opt/zabbix/scripts/update.sh',
      testingCommand: 'sudo /opt/zabbix/scripts/update.sh && sudo tail -n 10 /var/log/zabbix-scripts/update.log',
      code: UPDATE_SCRIPT,
    },
    zbxwmi: {
      path: 'externalscripts/zbxwmi',
      targetPath: '/opt/zabbix/externalscripts/zbxwmi',
      summary: 'High-performance agentless WMI discovery and metrics connector for Windows hosts (queried via impacket, output formatted for Zabbix LLD / bulk sender).',
      permissions: 'chmod +x /opt/zabbix/externalscripts/zbxwmi',
      testingCommand: '/opt/zabbix/externalscripts/zbxwmi Win32_OperatingSystem 192.168.1.10 -cred /etc/zabbix/wmi.pw -action get -fields Caption',
      code: ZBXWMI_SNIPPET,
    },
    dockerfile: {
      path: 'docker/Dockerfile',
      targetPath: '/opt/zabbix/docker/Dockerfile',
      summary: 'Container build definition extending zabbix-proxy-sqlite3 to bake in python3, python3-pip, and python3-impacket for zbxwmi execution.',
      permissions: 'chmod 0644 /opt/zabbix/docker/Dockerfile',
      testingCommand: 'docker build -t zabbix-proxy-custom:latest /opt/zabbix/docker/',
      code: DOCKERFILE_CONTENT,
    },
    tests: {
      path: 'tests/test_scripts.sh',
      targetPath: '/opt/zabbix/tests/test_scripts.sh',
      summary: 'Automated test suite used by Jules (jules.google.com) and CI to validate script syntax, python compilation, and execute permissions.',
      permissions: 'chmod +x tests/test_scripts.sh',
      testingCommand: './tests/test_scripts.sh',
      code: TEST_SCRIPT,
    },
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const oneLiner = `curl -fsSL https://raw.githubusercontent.com/ScottVCORP/Zabbix-Scripts/main/scripts/install.sh | sudo bash`;
  const gitPushCommand = `git clone https://github.com/ScottVCORP/Zabbix-Scripts.git zabbix-repo\ncd zabbix-repo\ntar -xzvf ../export/zabbix-scripts.tar.gz\ngit add .\ngit commit -m "Bootstrap Zabbix Proxy scripts and tests for Jules"\ngit push origin main`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-red-950 selection:text-red-200">
      {/* Top Banner */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center font-black tracking-tight text-white shadow-lg shadow-red-950/40">
            Z
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight">ScottVCORP / Zabbix-Scripts</h1>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                Debian Host
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Containerized Zabbix Proxy Automation, External Scripts & Jules CI Validation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <a
            href="https://github.com/ScottVCORP/Zabbix-Scripts"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            GitHub Repository
          </a>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Root: /opt/zabbix
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Jules Migration & Export Panel */}
        <section className="p-5 rounded-xl bg-gradient-to-r from-blue-950/40 via-zinc-900/80 to-purple-950/30 border border-blue-900/60 shadow-xl space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                J
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  Jules (jules.google.com) Project Export & Sync
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-1.5 py-0.2 rounded font-normal">
                    Ready to Test
                  </span>
                </h2>
                <p className="text-xs text-zinc-400">
                  Target repo: <a href="https://github.com/ScottVCORP/Zabbix-Scripts" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">ScottVCORP/Zabbix-Scripts</a>. Connect this repo in Jules to test all bash & python scripts in automated isolated sandbox tasks.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/export/zabbix-scripts.tar.gz"
                download="zabbix-scripts.tar.gz"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition shadow-md shadow-blue-950/40"
              >
                <HardDrive className="w-3.5 h-3.5" />
                Download Export (tar.gz)
              </a>
            </div>
          </div>

          <div className="p-3 bg-zinc-950/80 rounded-lg border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">Push to GitHub to allow Jules testing:</span>
              <button
                onClick={() => copyToClipboard(gitPushCommand, 'gitpush')}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] transition cursor-pointer"
              >
                {copiedKey === 'gitpush' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied Git Commands</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Push Commands</span>
                  </>
                )}
              </button>
            </div>
            <pre className="text-xs font-mono text-zinc-300 bg-zinc-900/90 p-2.5 rounded border border-zinc-800/80 overflow-x-auto">
              <code>{gitPushCommand}</code>
            </pre>
          </div>
        </section>

        {/* Quick Start Installation Command */}
        <section className="p-5 rounded-xl bg-zinc-900/80 border border-zinc-800 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-red-500" />
              <h2 className="text-sm font-semibold text-zinc-200">
                Fresh Debian Bootstrap Command
              </h2>
            </div>
            <span className="text-xs text-zinc-500">Executes directly on fresh Debian node</span>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 bg-zinc-950 rounded-lg border border-zinc-800/80 font-mono text-xs text-zinc-300 overflow-x-auto">
            <span className="select-all break-all">{oneLiner}</span>
            <button
              onClick={() => copyToClipboard(oneLiner, 'oneliner')}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition text-xs shrink-0 cursor-pointer"
            >
              {copiedKey === 'oneliner' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* System Architecture Overview Cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-medium text-xs">
              <FolderTree className="w-4 h-4 text-amber-500" />
              Host Filesystem Tree
            </div>
            <div className="text-xs font-mono text-zinc-400 space-y-1 bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-900">
              <div className="text-zinc-200 font-semibold">/opt/zabbix/</div>
              <div className="pl-3 text-emerald-400">├── scripts/ <span className="text-zinc-600">(install & updates)</span></div>
              <div className="pl-3 text-blue-400">├── docker/ <span className="text-zinc-600">(compose & env)</span></div>
              <div className="pl-3 text-amber-400">└── externalscripts/ <span className="text-zinc-600">(bind-mount :ro)</span></div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-medium text-xs">
              <Clock className="w-4 h-4 text-blue-500" />
              Hourly Auto-Sync Schedule
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Systemd timer (<code className="text-zinc-300">zabbix-scripts-update.timer</code>) triggers hourly with random jitter to pull latest Git commits quietly without interrupting proxy operations.
            </p>
            <div className="text-[11px] font-mono text-zinc-500">
              Fallback: <code className="text-zinc-400">/etc/cron.d/zabbix-scripts-update</code>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-medium text-xs">
              <RotateCcw className="w-4 h-4 text-emerald-500" />
              Quiet Logging & Logrotate
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Target logs in <code className="text-zinc-300">/var/log/zabbix-scripts/</code> managed by <code className="text-zinc-300">/etc/logrotate.d/zabbix-scripts</code> to prevent unbounded disk usage.
            </p>
            <div className="text-[11px] font-mono text-zinc-500">
              Policy: Weekly, 10MB limit, 4 rotations, compressed
            </div>
          </div>
        </section>

        {/* Script Viewer & Deliverables */}
        <section className="rounded-xl bg-zinc-900/50 border border-zinc-800 overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedScript('install')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  selectedScript === 'install'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                scripts/install.sh
              </button>
              <button
                onClick={() => setSelectedScript('update')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  selectedScript === 'update'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                scripts/update.sh
              </button>
              <button
                onClick={() => setSelectedScript('zbxwmi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  selectedScript === 'zbxwmi'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                externalscripts/zbxwmi
              </button>
              <button
                onClick={() => setSelectedScript('dockerfile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  selectedScript === 'dockerfile'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                docker/Dockerfile
              </button>
              <button
                onClick={() => setSelectedScript('tests')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  selectedScript === 'tests'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                tests/test_scripts.sh
              </button>
            </div>

            <button
              onClick={() => copyToClipboard(scripts[selectedScript].code, selectedScript)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition cursor-pointer"
            >
              {copiedKey === selectedScript ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied Script</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          {/* Details header */}
          <div className="p-4 bg-zinc-950/70 border-b border-zinc-800/80 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-zinc-500 block mb-0.5">Target Path</span>
              <code className="text-amber-400 font-mono font-medium">{scripts[selectedScript].targetPath}</code>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5">Host Permissions</span>
              <code className="text-emerald-400 font-mono font-medium">{scripts[selectedScript].permissions}</code>
            </div>
            <div>
              <span className="text-zinc-500 block mb-0.5">Testing Command</span>
              <code className="text-zinc-300 font-mono font-medium truncate block">{scripts[selectedScript].testingCommand}</code>
            </div>
          </div>

          {/* Summary description */}
          <div className="px-4 py-2.5 bg-zinc-900/30 border-b border-zinc-800 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">Summary:</span> {scripts[selectedScript].summary}
          </div>

          {/* Code Body */}
          <div className="p-4 bg-zinc-950 overflow-x-auto max-h-[500px]">
            <pre className="font-mono text-xs text-zinc-300 leading-relaxed">
              <code>{scripts[selectedScript].code}</code>
            </pre>
          </div>
        </section>

        {/* Upcoming Stages Ready for Extension */}
        <section className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <ChevronRight className="w-4 h-4 text-red-500" />
            Modular Stubs Ready for Upcoming Instructions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-zinc-400">
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
              <span className="font-medium text-zinc-200 block mb-1">Docker Compose & Environment</span>
              <code className="text-zinc-500 block font-mono mb-1">setup_docker_environment()</code>
              Scaffolding prepared to generate <code className="text-zinc-300">docker-compose.yml</code>, <code className="text-zinc-300">.env</code>, and customized proxy Dockerfile.
            </div>
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
              <span className="font-medium text-zinc-200 block mb-1">Windows Domain Credentials</span>
              <code className="text-zinc-500 block font-mono mb-1">setup_credentials()</code>
              Stubs prepared to interactively prompt for credentials via terminal and securely generate <code className="text-zinc-300">wmi.pw</code> with strict file permissions.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}



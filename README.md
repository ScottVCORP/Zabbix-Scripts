# ZabbixScripts (`ScottVCORP/Zabbix-Scripts`)

Automated deployment, configuration, and maintenance framework for containerized **Zabbix Proxy** on **Debian Linux**.

Repository URL: [https://github.com/ScottVCORP/Zabbix-Scripts](https://github.com/ScottVCORP/Zabbix-Scripts)  
Target Deployment Root: `/opt/zabbix`

---

## Overview

This repository automates the lifecycle of a containerized Zabbix Proxy running on Debian hosts. It manages:
- System prerequisites and directory layout provisioning.
- Automated hourly synchronization with upstream GitHub releases via `systemd` timers (or `cron`).
- Quiet logging with automated log rotation (`logrotate`).
- Custom external monitoring scripts mounted directly into the container runtime.
- Docker environment initialization and container orchestration.

---

## Architecture & Directory Layout

The host environment is organized under `/opt/zabbix`:

```text
/opt/zabbix/
├── scripts/              # Host-level management and automation scripts
│   ├── install.sh        # Bootstrap installer for fresh Debian deployments
│   └── update.sh         # Hourly background updater triggered by systemd/cron
├── docker/               # Container orchestration and runtime files
│   ├── Dockerfile        # Custom Zabbix Proxy container build definition
│   ├── docker-compose.yml # Compose service definition for the proxy stack
│   └── .env              # Environment variables and connection settings
├── externalscripts/      # Custom Zabbix monitoring check scripts
│   ├── zbxwmi            # Windows WMI agentless connector
│   └── ...               # Bind-mounted read-only to /usr/lib/zabbix/externalscripts:ro
├── tests/                # Automated validation tests (Jules & CI)
│   └── test_scripts.sh   # Syntax and permission test runner
└── README.md             # Project documentation
```

### Additional System Locations
- **Update Logs:** `/var/log/zabbix-scripts/` (`install.log`, `update.log`)
- **Log Rotation Policy:** `/etc/logrotate.d/zabbix-scripts`
- **Systemd Timer & Service:**
  - `/etc/systemd/system/zabbix-scripts-update.timer`
  - `/etc/systemd/system/zabbix-scripts-update.service`

---

## Quick Start & Installation

### Fresh Debian Host Bootstrap

To provision a new Debian node from scratch, run the bootstrap command as `root` (or via `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/ScottVCORP/Zabbix-Scripts/main/scripts/install.sh | sudo bash
```

### Manual Installation

Alternatively, clone and execute locally:

```bash
# 1. Install git if not present
sudo apt-get update && sudo apt-get install -y git curl

# 2. Clone the repository into /opt/zabbix
sudo git clone https://github.com/ScottVCORP/Zabbix-Scripts.git /opt/zabbix

# 3. Grant execute permissions and run the installer
cd /opt/zabbix
sudo chmod +x scripts/*.sh
sudo ./scripts/install.sh
```

---

## Script Overview

### 1. `scripts/install.sh`
* **Path:** `/opt/zabbix/scripts/install.sh`
* **Permissions:** `chmod +x`
* **Purpose:** Initial setup script that:
  - Verifies root privileges.
  - Installs required Debian packages (`git`, `curl`, `ca-certificates`, `logrotate`).
  - Sets up directories (`scripts/`, `docker/`, `externalscripts/`).
  - Clones or fast-forward updates the git repository.
  - Applies executable permissions on all host scripts and external check scripts.
  - Deploys the systemd hourly sync timer (`zabbix-scripts-update.timer`) with a cron fallback.
  - Configures `logrotate` to prevent unbounded log growth.

### 2. `scripts/update.sh`
* **Path:** `/opt/zabbix/scripts/update.sh`
* **Permissions:** `chmod +x`
* **Purpose:** Quiet updater executed every hour. It checks the remote repository with an internal timeout, pulls changes if a new commit exists, updates upstream tools (including `externalscripts/zbxwmi`), reapplies executable permissions, and logs execution to `/var/log/zabbix-scripts/update.log`.

### 3. `externalscripts/zbxwmi`
* **Path:** `/opt/zabbix/externalscripts/zbxwmi` (mounted to `/usr/lib/zabbix/externalscripts/zbxwmi:ro`)
* **Upstream:** `https://github.com/13hakta/zbxwmi`
* **Permissions:** `chmod +x`
* **Purpose:** High-performance agentless WMI discovery and metrics collector for Windows hosts.
* **Auto-update:** Automatically pulled and updated hourly alongside this repository.

---

## Container Dependencies (Dockerfile)

Because `zbxwmi` requires the `impacket` Python library, the Zabbix Proxy container image must include `python3` and `impacket`. The custom image is defined in `docker/Dockerfile`:

```dockerfile
FROM zabbix/zabbix-proxy-sqlite3:ubuntu-latest
USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-impacket \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
USER zabbix
```

---

## Automated Hourly Sync

The updater runs every hour using a systemd timer.

* **Check Timer Status:**
  ```bash
  systemctl list-timers zabbix-scripts-update.timer
  ```

* **Inspect Update Service Logs:**
  ```bash
  sudo tail -n 20 /var/log/zabbix-scripts/update.log
  journalctl -u zabbix-scripts-update.service -n 50 --no-pager
  ```

* **Trigger Manual Update Run:**
  ```bash
  sudo /opt/zabbix/scripts/update.sh
  ```

---

## Zabbix External Script Constraints

All custom monitoring scripts placed in `externalscripts/` must adhere to strict Zabbix execution standards:

1. **Output:** Output **ONLY** the expected single value, text string, or valid Zabbix LLD JSON to `stdout`. Do not emit banners or debug text.
2. **Timeouts:** Zabbix enforces an execution timeout (default 3s to 30s). All network calls (`curl`, sockets, SNMP) must include internal timeouts `< 10s`.
3. **Exit Codes:**
   - Return `0` on success.
   - Return non-zero (`> 0`) on failure.
4. **CLI Arguments:** Parameters must be passed exclusively as positional CLI arguments (`$1`, `$2` or `sys.argv[1]`). Validate arguments immediately and exit with syntax usage on `stderr` if arguments are missing.
5. **Languages & Standards:**
   - **Bash:** Shebang `#!/usr/bin/env bash` with `set -euo pipefail`.
   - **Python:** Shebang `#!/usr/bin/env python3` using Python Standard Library to avoid container package bloat.

---

## Container Runtime & External Scripts Mount

The host folder `/opt/zabbix/externalscripts` is bind-mounted **read-only** into the Zabbix Proxy container:

```yaml
volumes:
  - /opt/zabbix/externalscripts:/usr/lib/zabbix/externalscripts:ro
```

Any scripts committed to `externalscripts/` on GitHub are automatically synced every hour and immediately become available to the containerized Zabbix Proxy.

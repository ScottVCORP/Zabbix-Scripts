# ==============================================================================
# Target Path: docker/Dockerfile
# Purpose: Custom Zabbix Proxy image with Python3 and Impacket for zbxwmi
# ==============================================================================

FROM zabbix/zabbix-proxy-sqlite3:ubuntu-latest

USER root

# Install Python3, pip, and impacket dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-impacket \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

USER zabbix

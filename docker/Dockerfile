# ==============================================================================
# Target Path: docker/Dockerfile
# Purpose: Custom Zabbix Proxy image with Python3 and Impacket for zbxwmi
# ==============================================================================

FROM zabbix/zabbix-proxy-sqlite3:latest

USER root

# Install Python3, pip, and impacket dependencies
RUN  apk add --no-cache \
        python3 \
        py3-pip \
        py3-impacket \
        py3-six \
        py3-asn1 \
        py3-pycryptodome \
        ca-certificates && \

USER zabbix

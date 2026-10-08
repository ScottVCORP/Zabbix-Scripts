# Zabbix External Scripts Directory
This directory is bind-mounted read-only to `/usr/lib/zabbix/externalscripts:ro` on the Zabbix Proxy container.

### Constraints:
- Output ONLY the expected payload to stdout (single value, text string, or valid Zabbix LLD JSON).
- Exit `0` on success, non-zero on failure.
- Hard timeout: All network calls must timeout < 10s.
- Accept parameters strictly via positional CLI arguments (`$1`, `$2`...).
- Scripts must have execute permissions (`chmod +x`).

#!/usr/bin/env bash
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

# 3. Check execute permissions
echo "[TEST] Verifying executable permissions..."
for exec_file in scripts/install.sh scripts/update.sh tests/test_scripts.sh; do
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
for req in README.md docker/Dockerfile scripts/install.sh scripts/update.sh; do
  if [[ -f "$req" ]]; then
    echo "  [PASS] $req exists"
  else
    echo "  [FAIL] $req missing!" >&2
    FAILED=$((FAILED + 1))
  fi
done

echo "=========================================================="
if [[ "$FAILED" -eq 0 ]]; then
  echo " ALL TESTS PASSED SUCCESSFULLY"
  exit 0
else
  echo " $FAILED TEST(S) FAILED" >&2
  exit 1
fi

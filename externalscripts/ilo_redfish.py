#!/usr/bin/env python3
import sys
import os
import json
import ssl
import fcntl
import urllib.request
import urllib.error

if len(sys.argv) < 4:
    print("Usage: ilo_redfish.sh <IP> <USER> <PASSWORD> [IGNORED_ENDPOINT]")
    sys.exit(1)

IP = sys.argv[1]
USER = sys.argv[2]
PASS = sys.argv[3]

TOKEN_FILE = f"/tmp/ilo_token_{IP}"
LOCK_FILE = f"/tmp/ilo_lock_{IP}"
CTX = ssl._create_unverified_context()

# 1. Concurrency Lock
lock_fd = open(LOCK_FILE, "w")
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
except Exception:
    sys.exit(1)

# 2. Session Management
def get_token():
    url = f"https://{IP}/redfish/v1/SessionService/Sessions"
    payload = json.dumps({"UserName": USER, "Password": PASS}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=10) as resp:
            token = resp.headers.get("X-Auth-Token")
            if token:
                with open(TOKEN_FILE, "w") as f:
                    f.write(token.strip())
                return token.strip()
    except Exception:
        return ""
    return ""

def api_get(endpoint, token):
    url = f"https://{IP}{endpoint}"
    req = urllib.request.Request(url, headers={"X-Auth-Token": token})
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")), False
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return None, True
        return None, False
    except Exception:
        return None, False

token = ""
if os.path.exists(TOKEN_FILE):
    with open(TOKEN_FILE, "r") as f:
        token = f.read().strip()

if not token:
    token = get_token()

def query(endpoint):
    global token
    data, unauthorized = api_get(endpoint, token)
    if unauthorized or data is None and not token:
        token = get_token()
        data, _ = api_get(endpoint, token)
    return data

# 3. Fetch Redfish Data
sys_data = query("/redfish/v1/Systems/1")
mgr_data = query("/redfish/v1/Managers/1")
thermal_data = query("/redfish/v1/Chassis/1/Thermal")
power_data = query("/redfish/v1/Chassis/1/Power")

# 4. Construct Expected Template Structure
output = {
    "systems": [sys_data] if sys_data else [],
    "managers": [mgr_data] if mgr_data else [],
    "fans": [],
    "sensors": [],
    "psu": [],
    "storages": [],
    "controllers": [],
    "drives": [],
    "volumes": []
}

chassis_id = "1"

# Map Fans and Inject chassisId
if thermal_data and "Fans" in thermal_data:
    for fan in thermal_data["Fans"]:
        fan["chassisId"] = chassis_id
        output["fans"].append(fan)

# Map Thermal Sensors and Inject chassisId
if thermal_data and "Temperatures" in thermal_data:
    for sensor in thermal_data["Temperatures"]:
        sensor["chassisId"] = chassis_id
        output["sensors"].append(sensor)

# Map Power Supplies and Inject chassisId
if power_data and "PowerSupplies" in power_data:
    for psu in power_data["PowerSupplies"]:
        psu["chassisId"] = chassis_id
        output["psu"].append(psu)

# Map Storage Subsystems
storage_coll = query("/redfish/v1/Systems/1/Storage")
if storage_coll and "Members" in storage_coll:
    for member in storage_coll["Members"]:
        st_url = member.get("@odata.id")
        if not st_url:
            continue
        st_data = query(st_url)
        if not st_data:
            continue
        
        st_id = st_data.get("Id", "")
        sys_id = sys_data.get("Id", "1") if sys_data else "1"
        sys_host = sys_data.get("HostName", "") if sys_data else ""
        sys_type = sys_data.get("SystemType", "") if sys_data else ""

        st_data["systemId"] = sys_id
        st_data["systemHostname"] = sys_host
        st_data["systemType"] = sys_type
        st_data["name"] = st_data.get("Name", st_id)
        output["storages"].append(st_data)

        # Controllers
        for ctrl in st_data.get("StorageControllers", []):
            ctrl["systemId"] = sys_id
            ctrl["systemHostname"] = sys_host
            ctrl["systemType"] = sys_type
            ctrl["storageId"] = st_id
            output["controllers"].append(ctrl)

        # Drives
        for drv in st_data.get("Drives", []):
            if isinstance(drv, dict) and "Id" in drv:
                drv["systemId"] = sys_id
                drv["systemHostname"] = sys_host
                drv["systemType"] = sys_type
                drv["storageId"] = st_id
                output["drives"].append(drv)

        # Volumes
        for vol in st_data.get("Volumes", []):
            if isinstance(vol, dict) and "Id" in vol:
                vol["systemId"] = sys_id
                vol["systemHostname"] = sys_host
                vol["systemType"] = sys_type
                vol["storageId"] = st_id
                output["volumes"].append(vol)

# Output combined payload
print(json.dumps(output))

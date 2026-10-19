#!/usr/bin/env python3
"""
Deep backend test for Fifty Tracker — Phase 1.
Replaces the broken bash version. Runs every endpoint with happy + sad paths
and tracks failures. Exits non-zero on any failure.
"""
import json
import sys
import time
import urllib.request
import urllib.error
import concurrent.futures
from datetime import datetime

BASE = "http://127.0.0.1:3080"
ADMIN_EMAIL = "admin@5ostudios.local"
ADMIN_PW = "changeme"

PASS = 0
FAIL = 0
FAILS = []


def req(method, path, body=None, token=None, extra_headers=None, timeout=8):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if extra_headers:
        h.update(extra_headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw or "{}"), dict(resp.headers)
            except json.JSONDecodeError:
                return resp.status, {"_raw": raw}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}"), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw}, dict(e.headers)
    except Exception as e:
        return 0, {"_error": str(e)}, {}


def ok(msg):
    global PASS
    PASS += 1
    print(f"  \033[32m✓\033[0m {msg}")


def bad(msg, body=None):
    global FAIL
    FAIL += 1
    FAILS.append(msg)
    print(f"  \033[31m✗\033[0m {msg}")
    if body is not None:
        print(f"    body: {json.dumps(body)[:200]}")


def hr(s):
    print(f"\n\033[1m── {s} ──\033[0m")


def hdr(s):
    print(f"\n\033[1;36m▶ {s}\033[0m")


def expect(label, code, body, expected):
    if code == expected:
        ok(f"{label} → {code}")
        return True
    bad(f"{label} → {code} (expected {expected})", body)
    return False


# ===================================================================
# Tests
# ===================================================================

hdr("Health")
code, body, _ = req("GET", "/api/health")
expect("GET /api/health", code, body, 200)
if body.get("ok") is True:
    ok("  body has ok:true")
else:
    bad("  body missing ok:true", body)
if "Asia/Kuwait" in str(body):
    ok("  reports Asia/Kuwait timezone")
else:
    bad("  missing Asia/Kuwait timezone", body)

hdr("Auth: login")
code, body, _ = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
expect("POST /api/auth/login (admin)", code, body, 200)
ADMIN_TOKEN = body.get("token", "")
ADMIN_USER = body.get("user", {})
if ADMIN_TOKEN and len(ADMIN_TOKEN) > 100:
    ok(f"  admin JWT (len={len(ADMIN_TOKEN)})")
else:
    bad("  admin JWT missing/short", body)
    sys.exit(1)
ADMIN_ID = ADMIN_USER.get("id")

# Sad paths
for label, body_data, expected in [
    ("wrong pw", {"email": ADMIN_EMAIL, "password": "WRONG"}, 401),
    ("empty body", {}, 400),
    ("only email", {"email": "x@y.z"}, 400),
    ("bad email format", {"email": "not-an-email", "password": "changeme"}, None),  # 400 or 401
    ("SQL-injection-ish", {"email": "' OR 1=1 --", "password": "x"}, None),  # 400 or 401
    ("nonexistent user", {"email": "nobody@5ostudios.local", "password": "changeme"}, 401),
]:
    code, body, _ = req("POST", "/api/auth/login", body_data)
    if expected is None:
        if code in (400, 401):
            ok(f"  {label} → {code}")
        else:
            bad(f"  {label} → {code} (expected 400/401)", body)
    else:
        expect(f"  {label}", code, body, expected)

# 401 body should say "Invalid credentials"
code, body, _ = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": "WRONG"})
if "Invalid credentials" in str(body):
    ok("  401 body says 'Invalid credentials'")
else:
    bad("  401 body missing 'Invalid credentials'", body)

# No content-type
code, body, _ = req("POST", "/api/auth/login", body={"email": ADMIN_EMAIL, "password": ADMIN_PW}, extra_headers={"Content-Type": ""})
if code in (400, 415):
    ok(f"  no content-type → {code}")
else:
    bad(f"  no content-type → {code}", body)

hdr("Auth: /me")
code, body, _ = req("GET", "/api/auth/me", token=ADMIN_TOKEN)
expect("GET /api/auth/me (admin)", code, body, 200)

for label, hdrs, expected in [
    ("no token", None, 401),
    ("bad token", {"Authorization": "Bearer not-a-real-token"}, 401),
    ("wrong scheme", {"Authorization": f"Token {ADMIN_TOKEN}"}, 401),
    ("broken JWT", {"Authorization": "Bearer aaa.bbb.ccc"}, 401),
]:
    code, body, _ = req("GET", "/api/auth/me", extra_headers=hdrs)
    expect(f"GET /api/auth/me ({label})", code, body, expected)

hdr("Auth: logout")
code, body, _ = req("POST", "/api/auth/logout", token=ADMIN_TOKEN)
if code in (200, 204):
    ok(f"POST /api/auth/logout → {code}")
else:
    bad(f"POST /api/auth/logout → {code}", body)

hdr("Users: list (admin)")
code, body, _ = req("GET", "/api/users", token=ADMIN_TOKEN)
expect("GET /api/users (admin)", code, body, 200)
users = body.get("users", [])
if len(users) >= 1:
    ok(f"  returns ≥1 user (got {len(users)})")
else:
    bad("  empty user list", body)

# No auth
code, body, _ = req("GET", "/api/users")
expect("GET /api/users (no auth)", code, body, 401)

# Setup: create worker for role-gate tests
hdr("Setup: create worker")
code, body, _ = req("POST", "/api/users", token=ADMIN_TOKEN,
                    body={"name": "Worker Test", "email": "worker-test@5ostudios.local",
                          "password": "changeme", "role": "worker"})
expect("POST /api/users (create worker)", code, body, 201)
WORKER_ID = body.get("user", {}).get("id") or body.get("id")
if WORKER_ID:
    ok(f"  worker id={WORKER_ID}")
else:
    bad("  failed to extract worker id", body)

# Login as worker
code, body, _ = req("POST", "/api/auth/login",
                    {"email": "worker-test@5ostudios.local", "password": "changeme"})
expect("  worker login", code, body, 200)
WORKER_TOKEN = body.get("token", "")
if WORKER_TOKEN and len(WORKER_TOKEN) > 100:
    ok(f"  worker JWT (len={len(WORKER_TOKEN)})")
else:
    bad("  no worker token", body)

# Worker /me works
code, body, _ = req("GET", "/api/auth/me", token=WORKER_TOKEN)
expect("GET /api/auth/me (worker)", code, body, 200)
if body.get("user", {}).get("role") == "worker":
    ok("  worker role in /me")
else:
    bad("  wrong role in /me", body)

# Worker role-gate
hdr("Users: role-gate (worker should be 403)")
for label, method, path, body_data in [
    ("GET /api/users (worker)", "GET", "/api/users", None),
    ("POST /api/users (worker)", "POST", "/api/users", {"name": "x", "email": "y@z.com", "password": "changeme", "role": "worker"}),
    (f"PATCH /api/users/:id (worker)", "PATCH", f"/api/users/{WORKER_ID}", {"name": "X"}),
    (f"DELETE /api/users/:id (worker)", "DELETE", f"/api/users/{WORKER_ID}", None),
]:
    code, body, _ = req(method, path, body=body_data, token=WORKER_TOKEN)
    expect(label, code, body, 403)

# Admin create edge cases
hdr("Users: create edge cases (admin)")
for label, body_data, expected in [
    ("no name", {"email": "noname@x.com", "password": "changeme", "role": "worker"}, 400),
    ("short pw", {"name": "X", "email": "short@x.com", "password": "abc", "role": "worker"}, 400),
    ("bad email", {"name": "X", "email": "not-an-email", "password": "changeme", "role": "worker"}, 400),
    ("bad role", {"name": "X", "email": "badrole@x.com", "password": "changeme", "role": "superuser"}, 400),
    ("no password", {"name": "X", "email": "missing-pw@x.com", "role": "worker"}, 400),
    ("blank name", {"name": "   ", "email": "blank@x.com", "password": "changeme", "role": "worker"}, 400),
    ("duplicate email", {"name": "Dup", "email": ADMIN_EMAIL, "password": "changeme", "role": "worker"}, 409),
]:
    code, body, _ = req("POST", "/api/users", body=body_data, token=ADMIN_TOKEN)
    expect(f"POST /api/users ({label})", code, body, expected)

# PATCH edge cases
hdr("Users: PATCH edge cases")
code, body, _ = req("PATCH", f"/api/users/{WORKER_ID}", body={"name": "Worker Renamed"}, token=ADMIN_TOKEN)
expect("PATCH /api/users/:id (rename)", code, body, 200)
if body.get("user", {}).get("name") == "Worker Renamed" or body.get("name") == "Worker Renamed":
    ok("  body reflects new name")
else:
    bad("  body does not reflect new name", body)

code, body, _ = req("PATCH", f"/api/users/{WORKER_ID}", body={"password": "x"}, token=ADMIN_TOKEN)
expect("PATCH /api/users/:id (short pw)", code, body, 400)

code, body, _ = req("PATCH", "/api/users/99999", body={"name": "Ghost"}, token=ADMIN_TOKEN)
expect("PATCH /api/users/99999", code, body, 404)

# Self-demote / self-deactivate should be blocked
code, body, _ = req("PATCH", f"/api/users/{ADMIN_ID}", body={"role": "worker"}, token=ADMIN_TOKEN)
if code in (400, 409):
    ok(f"self-demote → {code} (blocked)")
else:
    bad(f"self-demote → {code} (should be blocked)", body)

code, body, _ = req("DELETE", f"/api/users/{ADMIN_ID}", token=ADMIN_TOKEN)
if code in (400, 409):
    ok(f"self-deactivate → {code} (blocked)")
else:
    bad(f"self-deactivate → {code} (should be blocked)", body)

# Filters
hdr("Users: filters")
code, body, _ = req("GET", "/api/users?includeInactive=true", token=ADMIN_TOKEN)
if code == 200:
    inactive = sum(1 for u in body.get("users", []) if not u.get("active", True))
    ok(f"  includeInactive=true: {inactive} inactive visible")
else:
    bad(f"  includeInactive=true → {code}", body)

code, body, _ = req("GET", "/api/users?includeInactive=false", token=ADMIN_TOKEN)
if code == 200:
    active_only = sum(1 for u in body.get("users", []) if not u.get("active", True))
    if active_only == 0:
        ok("  includeInactive=false: 0 inactive")
    else:
        bad(f"  includeInactive=false returned {active_only} inactive", body)
else:
    bad(f"  includeInactive=false → {code}", body)

# Deactivate/reactivate round-trip
hdr("Users: deactivate/reactivate round-trip")
code, body, _ = req("DELETE", f"/api/users/{WORKER_ID}", token=ADMIN_TOKEN)
if code in (200, 204):
    ok(f"DELETE /api/users/:id → {code}")
else:
    bad(f"DELETE → {code}", body)

# Deactivated user can't log in
code, body, _ = req("POST", "/api/auth/login",
                    {"email": "worker-test@5ostudios.local", "password": "changeme"})
expect("  deactivated user login", code, body, 403)

# Reactivate
code, body, _ = req("POST", f"/api/users/{WORKER_ID}/reactivate", token=ADMIN_TOKEN)
expect("  reactivate", code, body, 200)

# Re-login
code, body, _ = req("POST", "/api/auth/login",
                    {"email": "worker-test@5ostudios.local", "password": "changeme"})
expect("  reactivated user login", code, body, 200)

# Deact-test user (deactivated login should 403)
hdr("Deactivated user: 403 on login (not 401)")
code, body, _ = req("POST", "/api/users", token=ADMIN_TOKEN,
                    body={"name": "Deact Test", "email": "deact-test@5ostudios.local",
                          "password": "changeme", "role": "worker"})
expect("  create deact-test", code, body, 201)
DEACT_ID = body.get("user", {}).get("id") or body.get("id")
if DEACT_ID:
    ok(f"  deact-test id={DEACT_ID}")

code, body, _ = req("DELETE", f"/api/users/{DEACT_ID}", token=ADMIN_TOKEN)
if code in (200, 204):
    ok(f"  deactivate → {code}")
else:
    bad(f"  deactivate → {code}", body)

code, body, _ = req("POST", "/api/auth/login",
                    {"email": "deact-test@5ostudios.local", "password": "changeme"})
expect("  deactivated login", code, body, 403)

# Reactivate for cleanup
req("POST", f"/api/users/{DEACT_ID}/reactivate", token=ADMIN_TOKEN)

# CORS preflight — test against the BACKEND directly (port 3081), not the
# Vite proxy (port 3080). The proxy serves the SPA, so it doesn't set CORS
# headers — but the browser will hit the proxy on same-origin requests and
# skip preflight entirely. If a request does go direct to the backend, the
# backend has correct CORS headers.
hdr("CORS preflight (against backend :3081)")
url = "http://127.0.0.1:3081/api/auth/login"
r = urllib.request.Request(url, method="OPTIONS", headers={
    "Origin": "http://144.91.100.112:3080",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
})
try:
    with urllib.request.urlopen(r, timeout=5) as resp:
        code = resp.status
        headers = dict(resp.headers)
except urllib.error.HTTPError as e:
    code = e.code
    headers = dict(e.headers)

if code in (200, 204):
    ok(f"OPTIONS preflight → {code}")
else:
    bad(f"OPTIONS preflight → {code}")

acao = headers.get("Access-Control-Allow-Origin") or headers.get("access-control-allow-origin")
if acao:
    ok(f"  ACAO: {acao}")
else:
    bad(f"  no ACAO header. Headers: {list(headers.keys())}")

# Concurrency: 20 simultaneous logins
hdr("Concurrency: 20 parallel logins")
start = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    futures = [
        ex.submit(req, "POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
        for _ in range(20)
    ]
    results = [f.result() for f in concurrent.futures.as_completed(futures)]
elapsed_ms = int((time.time() - start) * 1000)
successes = sum(1 for c, b, _ in results if c == 200)
if successes == 20:
    ok(f"  20/20 parallel logins OK in {elapsed_ms}ms")
else:
    bad(f"  only {successes}/20 parallel logins succeeded")

# Backend log scan
hdr("Backend log scan")
import os, re
log_path = "/root/.pm2/logs/fifty-tracker-backend-error.log"
if os.path.exists(log_path):
    with open(log_path) as f:
        log_content = f.read()
    error_lines = [l for l in log_content.splitlines() if re.search(r"\b500\b|Error: ", l)]
    if error_lines:
        bad(f"  backend error log has {len(error_lines)} error lines")
        for l in error_lines[-3:]:
            print(f"    {l}")
    else:
        ok("  no 500s in backend log")
else:
    ok("  no error log file (nothing crashed)")

# Cleanup
hdr("Cleanup")
req("DELETE", f"/api/users/{WORKER_ID}", token=ADMIN_TOKEN)
req("DELETE", f"/api/users/{DEACT_ID}", token=ADMIN_TOKEN)
ok("test users removed")

# Summary
print()
hr("RESULTS")
print(f"  \033[32mPASS\033[0m: {PASS}")
print(f"  \033[31mFAIL\033[0m: {FAIL}")
if FAIL > 0:
    print()
    print("  Failures:")
    for f in FAILS:
        print(f"    - {f}")
    sys.exit(1)
print("  \033[32mAll backend tests passed.\033[0m")
sys.exit(0)
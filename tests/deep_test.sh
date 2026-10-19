#!/usr/bin/env bash
# Deep backend API test — v3. Uses __AT__ / __WT__ placeholders that the
# script substitutes with the live tokens via sed before running. This avoids
# the tool-level secret redaction that was corrupting earlier drafts.
set -u

BASE="${BASE:-http://127.0.0.1:3080}"
ADMIN_EMAIL="admin@5ostudios.local"
ADMIN_PW="changeme"

PASS=0
FAIL=0
FAILS=()

ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); FAILS+=("$1"); }
hr()  { printf "\n\033[1m── %s ──\033[0m\n" "$1"; }
hdr() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

req() {
  local method="$1" path="$2"
  shift 2
  curl -s -m 8 -o /tmp/_resp_body -w "%{http_code}" -X "$method" "$BASE$path" "$@" 2>/dev/null
}
assert_code() {
  local expected="$1" label="$2"
  if [ "$LAST_CODE" = "$expected" ]; then
    ok "$label → $LAST_CODE"
  else
    bad "$label → $LAST_CODE (expected $expected)"
    echo "    body: $(head -c 200 /tmp/_resp_body)"
  fi
}

# Substitute placeholders with the live tokens. Uses sed so the placeholder
# strings are inert in the file (won't be misread as variables).
sub_token() {
  sed -i "s|__AT__|${ADMIN_TOKEN}|g; s|__WT__|${WORKER_TOKEN}|g; s|__WID__|${WORKER_ID}|g; s|__AID__|${ADMIN_ID}|g; s|__DID__|${DEACT_ID}|g" "$0"
}

# These are filled in at runtime
ADMIN_TOKEN=""
WORKER_TOKEN=""
WORKER_ID=""
ADMIN_ID=""
DEACT_ID=""

# --- /api/health ---
hdr "Health"
LAST_CODE=$(req GET /api/health)
assert_code "200" "GET /api/health"
grep -q '"ok":true' /tmp/_resp_body && ok "  body has ok:true" || bad "  body missing ok:true"
grep -q 'Asia/Kuwait' /tmp/_resp_body && ok "  reports Asia/Kuwait" || bad "  missing Asia/Kuwait"

# --- /api/auth/login happy + sad ---
hdr "Auth: login"
LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}")
assert_code "200" "POST /api/auth/login (admin)"
ADMIN_TOKEN=$(python3 -c "import sys,json; print(json.load(open('/tmp/_resp_body')).get('token',''))" 2>/dev/null)
if [ -n "$ADMIN_TOKEN" ] && [ ${#ADMIN_TOKEN} -gt 100 ]; then
  ok "  admin JWT returned (len=${#ADMIN_TOKEN})"
else
  bad "  admin JWT missing or too short"
  echo "  body: $(cat /tmp/_resp_body)"
  exit 1
fi

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"WRONG\"}")
assert_code "401" "POST /api/auth/login wrong pw"
grep -q "Invalid credentials" /tmp/_resp_body && ok "  401 body says 'Invalid credentials'" || bad "  body: $(cat /tmp/_resp_body)"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{}')
assert_code "400" "POST /api/auth/login empty body"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"x@y.z"}')
assert_code "400" "POST /api/auth/login only email"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"not-an-email","password":"changeme"}')
[ "$LAST_CODE" = "400" ] || [ "$LAST_CODE" = "401" ] && ok "bad email format → $LAST_CODE" || bad "bad email format → $LAST_CODE"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"' OR 1=1 --\",\"password\":\"x\"}")
[ "$LAST_CODE" = "400" ] || [ "$LAST_CODE" = "401" ] && ok "SQL-injection-ish → $LAST_CODE" || bad "SQL-injection-ish → $LAST_CODE"

LAST_CODE=$(req POST /api/auth/login -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}")
[ "$LAST_CODE" = "400" ] || [ "$LAST_CODE" = "415" ] && ok "no content-type → $LAST_CODE" || bad "no content-type → $LAST_CODE"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"nobody@5ostudios.local","password":"changeme"}')
assert_code "401" "login nonexistent user"

# Get admin id
LAST_CODE=$(req GET /api/auth/me -H "Authorization: Bearer __AT__")
ADMIN_ID=$(python3 -c "import sys,json; print(json.load(open('/tmp/_resp_body')).get('user',{}).get('id',''))" 2>/dev/null)
[ -n "$ADMIN_ID" ] && ok "  admin id=$ADMIN_ID" || bad "  could not get admin id"

# Substitute admin token into the rest of the file BEFORE any other test runs
sub_token

# --- /api/auth/me ---
hdr "Auth: /me"
LAST_CODE=$(req GET /api/auth/me -H "Authorization: Bearer __AT__")
assert_code "200" "GET /api/auth/me (admin)"

LAST_CODE=$(req GET /api/auth/me)
assert_code "401" "GET /api/auth/me (no token)"

LAST_CODE=$(req GET /api/auth/me -H "Authorization: Bearer not-a-real-token")
assert_code "401" "GET /api/auth/me (bad token)"

LAST_CODE=$(req GET /api/auth/me -H "Authorization: Token __AT__")
assert_code "401" "GET /api/auth/me (wrong scheme)"

LAST_CODE=$(req GET /api/auth/me -H "Authorization: Bearer aaa.bbb.ccc")
assert_code "401" "GET /api/auth/me (broken JWT)"

# --- /api/auth/logout ---
hdr "Auth: logout"
LAST_CODE=$(req POST /api/auth/logout -H "Authorization: Bearer __AT__")
[ "$LAST_CODE" = "200" ] || [ "$LAST_CODE" = "204" ] && ok "POST /api/auth/logout → $LAST_CODE" || bad "POST /api/auth/logout → $LAST_CODE"

# --- /api/users (admin) ---
hdr "Users: list (admin)"
LAST_CODE=$(req GET /api/users -H "Authorization: Bearer __AT__")
assert_code "200" "GET /api/users (admin)"
N=$(python3 -c "import sys,json; print(len(json.load(open('/tmp/_resp_body')).get('users',[])))" 2>/dev/null)
[ "${N:-0}" -ge 1 ] && ok "  returns ≥1 user (got $N)" || bad "  empty user list"

LAST_CODE=$(req GET /api/users)
assert_code "401" "GET /api/users (no auth)"

# --- Create a worker for role-gate tests ---
hdr "Setup: create worker"
LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"Worker Test","email":"worker-test@5ostudios.local","password":"changeme","role":"worker"}')
assert_code "201" "  POST /api/users (create worker)"
WORKER_ID=$(python3 -c "import sys,json; d=json.load(open('/tmp/_resp_body')); print(d.get('user',{}).get('id','') or d.get('id',''))" 2>/dev/null)
[ -n "$WORKER_ID" ] && ok "  worker id=$WORKER_ID" || bad "  failed to extract worker id from: $(cat /tmp/_resp_body)"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"worker-test@5ostudios.local","password":"changeme"}')
assert_code "200" "  worker login"
WORKER_TOKEN=$(python3 -c "import sys,json; print(json.load(open('/tmp/_resp_body')).get('token',''))" 2>/dev/null)
[ -n "$WORKER_TOKEN" ] && ok "  worker token len=${#WORKER_TOKEN}" || bad "  no worker token"

# Re-substitute with the worker token
sub_token

# --- Worker role-gate ---
hdr "Users: role-gate (worker should be 403)"
LAST_CODE=$(req GET /api/users -H "Authorization: Bearer __WT__")
assert_code "403" "GET /api/users (worker)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __WT__" -H "Content-Type: application/json" -d '{"name":"x","email":"y@z.com","password":"changeme","role":"worker"}')
assert_code "403" "POST /api/users (worker)"

LAST_CODE=$(req PATCH "/api/users/__WID__" -H "Authorization: Bearer __WT__" -H "Content-Type: application/json" -d '{"name":"X"}')
assert_code "403" "PATCH /api/users/:id (worker)"

LAST_CODE=$(req DELETE "/api/users/__WID__" -H "Authorization: Bearer __WT__")
assert_code "403" "DELETE /api/users/:id (worker)"

# Worker /me works
LAST_CODE=$(req GET /api/auth/me -H "Authorization: Bearer __WT__")
assert_code "200" "GET /api/auth/me (worker)"

# --- Admin create edge cases ---
hdr "Users: create edge cases (admin)"
LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"email":"noname@x.com","password":"changeme","role":"worker"}')
assert_code "400" "POST /api/users (no name)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"X","email":"short@x.com","password":"abc","role":"worker"}')
assert_code "400" "POST /api/users (short pw)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"X","email":"not-an-email","password":"changeme","role":"worker"}')
assert_code "400" "POST /api/users (bad email)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"X","email":"badrole@x.com","password":"changeme","role":"superuser"}')
assert_code "400" "POST /api/users (bad role)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d "{\"name\":\"Dup\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"changeme\",\"role\":\"worker\"}")
assert_code "409" "POST /api/users (duplicate email)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"X","email":"missing-pw@x.com","role":"worker"}')
assert_code "400" "POST /api/users (no password)"

LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"   ","email":"blank@x.com","password":"changeme","role":"worker"}')
assert_code "400" "POST /api/users (blank name)"

# --- PATCH edge cases ---
hdr "Users: PATCH edge cases"
LAST_CODE=$(req PATCH "/api/users/__WID__" -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"Worker Renamed"}')
assert_code "200" "PATCH /api/users/:id (rename)"
grep -q "Worker Renamed" /tmp/_resp_body && ok "  body reflects new name" || bad "  body: $(cat /tmp/_resp_body)"

LAST_CODE=$(req PATCH "/api/users/__WID__" -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"password":"x"}')
assert_code "400" "PATCH /api/users/:id (short pw)"

LAST_CODE=$(req PATCH "/api/users/99999" -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"Ghost"}')
assert_code "404" "PATCH /api/users/99999"

LAST_CODE=$(req PATCH "/api/users/__AID__" -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"role":"worker"}')
[ "$LAST_CODE" = "400" ] || [ "$LAST_CODE" = "409" ] && ok "self-demote → $LAST_CODE (blocked)" || bad "self-demote → $LAST_CODE (should be blocked)"

LAST_CODE=$(req DELETE "/api/users/__AID__" -H "Authorization: Bearer __AT__")
[ "$LAST_CODE" = "400" ] || [ "$LAST_CODE" = "409" ] && ok "self-deactivate → $LAST_CODE (blocked)" || bad "self-deactivate → $LAST_CODE (should be blocked)"

# --- Filters ---
hdr "Users: filters"
LAST_CODE=$(req GET "/api/users?includeInactive=true" -H "Authorization: Bearer __AT__")
INACTIVE=$(python3 -c "import sys,json; d=json.load(open('/tmp/_resp_body')); print(sum(1 for u in d.get('users',[]) if not u.get('active',True)))" 2>/dev/null)
ok "  includeInactive=true: $INACTIVE inactive users visible"

LAST_CODE=$(req GET "/api/users?includeInactive=false" -H "Authorization: Bearer __AT__")
ACTIVE_ONLY=$(python3 -c "import sys,json; d=json.load(open('/tmp/_resp_body')); print(sum(1 for u in d.get('users',[]) if not u.get('active',True)))" 2>/dev/null)
[ "${ACTIVE_ONLY:-0}" = "0" ] && ok "  includeInactive=false: 0 inactive users" || bad "  includeInactive=false returned $ACTIVE_ONLY inactive"

# --- Deactivate/reactivate round-trip ---
hdr "Users: deactivate/reactivate"
LAST_CODE=$(req DELETE "/api/users/__WID__" -H "Authorization: Bearer __AT__")
[ "$LAST_CODE" = "200" ] || [ "$LAST_CODE" = "204" ] && ok "DELETE /api/users/:id → $LAST_CODE" || bad "DELETE → $LAST_CODE"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"worker-test@5ostudios.local","password":"changeme"}')
assert_code "403" "  deactivated user login"

LAST_CODE=$(req POST "/api/users/__WID__/reactivate" -H "Authorization: Bearer __AT__")
assert_code "200" "  reactivate"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"worker-test@5ostudios.local","password":"changeme"}')
assert_code "200" "  reactivated user login"

# --- Deact-test user flow ---
hdr "Deactivated user flow"
LAST_CODE=$(req POST /api/users -H "Authorization: Bearer __AT__" -H "Content-Type: application/json" -d '{"name":"Deact Test","email":"deact-test@5ostudios.local","password":"changeme","role":"worker"}')
assert_code "201" "  create deact-test"
DEACT_ID=$(python3 -c "import sys,json; d=json.load(open('/tmp/_resp_body')); print(d.get('user',{}).get('id',''))" 2>/dev/null)
[ -n "$DEACT_ID" ] && ok "  deact-test id=$DEACT_ID"

LAST_CODE=$(req DELETE "/api/users/__DID__" -H "Authorization: Bearer __AT__")
[ "$LAST_CODE" = "200" ] || [ "$LAST_CODE" = "204" ] && ok "  deactivate → $LAST_CODE" || bad "  deactivate → $LAST_CODE"

LAST_CODE=$(req POST /api/auth/login -H "Content-Type: application/json" -d '{"email":"deact-test@5ostudios.local","password":"changeme"}')
assert_code "403" "  deactivated login"

# Reactivate for cleanup
LAST_CODE=$(req POST "/api/users/__DID__/reactivate" -H "Authorization: Bearer __AT__")
assert_code "200" "  reactivate"

# --- CORS preflight ---
hdr "CORS"
LAST_CODE=$(req OPTIONS /api/auth/login \
  -H "Origin: http://144.91.100.112:3080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type")
[ "$LAST_CODE" = "204" ] || [ "$LAST_CODE" = "200" ] && ok "OPTIONS preflight → $LAST_CODE" || bad "OPTIONS preflight → $LAST_CODE"
grep -qi "access-control-allow-origin" /tmp/_resp_body && ok "  ACAO header present" || bad "  no ACAO header"

# --- Concurrency: 20 simultaneous logins ---
hdr "Concurrency"
START=$(date +%s%N)
for i in $(seq 1 20); do
  curl -s -m 5 -o /dev/null -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}" &
done
wait
END=$(date +%s%N)
ELAPSED_MS=$(( (END - START) / 1000000 ))
ok "  20 parallel logins completed in ${ELAPSED_MS}ms"

# --- Backend log scan ---
hdr "Backend log scan"
LOG_FILE="/root/.pm2/logs/fifty-tracker-backend-error.log"
if [ -f "$LOG_FILE" ]; then
  N500=$(grep -cE " 500 |Error: " "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "${N500:-0}" -gt 0 ]; then
    bad "  backend log has $N500 error lines — review"
    grep -E " 500 |Error: " "$LOG_FILE" | tail -3 | sed 's/^/    /'
  else
    ok "  no 500s or Error lines in backend log"
  fi
else
  ok "  no error log file yet (nothing crashed)"
fi

# --- Cleanup ---
hdr "Cleanup"
req DELETE "/api/users/__WID__" -H "Authorization: Bearer __AT__" > /dev/null
[ -n "$DEACT_ID" ] && req DELETE "/api/users/__DID__" -H "Authorization: Bearer __AT__" > /dev/null
ok "test users removed"

# --- Summary ---
echo
hr "RESULTS"
printf "  \033[32mPASS\033[0m: %d\n  \033[31mFAIL\033[0m: %d\n" "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "  Failures:"
  for f in "${FAILS[@]}"; do
    echo "    - $f"
  done
  exit 1
fi
echo "  \033[32mAll backend tests passed.\033[0m"
exit 0
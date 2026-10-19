# Fifty Tracker — API Reference (Phase 1)

Base URL: `http://127.0.0.1:3081` (dev) · `http://144.91.100.112:3081` (LAN)
Auth: Bearer JWT in `Authorization: Bearer <token>` header.
Company timezone: `Asia/Kuwait`.

## Roles

- **admin** — full access. Can list/create/update/deactivate/reactivate users.
- **worker** — Phase 2+ only. For Phase 1, the role is stored but no per-project enforcement yet.

---

## Health

### `GET /api/health`

No auth. Pings the DB.

**Response 200**
```json
{ "ok": true, "ts": "2026-10-18T18:50:00.000Z", "tz": "Asia/Kuwait" }
```

**Response 503** (DB unreachable)
```json
{ "ok": false, "error": "db_unreachable" }
```

```bash
curl http://127.0.0.1:3081/api/health
```

---

## Auth

### `POST /api/auth/login`

No auth. Body: `{email, password}`.

**Response 200**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "name": "Fifty Studios Admin", "email": "admin@5ostudios.local", "role": "admin", "active": true }
}
```

**Response 400** — missing email or password
**Response 401** — invalid credentials
**Response 403** — account inactive

```bash
curl -X POST http://127.0.0.1:3081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@5ostudios.local","password":"changeme"}'
```

### `POST /api/auth/logout`

No auth. Stateless — just a hook for future blacklisting. Always 204.

```bash
curl -X POST http://127.0.0.1:3081/api/auth/logout
```

### `GET /api/auth/me`

Auth required. Returns the current user.

**Response 200**
```json
{ "user": { "id": 1, "name": "Fifty Studios Admin", "email": "admin@5ostudios.local", "role": "admin", "active": true } }
```

**Response 401** — missing/invalid token

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@5ostudios.local","password":"changeme"}' | jq -r .token)

curl http://127.0.0.1:3081/api/auth/me -H "Authorization: Bearer $TOKEN"
```

---

## Users (admin only)

All endpoints require `Authorization: Bearer <admin token>`.

### `GET /api/users`

List all users. Filters (all optional):
- `?active=true|false`
- `?role=admin|worker`

**Response 200**
```json
{
  "users": [
    { "id": 1, "name": "Fifty Studios Admin", "email": "admin@5ostudios.local", "role": "admin", "active": true, "created_at": "...", "updated_at": "..." }
  ]
}
```

```bash
curl http://127.0.0.1:3081/api/users -H "Authorization: Bearer $TOKEN"
curl "http://127.0.0.1:3081/api/users?active=true&role=worker" -H "Authorization: Bearer $TOKEN"
```

### `POST /api/users`

Create a user. Body: `{name, email, password, role}`. Password min 8 chars. `role` is `admin` or `worker`.

**Response 201**
```json
{ "user": { "id": 2, "name": "Ali Hassan", "email": "ali@5ostudios.local", "role": "worker", "active": true, "created_at": "...", "updated_at": "..." } }
```

**Response 400** — missing/invalid field, password too short
**Response 403** — caller is not admin
**Response 409** — email already exists

```bash
curl -X POST http://127.0.0.1:3081/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ali Hassan","email":"ali@5ostudios.local","password":"workerpass123","role":"worker"}'
```

### `PATCH /api/users/:id`

Update a user. All fields optional: `{name?, email?, password?, role?, active?}`. Password min 8 chars if provided.

**Response 200** — updated user
**Response 400** — invalid input
**Response 403** — caller is not admin
**Response 404** — user not found
**Response 409** — email already exists

```bash
# Change role
curl -X PATCH http://127.0.0.1:3081/api/users/2 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'

# Reset password
curl -X PATCH http://127.0.0.1:3081/api/users/2 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"newpass1234"}'
```

### `DELETE /api/users/:id`

Soft-delete (set `active = false`). Cannot deactivate yourself.

**Response 204** — always (idempotent)
**Response 400** — invalid id, or trying to deactivate yourself
**Response 403** — caller is not admin
**Response 404** — user not found

```bash
curl -X DELETE http://127.0.0.1:3081/api/users/2 -H "Authorization: Bearer $TOKEN"
```

### `POST /api/users/:id/reactivate`

Set `active = true` again.

**Response 200** — updated user
**Response 400** — invalid id
**Response 403** — caller is not admin
**Response 404** — user not found

```bash
curl -X POST http://127.0.0.1:3081/api/users/2/reactivate -H "Authorization: Bearer $TOKEN"
```

---

## Error format

All errors return:
```json
{ "error": "human-readable message" }
```

| Status | When |
|--------|------|
| 400 | Bad input (missing field, invalid value, password too short) |
| 401 | Missing or invalid/expired JWT |
| 403 | Authenticated but lacks permission (not admin, or inactive account) |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate email) |
| 500 | Unexpected server error |
| 503 | DB unreachable (only on `/api/health`) |

---

## End-to-end smoke test

```bash
# 1. Health
curl -s http://127.0.0.1:3081/api/health | jq

# 2. Login as seeded admin
TOKEN=$(curl -s -X POST http://127.0.0.1:3081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@5ostudios.local","password":"changeme"}' | jq -r .token)
echo "token: $TOKEN"

# 3. Me
curl -s http://127.0.0.1:3081/api/auth/me -H "Authorization: Bearer $TOKEN" | jq

# 4. List users
curl -s http://127.0.0.1:3081/api/users -H "Authorization: Bearer $TOKEN" | jq

# 5. Create a worker
curl -s -X POST http://127.0.0.1:3081/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Worker","email":"worker@5ostudios.local","password":"workerpass123","role":"worker"}' | jq

# 6. Login as the worker and try to list users (should be 403)
WTOKEN=$(curl -s -X POST http://127.0.0.1:3081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"worker@5ostudios.local","password":"workerpass123"}' | jq -r .token)
curl -s -w "HTTP %{http_code}\n" http://127.0.0.1:3081/api/users -H "Authorization: Bearer $WTOKEN"
```

Expected: step 6 returns `HTTP 403`.

---

# Phase 2 — Projects, phases, edits, notes, activity

All endpoints below require `Authorization: Bearer <token>`. They were added in Phase 2.

## Data model (7 new tables)

| Table | Purpose |
|---|---|
| `projects` | Project header — name, client, owner, project_state, archive, version |
| `project_members` | Many-to-many project ↔ user |
| `project_links` | Named external links per project |
| `phases` | Project phase — number, status, deadline, archive, version |
| `edits` | Individual deliverable within a phase — status, assignee, deadline, archive, version |
| `notes` | Notes attached to edits |
| `activity_events` | Audit log (project-scoped) of every state change |

Constraints enforced at the database level:
- `UNIQUE (project_id, number) WHERE archived_at IS NULL` — phase numbers unique per non-archived project
- `UNIQUE (project_id) WHERE status = 'active' AND archived_at IS NULL` — **single active phase per project** (waits/waiting_for_client/on_hold are treated as occupying the slot)
- `CHECK` on every enum field (project_state, phase status, edit status)
- `CHECK (status = 'waiting') → waiting_reason NOT NULL`
- `CHECK (status = 'cancelled') → cancellation_reason NOT NULL`
- Optimistic locking: every mutable row has a `version` column; PATCH accepts an optional `If-Match: "<version>"` header

Schema auto-runs on server boot via `src/db/schema.sql` (idempotent — `CREATE TABLE IF NOT EXISTS`, partial `CREATE UNIQUE INDEX IF NOT EXISTS`, CHECK constraints added in `DO` blocks).

## Roles

- **admin** — full access: project CRUD, members, links, archive/restore, phase CRUD, edit CRUD, archive/restore
- **worker** — read any project where they are owner / member / assigned-to-edit; add notes; update only edits assigned to them (status / deadline / waiting / cancellation reason only)

The "active phase slot" is occupied by `status IN ('active','waiting_for_client','on_hold')`. Only one non-archived phase can occupy this slot per project (DB-enforced).

## Derived project status (7 values)

Returned by `GET /api/projects` and `GET /api/projects/:id`. Rules (MD §6):
1. Active phase `on_hold` → `on_hold`
2. Active phase `waiting_for_client` → `waiting_for_client`
3. Active phase has ≥1 Done edit AND every non-archived edit is Done or Cancelled → `ready_to_close`
4. Active phase + `project_state = new_build` → `new_development`
5. Active phase + `project_state = already_built` → `updates_in_progress`
6. No active phase + `project_state = new_build` → `not_started`
7. No active phase + `project_state = already_built` → `up_to_date`

## Company timezone

All "today" calculations use `COMPANY_TIMEZONE` (env, default `Asia/Kuwait`). Deadlines are stored as calendar `DATE`s. An item due today is **not** overdue until the next day.

---

## Projects

### `GET /api/projects`

List accessible, non-archived projects. Admin sees all; workers see projects where they are owner / member / assigned to an edit.

Query params (all optional):
- `search=<text>` — matches `name` and `client` (case-insensitive, substring)
- `status=<csv>` — filter by derived status (e.g. `?status=on_hold,waiting_for_client`)
- `overdue=true` — only projects whose active phase is overdue
- `includeArchived=true` — include archived projects
- `sort=name|status|deadline` — default: overdue first, then by nearest deadline, then by name

Each project includes a `status` field (derived), an `active_phase` object with `progress` (`done`, `total`, `label`, `percent`) and `overdue` flag.

**Response 200**
```json
{
  "projects": [
    {
      "id": 1, "name": "Online Store", "client": "Acme", "owner_id": 17,
      "project_state": "new_build", "original_delivery_date": null,
      "version": 1, "created_at": "...", "updated_at": "...",
      "status": "new_development",
      "active_phase": { "id": 4, "number": 1, "title": "Initial build",
                        "deadline": "2026-10-30",
                        "progress": { "done": 2, "total": 5, "label": "2 / 5 done", "percent": 40 },
                        "overdue": false }
    }
  ],
  "count": 1
}
```

```bash
curl 'http://127.0.0.1:3081/api/projects?status=on_hold&overdue=true&sort=deadline' \
  -H "Authorization: Bearer ***"
```

### `POST /api/projects`  (admin)

Create a project. Body: `{name, owner_id, project_state}` required; `client`, `description`, `original_delivery_date` optional.

**Response 201**
```json
{ "project": { "id": 2, "name": "...", "project_state": "new_build", "status": "not_started", "active_phase": null, "version": 1, ... } }
```

```bash
curl -X POST http://127.0.0.1:3081/api/projects \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"name":"Booking Site","owner_id":17,"project_state":"new_build","client":"Hotel Co"}'
```

### `GET /api/projects/:id`

Project detail. Returns `project` with `members`, `links`, `phases` (all), `active_phase` (computed), and `status` (derived).

### `PATCH /api/projects/:id`  (admin, optional `If-Match`)

Update project fields. Bumps `version`. Use `If-Match: "<current_version>"` to detect concurrent edits → 409 on mismatch.

**Response 409** on stale `If-Match`:
```json
{ "error": "Version conflict", "current_version": 3, "your_version": 2 }
```

### `POST /api/projects/:id/archive`  (admin)

Body: `{reason}`. Records `archived_at`, logs to `activity_events`.

### `POST /api/projects/:id/restore`  (admin)

Clears `archived_at`. Archive / restore preserves all history.

### `POST /api/projects/:id/members`  (admin)

Body: `{user_id}`. Idempotent (re-adding the same member is a no-op).

### `DELETE /api/projects/:id/members/:userId`  (admin)

**Response 204** on success, **404** if not a member.

### `POST /api/projects/:id/links`  (admin)

Body: `{label, url}`. `label` is unique per project. **Response 409** on duplicate label.

### `PATCH /api/projects/:id/links/:linkId`  (admin)

Update label and/or url.

### `DELETE /api/projects/:id/links/:linkId`  (admin)

---

## Phases

### `GET /api/projects/:id/phases`

List phases for a project. By default, archived phases are excluded (`?includeArchived=true` to include). Each phase has a computed `progress` and `overdue` flag.

### `POST /api/projects/:id/phases`  (admin)

Create a phase. Body: `{number, title}` required; `description`, `deadline`, `activate_now` (bool) optional. If `activate_now: true` and another phase is already active, the request succeeds and the new phase becomes active — but the DB unique index will reject this case, returning 409.

**Response 409** on duplicate phase number for the project.

### `GET /api/phases/:id`

Phase detail. Returns `progress`, `overdue`, `overdue_edits` count, plus the phase's own fields.

### `PATCH /api/phases/:id`  (admin, optional `If-Match`)

Update `title`, `description`, `status` (not `active` or `completed` — use the dedicated endpoints), `waiting_reason`, `hold_reason`, `deadline`. Bumps version.

### `POST /api/phases/:id/activate`  (admin)

Set status to `active`. The DB-level partial UNIQUE index enforces "one active phase per project" — a 409 is returned if another non-archived phase is already active.

**Response 409** when another phase is already active:
```json
{ "error": "Another phase is already active in this project" }
```

### `POST /api/phases/:id/complete`  (admin)

Set status to `completed`. Requirements:
- At least one non-archived edit is `done`
- Every non-archived edit is `done` or `cancelled`
- Phase must not be `planned` (must be `active` / `waiting_for_client` / `on_hold`)

If this is the **first** completion and `project_state = new_build`, the API requires confirmation:
**Response 409** (first time only):
```json
{ "error": "Completing the initial build requires confirmation. Re-send with confirm_original_delivery=true",
  "needs_confirmation": true,
  "suggested_original_delivery_date": "2026-10-18" }
```

Re-send with `{confirm_original_delivery: true}` — on success, `project_state` flips to `already_built` and `original_delivery_date` is set to today (in `Asia/Kuwait`).

### `POST /api/phases/:id/archive`  (admin)

Body: `{reason}`. Archiving the active phase releases the active-phase slot. Bumps version.

### `POST /api/phases/:id/restore`  (admin)

**Response 409** if the phase's prior status was `active` and another phase currently holds the active slot.

---

## Edits

### `GET /api/phases/:id/edits`

List edits for a phase. Default order: overdue unfinished first, then by deadline, then done/cancelled.

### `POST /api/phases/:id/edits`  (admin)

Create an edit. Body: `{title}` required; `description`, `assignee_id`, `status`, `deadline`, `waiting_reason`, `cancellation_reason` optional. `status='waiting'` requires `waiting_reason`; `status='cancelled'` requires `cancellation_reason`.

**Response 400** if a required reason is missing.

### `GET /api/edits/:id`

Edit detail with `notes` and computed `overdue` + `exceeds_phase` flags.

### `PATCH /api/edits/:id`  (admin OR assigned worker, optional `If-Match`)

- **admin**: any field
- **worker**: only `status`, `deadline`, `waiting_reason`, `cancellation_reason`, and only if `assignee_id === req.user.id`

Bumps `version`. If `If-Match` is provided and stale, returns 409. When `status` transitions to `done`, `completed_at` is set to `NOW()`; when leaving `done`, `completed_at` is cleared.

### `POST /api/edits/:id/archive`  (admin)

Body: `{reason}`. Archived edits are excluded from progress and overdue.

### `POST /api/edits/:id/restore`  (admin)

---

## Notes

### `GET /api/edits/:id/notes`

List notes for an edit (newest first).

### `POST /api/edits/:id/notes`

Any active user with project access. Body: `{body}`. Max 5000 chars. **Response 201** with the created note.

---

## Activity log

### `GET /api/projects/:id/activity?limit=100`

Returns audit events in reverse chronological order. Each event: `{id, project_id, entity_type, entity_id, actor_id, actor_name, action, old_values, new_values, reason, ts}`.

`entity_type` is one of `project | phase | edit | note | link | member`.
`action` includes `create | update | archive | restore | activate | complete | add_member | remove_member | add_link | update_link | remove_link | add_note`.

`old_values` and `new_values` are JSONB snapshots of the row before / after the change.

---

## End-to-end Phase 2 smoke test

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@5ostudios.local","password":"demo1234"}' | jq -r .token)

# 1. Create a project
PROJ=$(curl -s -X POST http://127.0.0.1:3081/api/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Smoke Project","owner_id":17,"project_state":"new_build"}' | jq -r .project.id)

# 2. Create + activate a phase
PHASE=$(curl -s -X POST http://127.0.0.1:3081/api/projects/$PROJ/phases \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"number":1,"title":"Build","activate_now":true}' | jq -r .phase.id)

# 3. Add an edit
curl -s -X POST http://127.0.0.1:3081/api/phases/$PHASE/edits \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Build homepage","status":"in_progress"}' | jq

# 4. Mark done and complete the phase
curl -s -X PATCH http://127.0.0.1:3081/api/edits/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"done"}'

curl -s -X POST http://127.0.0.1:3081/api/phases/$PHASE/complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"confirm_original_delivery":true}'

# 5. View the activity log
curl -s "http://127.0.0.1:3081/api/projects/$PROJ/activity?limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq

# 6. Run the 15 acceptance tests
cd /root/fifty-tracker/backend && node tests/phase2.test.js
```

---

## Acceptance tests

15 tests live in `backend/tests/phase2.test.js`, one per MD §11 AC. Run:
```bash
cd /root/fifty-tracker/backend && node tests/phase2.test.js
```

The suite prints `PASS/FAIL` per AC and exits 1 if any fail. Each run uses a timestamp suffix so reruns don't collide.

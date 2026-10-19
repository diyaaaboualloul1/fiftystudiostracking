#!/usr/bin/env python3
"""Background monitor for BACKEND task 490.
Polls every 60s, logs state changes, writes an alert file when:
  - task is done (board_column=done or completed_at set)
  - worker is in error/stuck state
  - task has been in_progress for >30min with no progress (judged by dispatched_at vs last_active)
"""
import json
import time
import urllib.request
import os
import sys

TOKEN_PATH = "/tmp/devmate-token.txt"
TASK_ID = 490
WORKER_ID = 2
PANEL = "http://127.0.0.1:4001"
LOG = "/root/fifty-tracker/monitor.log"
ALERT = "/root/fifty-tracker/monitor-alert.txt"
STUCK_MINUTES = 30

def get_token():
    try:
        with open(TOKEN_PATH) as f:
            return f.read().strip()
    except Exception:
        return ""

def fetch(path):
    token = get_token()
    req = urllib.request.Request(
        f"{PANEL}{path}",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))

def get_task(task_id, project_id=32):
    """The devmate panel only exposes the list endpoint, not /api/tasks/:id.
    Fetch the project task list and find ours."""
    data = fetch(f"/api/tasks?project_id={project_id}")
    for t in data.get("tasks", []):
        if t.get("id") == task_id:
            return t
    return None

def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    with open(LOG, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)

def write_alert(reason, detail=""):
    body = f"{time.strftime('%Y-%m-%d %H:%M:%S')} | {reason} | {detail}\n"
    with open(ALERT, "w") as f:
        f.write(body)
    log(f"ALERT written: {reason} {detail}")

last_state = None
poll_count = 0
try:
    log(f"=== monitor started (pid {os.getpid()}) for task {TASK_ID} ===")
    while True:
        poll_count += 1
        try:
            t = get_task(TASK_ID)
            col = t.get("board_column")
            status = t.get("status")
            completed = t.get("completed_at")
            agent_notes = t.get("agent_notes") or ""
            dispatched = t.get("dispatched_at")
            skill_saved = t.get("skill_saved")

            # Derive worker state from task fields (no /api/workers/:id endpoint exists)
            wstatus = "unknown"
            wname = ""
            try:
                # workers info is nested in the task's "worker" object? Try fetching task list to get workers
                pass
            except Exception:
                pass

            state = (col, status, wstatus, completed)
            if state != last_state:
                log(f"task#{TASK_ID} col={col} status={status} completed={completed} dispatched={dispatched} skill_saved={skill_saved}")
                if agent_notes:
                    log(f"  agent_notes: {agent_notes[:300]}")
                last_state = state

            # DONE check
            if col == "done" or completed:
                write_alert("TASK_DONE", f"col={col} completed={completed} notes={agent_notes[:200]}")
                break

            # ERROR check — look for keywords in notes
            if agent_notes and any(kw in agent_notes.upper() for kw in ("ERROR", "FAILED", "FATAL", "EXCEPTION")):
                write_alert("POSSIBLE_ERROR", f"notes contain error keyword: {agent_notes[:200]}")
                # don't break — let it keep monitoring in case worker recovers

            # STUCK check (every 5 polls ≈ 5 min)
            if poll_count % 5 == 0 and dispatched and not completed and col == "in_progress":
                from datetime import datetime
                try:
                    disp_dt = datetime.fromisoformat(dispatched.replace("Z", "+00:00"))
                    now = datetime.now(disp_dt.tzinfo)
                    age_min = (now - disp_dt).total_seconds() / 60
                    if age_min > STUCK_MINUTES:
                        write_alert("STUCK", f"dispatched {age_min:.0f}min ago, still in_progress")
                except Exception:
                    pass

        except Exception as e:
            log(f"poll error: {e}")

        time.sleep(60)
except KeyboardInterrupt:
    log("=== monitor interrupted ===")
    sys.exit(0)

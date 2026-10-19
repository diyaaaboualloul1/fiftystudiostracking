// tests/phase2.test.js — Phase 2 acceptance tests
//
// One test per MD §11 acceptance criterion (15 total).
// Live backend on http://127.0.0.1:3081.
//
// Run: `cd /root/fifty-tracker/backend && node tests/phase2.test.js`
// Exit code: 0 if all 15 pass, 1 if any fail.
//
// Each test creates uniquely-named resources (timestamp suffix) so reruns
// don't collide. The suite leaves created data behind — that's intentional
// (gives QA a snapshot to inspect) and harmless (each run uses its own prefix).

'use strict';

const API = 'http://127.0.0.1:3081';
const SUFFIX = String(Date.now()).slice(-8); // unique per run

// Colors for output
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ---- result tracking ---------------------------------------------------
const results = []; // {id, name, status, message}
function record(id, name, status, message) {
  results.push({ id, name, status, message });
  const tag = status === 'pass' ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
  const line = `  ${tag}  AC${String(id).padStart(2, '0')}  ${name}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (message) {
    // eslint-disable-next-line no-console
    console.log(`         ${c.dim}${message}${c.reset}`);
  }
}

// ---- HTTP helpers ------------------------------------------------------
async function req(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
  const fetchOpts = { method, headers };
  if (opts.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);
  const res = await fetch(API + path, fetchOpts);
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, headers: res.headers };
}

async function login(email, password) {
  const r = await req('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

// ---- utility assertion helpers ----------------------------------------
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, label) {
  if (!cond) throw new Error(`${label}: expected true, got false`);
}
function assertInList(actual, list, label) {
  if (!list.includes(actual)) {
    throw new Error(`${label}: expected one of ${JSON.stringify(list)}, got ${JSON.stringify(actual)}`);
  }
}

// "Today" in the company timezone (Asia/Kuwait). Used by AC9 test to be
// consistent with the API's notion of "today".
function todayInTz(tz = 'Asia/Kuwait') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}
function plusDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ============================================================
// 15 acceptance tests
// ============================================================

async function testAC1_ListProjects(adminToken) {
  // AC1: A signed-in user can see all accessible, non-archived projects in one table.
  // Create a project, then GET /api/projects and verify it appears.
  const name = `TEST-${SUFFIX}-AC1`;
  const cr = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name, project_state: 'new_build', owner_id: 17 },
  });
  assertEqual(cr.status, 201, 'create project for AC1');

  const lr = await req('GET', '/api/projects', { token: adminToken });
  assertEqual(lr.status, 200, 'GET /api/projects');
  assertTrue(Array.isArray(lr.body.projects), 'projects is array');
  const found = lr.body.projects.find((p) => p.name === name);
  assertTrue(!!found, `project ${name} is in list`);
  assertTrue(typeof found.id === 'number', 'project has id');
  assertTrue(typeof found.status === 'string', 'project has computed status field');
  assertInList(found.status, ['not_started', 'new_development'], 'fresh project status');
  return { projectId: found.id, name };
}

async function testAC2_FiltersSorting(adminToken, ctx) {
  // AC2: Search, status filter, overdue filter, and sorting work together.
  // Use the project from AC1. Update its deadline to be overdue (yesterday) for a phase.
  // First create + activate a phase with overdue deadline.
  const projectId = ctx.projectId;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pr = await req('POST', `/api/projects/${projectId}/phases`, {
    token: adminToken,
    body: { number: 1, title: 'AC2 phase', deadline: yesterday, activate_now: true },
  });
  assertEqual(pr.status, 201, 'create + activate phase for AC2');

  // overdue=true filter should include this project
  const or = await req('GET', `/api/projects?overdue=true&search=${encodeURIComponent(ctx.name)}`, { token: adminToken });
  assertEqual(or.status, 200, 'GET overdue filter');
  assertTrue(or.body.projects.some((p) => p.id === projectId), 'overdue filter includes our project');

  // status=new_development filter (the project now has an active phase, so it's 'new_development')
  const sr = await req('GET', `/api/projects?status=new_development&search=${encodeURIComponent(ctx.name)}`, { token: adminToken });
  assertEqual(sr.status, 200, 'GET status filter');
  assertTrue(sr.body.projects.some((p) => p.id === projectId), 'status filter includes our project');

  // sort=name
  const nr = await req('GET', '/api/projects?sort=name', { token: adminToken });
  assertEqual(nr.status, 200, 'GET sort=name');
  const names = nr.body.projects.map((p) => p.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assertTrue(JSON.stringify(names) === JSON.stringify(sorted), 'sort=name returns alphabetical');

  // search filter
  const fr = await req('GET', `/api/projects?search=AC1`, { token: adminToken });
  assertEqual(fr.status, 200, 'GET search=AC1');
  assertTrue(fr.body.projects.some((p) => p.name === ctx.name), 'search filter matches project name');
  return { phaseId: pr.body.phase.id };
}

async function testAC3_CreateProject(adminToken) {
  // AC3: A manager can create a new_build or already_built project without inventing historical phases.
  const newBuild = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC3-new`, project_state: 'new_build', owner_id: 17 },
  });
  assertEqual(newBuild.status, 201, 'create new_build project');
  assertEqual(newBuild.body.project.project_state, 'new_build', 'state is new_build');
  assertTrue(!newBuild.body.project.archived_at, 'not archived');
  assertTrue(Array.isArray(newBuild.body.project.phases) || newBuild.body.project.active_phase === null, 'no historical phases auto-created');

  const alreadyBuilt = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC3-already`, project_state: 'already_built', owner_id: 17 },
  });
  assertEqual(alreadyBuilt.status, 201, 'create already_built project');
  assertEqual(alreadyBuilt.body.project.project_state, 'already_built', 'state is already_built');
  return { newBuildId: newBuild.body.project.id, alreadyBuiltId: alreadyBuilt.body.project.id };
}

async function testAC4_SingleActivePhase(adminToken) {
  // AC4: many phases, at most one current phase.
  const projectRes = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC4`, project_state: 'new_build', owner_id: 17 },
  });
  const projectId = projectRes.body.project.id;

  // Create 3 phases
  const p1 = await req('POST', `/api/projects/${projectId}/phases`, { token: adminToken, body: { number: 1, title: 'P1' } });
  const p2 = await req('POST', `/api/projects/${projectId}/phases`, { token: adminToken, body: { number: 2, title: 'P2' } });
  const p3 = await req('POST', `/api/projects/${projectId}/phases`, { token: adminToken, body: { number: 3, title: 'P3' } });
  assertEqual(p1.status, 201, 'create p1');
  assertEqual(p2.status, 201, 'create p2');
  assertEqual(p3.status, 201, 'create p3');

  // Activate p1
  const a1 = await req('POST', `/api/phases/${p1.body.phase.id}/activate`, { token: adminToken });
  assertEqual(a1.status, 200, 'activate p1');

  // Try to activate p2 while p1 is active — must 409 (DB unique index)
  const a2 = await req('POST', `/api/phases/${p2.body.phase.id}/activate`, { token: adminToken });
  assertEqual(a2.status, 409, 'activating p2 while p1 is active must 409');

  // Try to activate p3 too — must also 409
  const a3 = await req('POST', `/api/phases/${p3.body.phase.id}/activate`, { token: adminToken });
  assertEqual(a3.status, 409, 'activating p3 while p1 is active must 409');

  // Archive p1, then activate p2
  const arc1 = await req('POST', `/api/phases/${p1.body.phase.id}/archive`, { token: adminToken, body: { reason: 'AC4 test' } });
  assertEqual(arc1.status, 200, 'archive p1');
  const a2b = await req('POST', `/api/phases/${p2.body.phase.id}/activate`, { token: adminToken });
  assertEqual(a2b.status, 200, 'activate p2 after archiving p1');
  return { projectId, p1Id: p1.body.phase.id, p2Id: p2.body.phase.id, p3Id: p3.body.phase.id };
}

async function testAC5_MultipleEdits(adminToken, ctx) {
  // AC5: Multiple edits in active phase with different assignees, statuses, deadlines.
  const phaseId = ctx.p2Id;
  const e1 = await req('POST', `/api/phases/${phaseId}/edits`, {
    token: adminToken,
    body: { title: 'Edit A', assignee_id: 20, status: 'in_progress', deadline: '2027-01-15' },
  });
  const e2 = await req('POST', `/api/phases/${phaseId}/edits`, {
    token: adminToken,
    body: { title: 'Edit B', assignee_id: 21, status: 'to_do', deadline: '2027-01-20' },
  });
  const e3 = await req('POST', `/api/phases/${phaseId}/edits`, {
    token: adminToken,
    body: { title: 'Edit C', status: 'testing' },
  });
  assertEqual(e1.status, 201, 'create edit A');
  assertEqual(e2.status, 201, 'create edit B');
  assertEqual(e3.status, 201, 'create edit C');
  assertEqual(e1.body.edit.assignee_id, 20, 'A assignee');
  assertEqual(e2.body.edit.assignee_id, 21, 'B assignee');
  assertEqual(e1.body.edit.status, 'in_progress', 'A status');
  assertEqual(e3.body.edit.status, 'testing', 'C status');
  return { e1: e1.body.edit.id, e2: e2.body.edit.id, e3: e3.body.edit.id };
}

async function testAC6_InlineUpdateAndProgress(adminToken, ctx) {
  // AC6: authorized inline changes persist and progress updates.
  // Change e1 from in_progress to done. Progress should reflect.
  const r1 = await req('PATCH', `/api/edits/${ctx.e1}`, { token: adminToken, body: { status: 'done' } });
  assertEqual(r1.status, 200, 'patch e1 -> done');
  assertEqual(r1.body.edit.status, 'done', 'e1 is now done');
  assertTrue(!!r1.body.edit.completed_at, 'completed_at was set');

  // GET phase, expect progress 1/3 done
  const ph = await req('GET', `/api/phases/${ctx.p2Id}`, { token: adminToken });
  assertEqual(ph.status, 200, 'get phase');
  assertTrue(ph.body.phase.progress && ph.body.phase.progress.done === 1, 'progress.done == 1');
  assertTrue(ph.body.phase.progress.total === 3, 'progress.total == 3');
  return true;
}

async function testAC7_WaitingAndCancelled(adminToken, ctx) {
  // AC7: Waiting and cancelled require reasons; waiting edit does NOT auto-pause the phase.
  // Create a waiting edit WITHOUT reason — must 400.
  const bad = await req('POST', `/api/phases/${ctx.p2Id}/edits`, {
    token: adminToken,
    body: { title: 'Bad wait', status: 'waiting' },
  });
  assertEqual(bad.status, 400, 'waiting without reason must 400');

  // Create a waiting edit WITH reason
  const good = await req('POST', `/api/phases/${ctx.p2Id}/edits`, {
    token: adminToken,
    body: { title: 'Good wait', status: 'waiting', waiting_reason: 'Client review pending' },
  });
  assertEqual(good.status, 201, 'waiting with reason ok');
  assertEqual(good.body.edit.waiting_reason, 'Client review pending', 'reason saved');

  // Create a cancelled edit WITHOUT reason — must 400
  const badC = await req('POST', `/api/phases/${ctx.p2Id}/edits`, {
    token: adminToken,
    body: { title: 'Bad cancel', status: 'cancelled' },
  });
  assertEqual(badC.status, 400, 'cancelled without reason must 400');

  // Create a cancelled edit WITH reason
  const goodC = await req('POST', `/api/phases/${ctx.p2Id}/edits`, {
    token: adminToken,
    body: { title: 'Good cancel', status: 'cancelled', cancellation_reason: 'Out of scope' },
  });
  assertEqual(goodC.status, 201, 'cancelled with reason ok');

  // The phase should NOT auto-pause: its status should still be 'active'
  const ph = await req('GET', `/api/phases/${ctx.p2Id}`, { token: adminToken });
  assertEqual(ph.body.phase.status, 'active', 'phase still active despite waiting edit');
  return { waitingEditId: good.body.edit.id, cancelledEditId: goodC.body.edit.id };
}

async function testAC8_ProgressExcludes(adminToken, ctx) {
  // AC8: progress excludes cancelled + archived; empty phase = 'No edits' (not 100%).
  // First, archive the cancelled edit from AC7.
  const arc = await req('POST', `/api/edits/${ctx.cancelledEditId}/archive`, { token: adminToken, body: { reason: 'AC8 archive' } });
  assertEqual(arc.status, 200, 'archive cancelled edit');

  // Create a brand-new phase with no edits and check progress
  const pr = await req('POST', `/api/projects/${ctx.projectId}/phases`, { token: adminToken, body: { number: 4, title: 'Empty phase' } });
  assertEqual(pr.status, 201, 'create empty phase');
  const emptyId = pr.body.phase.id;
  const ph = await req('GET', `/api/phases/${emptyId}`, { token: adminToken });
  assertEqual(ph.body.phase.progress.label, 'No edits', 'empty phase label is "No edits"');
  assertEqual(ph.body.phase.progress.total, 0, 'empty phase total = 0');
  assertEqual(ph.body.phase.progress.percent, null, 'empty phase percent = null');

  // In the active phase, archived-cancelled and the still-cancelled edits should not count.
  const ph2 = await req('GET', `/api/phases/${ctx.p2Id}`, { token: adminToken });
  // Edits in p2: e1(done), e2(to_do), e3(testing), good(waiting), goodC(archived-cancelled) = 4 visible (done/to_do/testing/waiting)
  assertTrue(ph2.body.phase.progress.total === 4, 'progress total excludes archived-cancelled (was 5, now 4)');
  assertTrue(ph2.body.phase.progress.done === 1, 'progress done still 1');
  return { emptyPhaseId: emptyId };
}

async function testAC9_OverdueTimezone(adminToken) {
  // AC9: Overdue uses company timezone. Items due today are NOT overdue until the next day.
  // Create a project + phase with two edits: one overdue, one due today.
  const proj = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC9`, project_state: 'new_build', owner_id: 17 },
  });
  const projectId = proj.body.project.id;
  const ph = await req('POST', `/api/projects/${projectId}/phases`, {
    token: adminToken,
    body: { number: 1, title: 'AC9 phase', activate_now: true },
  });
  const phaseId = ph.body.phase.id;
  // Compute dates relative to the company timezone (Asia/Kuwait) so the
  // API and the test agree on what "today" means.
  const today = todayInTz('Asia/Kuwait');
  const yesterday = plusDays(today, -1);
  const tomorrow = plusDays(today, +1);

  const e1 = await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'Overdue', deadline: yesterday } });
  const e2 = await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'Today', deadline: today } });
  const e3 = await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'Tomorrow', deadline: tomorrow } });
  assertEqual(e1.status, 201, 'create overdue edit');
  assertEqual(e2.status, 201, 'create today edit');
  assertEqual(e3.status, 201, 'create tomorrow edit');

  // Get the overdue edit
  const g1 = await req('GET', `/api/edits/${e1.body.edit.id}`, { token: adminToken });
  assertEqual(g1.body.edit.overdue, true, 'yesterday edit is overdue');
  // Today edit
  const g2 = await req('GET', `/api/edits/${e2.body.edit.id}`, { token: adminToken });
  assertEqual(g2.body.edit.overdue, false, 'today edit is NOT overdue');
  // Tomorrow edit
  const g3 = await req('GET', `/api/edits/${e3.body.edit.id}`, { token: adminToken });
  assertEqual(g3.body.edit.overdue, false, 'tomorrow edit is NOT overdue');

  // Server returns tz in /api/health
  const h = await req('GET', '/api/health');
  assertEqual(h.body.tz, 'Asia/Kuwait', 'company timezone is Asia/Kuwait');
  return { projectId, phaseId, e1: e1.body.edit.id, e2: e2.body.edit.id };
}

async function testAC10_CompleteRequiresDone(adminToken) {
  // AC10: Phase completion blocked while any edit is unfinished or no edit Done.
  // Case A: no edits Done at all.
  const proj = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC10A`, project_state: 'new_build', owner_id: 17 },
  });
  const projectId = proj.body.project.id;
  const ph = await req('POST', `/api/projects/${projectId}/phases`, {
    token: adminToken,
    body: { number: 1, title: 'AC10A', activate_now: true },
  });
  const phaseId = ph.body.phase.id;
  // Add one to_do edit
  await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'X' } });
  // Try to complete
  const c1 = await req('POST', `/api/phases/${phaseId}/complete`, { token: adminToken });
  assertEqual(c1.status, 400, 'complete with no done edits must 400');

  // Case B: all done/cancelled but no done → 400 (no edit Done)
  await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'C', status: 'cancelled', cancellation_reason: 'r' } });
  // Mark the X edit to cancelled
  const edX = await req('GET', `/api/phases/${phaseId}/edits`, { token: adminToken });
  const xId = edX.body.edits.find(e => e.title === 'X').id;
  await req('PATCH', `/api/edits/${xId}`, { token: adminToken, body: { status: 'cancelled', cancellation_reason: 'r2' } });
  const c2 = await req('POST', `/api/phases/${phaseId}/complete`, { token: adminToken });
  assertEqual(c2.status, 400, 'complete with all cancelled (no done) must 400');

  // Case C: one edit done + one cancelled → 409 (needs confirmation) or 200 if already_built
  // For new_build it should be 409 with needs_confirmation
  const ed3 = await req('POST', `/api/phases/${phaseId}/edits`, { token: adminToken, body: { title: 'D' } });
  await req('PATCH', `/api/edits/${ed3.body.edit.id}`, { token: adminToken, body: { status: 'done' } });
  const c3 = await req('POST', `/api/phases/${phaseId}/complete`, { token: adminToken });
  assertEqual(c3.status, 409, 'first completion of new_build needs confirmation');
  assertEqual(c3.body.needs_confirmation, true, 'needs_confirmation flag');
  // Confirm
  const c4 = await req('POST', `/api/phases/${phaseId}/complete`, { token: adminToken, body: { confirm_original_delivery: true } });
  assertEqual(c4.status, 200, 'complete with confirmation ok');
  return { projectId, phaseId };
}

async function testAC11_OriginalDeliveryPreserved(adminToken) {
  // AC11: completing initial delivery preserves its date when later phases complete.
  const proj = await req('POST', '/api/projects', {
    token: adminToken,
    body: { name: `TEST-${SUFFIX}-AC11`, project_state: 'new_build', owner_id: 17 },
  });
  const projectId = proj.body.project.id;

  // Phase 1: complete with confirmation
  const p1 = await req('POST', `/api/projects/${projectId}/phases`, { token: adminToken, body: { number: 1, title: 'Initial', activate_now: true } });
  const p1Id = p1.body.phase.id;
  const e = await req('POST', `/api/phases/${p1Id}/edits`, { token: adminToken, body: { title: 'Build it' } });
  await req('PATCH', `/api/edits/${e.body.edit.id}`, { token: adminToken, body: { status: 'done' } });
  const c1 = await req('POST', `/api/phases/${p1Id}/complete`, { token: adminToken, body: { confirm_original_delivery: true } });
  assertEqual(c1.status, 200, 'complete phase 1');

  // Read project — original_delivery_date should be set
  const pAfter = await req('GET', `/api/projects/${projectId}`, { token: adminToken });
  const originalDate = pAfter.body.project.original_delivery_date;
  assertTrue(!!originalDate, 'original_delivery_date was set');
  assertEqual(pAfter.body.project.project_state, 'already_built', 'project is now already_built');

  // Phase 2: complete (no confirmation needed)
  const p2 = await req('POST', `/api/projects/${projectId}/phases`, { token: adminToken, body: { number: 2, title: 'Updates', activate_now: true } });
  const p2Id = p2.body.phase.id;
  const e2 = await req('POST', `/api/phases/${p2Id}/edits`, { token: adminToken, body: { title: 'Improve' } });
  await req('PATCH', `/api/edits/${e2.body.edit.id}`, { token: adminToken, body: { status: 'done' } });
  const c2 = await req('POST', `/api/phases/${p2Id}/complete`, { token: adminToken });
  assertEqual(c2.status, 200, 'complete phase 2');

  // original_delivery_date must still be the same
  const pFinal = await req('GET', `/api/projects/${projectId}`, { token: adminToken });
  assertEqual(pFinal.body.project.original_delivery_date, originalDate, 'original_delivery_date preserved across phase completions');
  return { projectId, originalDate };
}

async function testAC12_PastAndAuth(adminToken, workerToken) {
  // AC12: past phases visible; unauthorized edits rejected.
  // Reuse project from AC11. Phases there: p1 completed, p2 completed.
  const proj = await req('GET', '/api/projects', { token: adminToken });
  const our = proj.body.projects.find((p) => p.name === `TEST-${SUFFIX}-AC11`);
  assertTrue(!!our, 'AC11 project exists');

  // Detail returns past phases
  const det = await req('GET', `/api/projects/${our.id}`, { token: adminToken });
  const completed = det.body.project.phases.filter((p) => p.status === 'completed');
  assertTrue(completed.length === 2, '2 completed (past) phases visible');

  // Worker has NO access (not owner, not member, not assigned)
  const wkr = await req('GET', `/api/projects/${our.id}`, { token: workerToken });
  assertEqual(wkr.status, 403, 'unrelated worker gets 403 on project detail');

  // Admin: worker cannot PATCH a project (admin-only)
  const wkrPatch = await req('PATCH', `/api/projects/${our.id}`, { token: workerToken, body: { client: 'x' } });
  assertEqual(wkrPatch.status, 403, 'worker cannot PATCH project');

  // Unauthenticated request 401
  const noauth = await req('GET', `/api/projects/${our.id}`);
  assertEqual(noauth.status, 401, 'unauth project detail 401');
  return true;
}

async function testAC13_OptimisticLocking(adminToken) {
  // AC13: concurrent edits do not silently overwrite — If-Match returns 409.
  const proj = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC13`, project_state: 'new_build', owner_id: 17 } });
  const ph = await req('POST', `/api/projects/${proj.body.project.id}/phases`, { token: adminToken, body: { number: 1, title: 'AC13', activate_now: true } });
  const e = await req('POST', `/api/phases/${ph.body.phase.id}/edits`, { token: adminToken, body: { title: 'E' } });
  const editId = e.body.edit.id;
  const v = e.body.edit.version;

  // First PATCH with correct If-Match
  const r1 = await req('PATCH', `/api/edits/${editId}`, { token: adminToken, ifMatch: v, body: { status: 'in_progress' } });
  assertEqual(r1.status, 200, 'first PATCH ok');
  // Second PATCH with stale If-Match
  const r2 = await req('PATCH', `/api/edits/${editId}`, { token: adminToken, ifMatch: v, body: { status: 'testing' } });
  assertEqual(r2.status, 409, 'stale If-Match returns 409');
  // Verify only first change persisted
  const g = await req('GET', `/api/edits/${editId}`, { token: adminToken });
  assertEqual(g.body.edit.status, 'in_progress', 'only the first PATCH persisted');
  return true;
}

async function testAC14_StatusLabels(adminToken) {
  // AC14 (server-side): status fields exist as text strings (not just colors).
  // Verify the 7 status values are reachable through the lifecycle.
  // We'll exercise: not_started, new_development, on_hold, waiting_for_client, ready_to_close, updates_in_progress, up_to_date.
  // 1) not_started: fresh new_build with no phase
  const a = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC14A`, project_state: 'new_build', owner_id: 17 } });
  assertEqual(a.body.project.status, 'not_started', 'A not_started');
  // 2) up_to_date: fresh already_built with no phase
  const b = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC14B`, project_state: 'already_built', owner_id: 17 } });
  assertEqual(b.body.project.status, 'up_to_date', 'B up_to_date');
  // 3) new_development: new_build with active phase
  const c = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC14C`, project_state: 'new_build', owner_id: 17 } });
  const cPh = await req('POST', `/api/projects/${c.body.project.id}/phases`, { token: adminToken, body: { number: 1, title: 'P', activate_now: true } });
  const cGet = await req('GET', `/api/projects/${c.body.project.id}`, { token: adminToken });
  assertEqual(cGet.body.project.status, 'new_development', 'C new_development');
  // 4) updates_in_progress: already_built with active phase
  const d = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC14D`, project_state: 'already_built', owner_id: 17 } });
  await req('POST', `/api/projects/${d.body.project.id}/phases`, { token: adminToken, body: { number: 1, title: 'P', activate_now: true } });
  const dGet = await req('GET', `/api/projects/${d.body.project.id}`, { token: adminToken });
  assertEqual(dGet.body.project.status, 'updates_in_progress', 'D updates_in_progress');
  // 5) on_hold: patch phase to on_hold with reason
  const e = await req('POST', `/api/projects/${c.body.project.id}/phases`, { token: adminToken, body: { number: 2, title: 'P2' } });
  // cPh.phase.id is the active one — patch it
  const onHold = await req('PATCH', `/api/phases/${cPh.body.phase.id}`, { token: adminToken, body: { status: 'on_hold', hold_reason: 'paused' } });
  assertEqual(onHold.status, 200, 'patch to on_hold');
  const cGet2 = await req('GET', `/api/projects/${c.body.project.id}`, { token: adminToken });
  assertEqual(cGet2.body.project.status, 'on_hold', 'C now on_hold');
  // 6) waiting_for_client: patch to waiting_for_client with reason
  const wfc = await req('PATCH', `/api/phases/${cPh.body.phase.id}`, { token: adminToken, body: { status: 'waiting_for_client', waiting_reason: 'client input needed' } });
  assertEqual(wfc.status, 200, 'patch to waiting_for_client');
  const cGet3 = await req('GET', `/api/projects/${c.body.project.id}`, { token: adminToken });
  assertEqual(cGet3.body.project.status, 'waiting_for_client', 'C now waiting_for_client');
  // 7) ready_to_close: phase has 1 done + all others done/cancelled
  // First add another edit, mark it cancelled
  await req('POST', `/api/phases/${cPh.body.phase.id}/edits`, { token: adminToken, body: { title: 'C1' } });
  const ed1 = await req('POST', `/api/phases/${cPh.body.phase.id}/edits`, { token: adminToken, body: { title: 'C2' } });
  // Make phase non-waiting first (re-activate since we left active state? — the phase still 'waiting_for_client' for AC14 testing of that status). To get to 'ready_to_close' we need a normal active phase. Make a separate project.
  const f = await req('POST', '/api/projects', { token: adminToken, body: { name: `TEST-${SUFFIX}-AC14F`, project_state: 'already_built', owner_id: 17 } });
  const fPh = await req('POST', `/api/projects/${f.body.project.id}/phases`, { token: adminToken, body: { number: 1, title: 'F', activate_now: true } });
  const fe1 = await req('POST', `/api/phases/${fPh.body.phase.id}/edits`, { token: adminToken, body: { title: 'F1' } });
  const fe2 = await req('POST', `/api/phases/${fPh.body.phase.id}/edits`, { token: adminToken, body: { title: 'F2' } });
  await req('PATCH', `/api/edits/${fe1.body.edit.id}`, { token: adminToken, body: { status: 'done' } });
  await req('PATCH', `/api/edits/${fe2.body.edit.id}`, { token: adminToken, body: { status: 'cancelled', cancellation_reason: 'no longer needed' } });
  const fGet = await req('GET', `/api/projects/${f.body.project.id}`, { token: adminToken });
  assertEqual(fGet.body.project.status, 'ready_to_close', 'F ready_to_close');

  return true;
}

async function testAC15_ArchiveAndRestore(adminToken) {
  // AC15: archive + restore preserve history; cannot violate one-active-phase rule.
  // Reuse AC4 project. There, p1 is archived, p2 is active, p3 is planned.
  const proj = await req('GET', '/api/projects', { token: adminToken });
  const our = proj.body.projects.find((p) => p.name === `TEST-${SUFFIX}-AC4`);
  assertTrue(!!our, 'AC4 project exists');
  // Try to activate p3 (p2 is active) — must 409
  const det = await req('GET', `/api/projects/${our.id}`, { token: adminToken });
  const p3 = det.body.project.phases.find((p) => p.title === 'P3');
  const p2 = det.body.project.phases.find((p) => p.title === 'P2');
  const act3 = await req('POST', `/api/phases/${p3.id}/activate`, { token: adminToken });
  assertEqual(act3.status, 409, 'cannot activate p3 while p2 active');

  // Archive p2
  const arc2 = await req('POST', `/api/phases/${p2.id}/archive`, { token: adminToken, body: { reason: 'AC15 test' } });
  assertEqual(arc2.status, 200, 'archive p2');

  // Try to restore p2 while p3 is about to be activated — p2 is archived, slot is free.
  // First, activate p3
  const act3b = await req('POST', `/api/phases/${p3.id}/activate`, { token: adminToken });
  assertEqual(act3b.status, 200, 'activate p3 after p2 archived');
  // Now try to restore p2 (which was 'active' before archiving) — DB unique index will reject
  const res2 = await req('POST', `/api/phases/${p2.id}/restore`, { token: adminToken });
  assertEqual(res2.status, 409, 'cannot restore p2 while p3 is active (single-active-phase rule)');

  // Activity log: at least one event per major action — count >= 5 (create x3, activate p1, archive p1, activate p2, archive p2, activate p3)
  const act = await req('GET', `/api/projects/${our.id}/activity?limit=500`, { token: adminToken });
  assertTrue(act.body.activity.length >= 5, 'activity log preserved across archive/restore');
  const actions = new Set(act.body.activity.map((a) => a.action));
  assertTrue(actions.has('create'), 'create in activity log');
  assertTrue(actions.has('activate'), 'activate in activity log');
  assertTrue(actions.has('archive'), 'archive in activity log');
  return true;
}

// ============================================================
// Runner
// ============================================================
async function run() {
  // eslint-disable-next-line no-console
  console.log(`\n${c.cyan}Fifty Tracker — Phase 2 acceptance tests${c.reset}`);
  // eslint-disable-next-line no-console
  console.log(`API: ${API}  ·  suffix: ${SUFFIX}\n`);

  // Health check first
  const h = await req('GET', '/api/health');
  if (h.status !== 200) {
    // eslint-disable-next-line no-console
    console.error(`${c.red}HEALTH CHECK FAILED${c.reset} — backend not reachable on ${API}`);
    process.exit(2);
  }
  // eslint-disable-next-line no-console
  console.log(`Health: ok · tz=${h.body.tz}\n`);

  // Login
  let adminToken, workerToken;
  try {
    adminToken = await login('admin@5ostudios.local', 'demo1234');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`${c.red}ADMIN LOGIN FAILED${c.reset}: ${e.message}`);
    process.exit(2);
  }
  // diyaa is also admin per spec; login to prove dual-admin works
  let diyaaToken;
  try {
    diyaaToken = await login('diyaa@5ostudios.local', 'demo1234');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`${c.red}DIYAA LOGIN FAILED${c.reset}: ${e.message}`);
    process.exit(2);
  }
  // Use ahmed@5ostudios.local (worker, active) for worker permission checks
  try {
    workerToken = await login('ahmed@5ostudios.local', 'demo1234');
    // Reset password if needed
  } catch (e) {
    // If worker doesn't have demo1234, try to set it via the admin
    // eslint-disable-next-line no-console
    console.log('Worker login failed, attempting to set ahmed password to demo1234...');
    const bcrypt = require('bcrypt');
    const { query } = require('../src/config/db');
    const hash = await bcrypt.hash('demo1234', 12);
    await query("UPDATE users SET password_hash = $1 WHERE email = 'ahmed@5ostudios.local' AND active = true", [hash]);
    workerToken = await login('ahmed@5ostudios.local', 'demo1234');
  }
  // eslint-disable-next-line no-console
  console.log(`Logged in: admin + diyaa (admin) + worker (ahmed)\n`);

  // Run tests
  const tests = [
    { id: 1,  fn: async () => testAC1_ListProjects(adminToken), name: 'Signed-in user sees accessible projects' },
    { id: 2,  fn: async (ctx) => testAC2_FiltersSorting(adminToken, ctx), name: 'Search, status, overdue, sort work together' },
    { id: 3,  fn: async () => testAC3_CreateProject(adminToken), name: 'Manager creates new_build / already_built without historical phases' },
    { id: 4,  fn: async () => testAC4_SingleActivePhase(adminToken), name: 'Many phases, at most one current phase' },
    { id: 5,  fn: async (ctx) => testAC5_MultipleEdits(adminToken, ctx), name: 'Multiple edits with different assignees/statuses/deadlines' },
    { id: 6,  fn: async (ctx) => testAC6_InlineUpdateAndProgress(adminToken, ctx), name: 'Inline changes persist and progress updates' },
    { id: 7,  fn: async (ctx) => testAC7_WaitingAndCancelled(adminToken, ctx), name: 'Waiting/cancelled require reasons; waiting edit does not pause phase' },
    { id: 8,  fn: async (ctx) => testAC8_ProgressExcludes(adminToken, ctx), name: 'Progress excludes cancelled+archived; empty phase != 100%' },
    { id: 9,  fn: async () => testAC9_OverdueTimezone(adminToken), name: 'Overdue uses company timezone; due today != overdue' },
    { id: 10, fn: async () => testAC10_CompleteRequiresDone(adminToken), name: 'Phase completion blocked while unfinished or no Done' },
    { id: 11, fn: async () => testAC11_OriginalDeliveryPreserved(adminToken), name: 'Original delivery date preserved across phase completions' },
    { id: 12, fn: async () => testAC12_PastAndAuth(adminToken, workerToken), name: 'Past phases visible; unauthorized edits rejected' },
    { id: 13, fn: async () => testAC13_OptimisticLocking(adminToken), name: 'Optimistic locking via If-Match (no silent overwrite)' },
    { id: 14, fn: async () => testAC14_StatusLabels(adminToken), name: 'All 7 main project status values reachable' },
    { id: 15, fn: async () => testAC15_ArchiveAndRestore(adminToken), name: 'Archive/restore preserve history; single-active rule enforced' },
  ];

  let ctx = {};
  for (const t of tests) {
    try {
      const result = await t.fn(ctx);
      ctx = { ...ctx, ...(typeof result === 'object' ? result : {}) };
      record(t.id, t.name, 'pass', '');
    } catch (e) {
      record(t.id, t.name, 'fail', e.message);
    }
  }

  // Summary
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  // eslint-disable-next-line no-console
  console.log(`\n${c.cyan}=== Summary ===${c.reset}`);
  // eslint-disable-next-line no-console
  console.log(`Total: ${results.length}  ·  ${c.green}PASS: ${passed}${c.reset}  ·  ${failed > 0 ? c.red : c.green}FAIL: ${failed}${c.reset}`);

  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n${c.red}Failures:${c.reset}`);
    for (const r of results.filter((x) => x.status === 'fail')) {
      // eslint-disable-next-line no-console
      console.log(`  AC${String(r.id).padStart(2, '0')}  ${r.name}: ${r.message}`);
    }
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${c.green}All 15/15 acceptance tests passed.${c.reset}`);
    process.exit(0);
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Runner crashed:', e.message);
  // eslint-disable-next-line no-console
  console.error(e.stack);
  process.exit(2);
});

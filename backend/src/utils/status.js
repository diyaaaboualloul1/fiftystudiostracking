// src/utils/status.js — derive main project status (simplified to 4 values)
//
// Rules (from MD §6, simplified):
//  1. Current phase On hold OR Waiting for client → "paused"
//  2. Current phase has at least one Done edit AND every edit is Done or Cancelled → "ready"
//  3. Current phase exists (and not paused/ready) → "active"
//  4. No current phase → "active" (work is ready to start or already up to date)
//
// Archived status is set separately when the project itself is archived.
//
// Inputs:
//   project = { project_state } or null when archived
//   activePhase = { status, ... } | null  (the current phase object; null when no active phase)
//   edits = array of edits in the active phase (may be empty)
//
// Returns one of: "active" | "paused" | "ready" | "archived"

const { computeProgress } = require('./progress');

function deriveStatus(project, activePhase, edits) {
  if (!activePhase) {
    // No active phase → "active" (work is ready to start or already up to date)
    return 'active';
  }

  // Rule 1: phase is paused (on hold or waiting for client)
  if (activePhase.status === 'on_hold' || activePhase.status === 'waiting_for_client') {
    return 'paused';
  }

  // Rule 2: ready to close — at least one Done AND every non-archived, non-cancelled edit is Done.
  const visible = (edits || []).filter((e) => e.status !== 'cancelled' && !e.archived_at);
  const doneCount = visible.filter((e) => e.status === 'done').length;
  if (visible.length > 0 && doneCount === visible.length) {
    return 'ready';
  }

  // Rule 3: has active phase and work is happening → "active"
  return 'active';
}

module.exports = { deriveStatus };

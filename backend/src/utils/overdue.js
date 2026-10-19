// src/utils/overdue.js — overdue checks in the company timezone
//
// Rules (MD §7 "Deadlines"):
//   - An unfinished edit is overdue when its due date is BEFORE today's company date.
//   - An uncompleted current phase is overdue when its phase deadline is BEFORE today's company date.
//   - Items due today are NOT overdue until the next day.
//   - "done" and "cancelled" statuses make an edit NOT overdue.
//   - "completed" makes a phase NOT overdue.

const { today, toDateStrInTz } = require('./today');

// Returns true if `deadlineDate` (YYYY-MM-DD or Date) is strictly before today.
function isOverdueDeadline(deadlineDate) {
  if (!deadlineDate) return false;
  const s = toDateStrInTz(deadlineDate);
  if (!s) return false;
  return s < today();
}

// Edit overdue: deadline exists, deadline < today, status NOT IN ('done','cancelled'), not archived.
function isEditOverdue(edit) {
  if (!edit || !edit.deadline) return false;
  if (edit.archived_at) return false;
  if (edit.status === 'done' || edit.status === 'cancelled') return false;
  return isOverdueDeadline(edit.deadline);
}

// Phase overdue: deadline exists, deadline < today, status != 'completed', not archived.
function isPhaseOverdue(phase) {
  if (!phase || !phase.deadline) return false;
  if (phase.archived_at) return false;
  if (phase.status === 'completed') return false;
  return isOverdueDeadline(phase.deadline);
}

// "Edit exceeds phase deadline" — when the edit's deadline is after the phase's deadline.
function editExceedsPhase(edit, phase) {
  if (!edit || !phase) return false;
  if (!edit.deadline || !phase.deadline) return false;
  const eS = toDateStrInTz(edit.deadline);
  const pS = toDateStrInTz(phase.deadline);
  if (!eS || !pS) return false;
  return eS > pS;
}

module.exports = { isOverdueDeadline, isEditOverdue, isPhaseOverdue, editExceedsPhase };

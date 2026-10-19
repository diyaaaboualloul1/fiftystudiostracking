// src/utils/progress.js — phase progress calculation
//
// Per MD §7 "Progress":
//   - Count only edits within the active phase.
//   - Exclude cancelled AND archived edits from the denominator.
//   - A phase with no non-cancelled, non-archived edits shows "No edits" (total=0).
//
// Returns:
//   { done: <int>, total: <int>, label: <string>, percent: <number|null> }
//
// "label" examples:
//   "No edits"
//   "2 / 5 done"
//   "3 / 3 done"

function computeProgress(edits) {
  const visible = (edits || []).filter(
    (e) => e.status !== 'cancelled' && !e.archived_at
  );
  const total = visible.length;
  const done = visible.filter((e) => e.status === 'done').length;
  let label;
  let percent;
  if (total === 0) {
    label = 'No edits';
    percent = null;
  } else {
    label = `${done} / ${total} done`;
    percent = Math.round((done / total) * 100);
  }
  return { done, total, label, percent };
}

module.exports = { computeProgress };

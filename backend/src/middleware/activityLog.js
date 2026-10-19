// src/middleware/activityLog.js — record an activity_events row inside a transaction
//
// Usage inside a route (must use the same `client` from withTx):
//   await withTx(async (client) => {
//     const before = await client.query('SELECT ... FROM edits WHERE id=$1', [id]);
//     await client.query('UPDATE edits ...');
//     await logActivity(client, {
//       project_id, entity_type:'edit', entity_id:id, actor_id:req.user.id,
//       action:'update', old_values: before.rows[0], new_values: { ... }
//     });
//   });
//
// `action` is a free string but recommended values:
//   'create' | 'update' | 'archive' | 'restore' | 'activate' | 'complete'
//   'add_member' | 'remove_member' | 'add_link' | 'update_link' | 'remove_link' | 'add_note'

async function logActivity(client, opts) {
  const {
    project_id,
    entity_type,
    entity_id = null,
    actor_id = null,
    action,
    old_values = null,
    new_values = null,
    reason = null,
  } = opts || {};

  if (!project_id) throw new Error('logActivity: project_id is required');
  if (!entity_type) throw new Error('logActivity: entity_type is required');
  if (!action) throw new Error('logActivity: action is required');

  await client.query(
    `INSERT INTO activity_events
       (project_id, entity_type, entity_id, actor_id, action, old_values, new_values, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      project_id,
      entity_type,
      entity_id,
      actor_id,
      action,
      old_values ? JSON.stringify(old_values) : null,
      new_values ? JSON.stringify(new_values) : null,
      reason,
    ]
  );
}

module.exports = { logActivity };

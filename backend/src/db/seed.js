// src/db/seed.js — seed the first admin
const { pool, query } = require('../config/db');
const { hash } = require('../utils/password');

const ADMIN_EMAIL = 'admin@5ostudios.local';
const ADMIN_PASSWORD = 'changeme';
const ADMIN_NAME = 'Fifty Studios Admin';

async function main() {
  // eslint-disable-next-line no-console
  console.log('[seed] starting first-admin seed');
  const existing = await query('SELECT id, active FROM users WHERE email = $1', [ADMIN_EMAIL]);
  if (existing.rowCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`[seed] admin already exists (id=${existing.rows[0].id}) — nothing to do`);
    return;
  }
  const passwordHash = await hash(ADMIN_PASSWORD);
  const result = await query(
    `INSERT INTO users (name, email, password_hash, role, active)
     VALUES ($1, $2, $3, 'admin', true)
     RETURNING id, email, role, active, created_at`,
    [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
  );
  const u = result.rows[0];
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('==================================================');
  // eslint-disable-next-line no-console
  console.log('  FIRST ADMIN CREATED');
  // eslint-disable-next-line no-console
  console.log(`  id    : ${u.id}`);
  // eslint-disable-next-line no-console
  console.log(`  email : ${ADMIN_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log(`  pass  : ${ADMIN_PASSWORD}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('  >>> CHANGE THIS PASSWORD ON FIRST LOGIN <<<');
  // eslint-disable-next-line no-console
  console.log('==================================================');
  // eslint-disable-next-line no-console
  console.log('');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] FAILED', err.message);
    // eslint-disable-next-line no-console
    console.error(err.stack);
    pool.end();
    process.exit(1);
  });

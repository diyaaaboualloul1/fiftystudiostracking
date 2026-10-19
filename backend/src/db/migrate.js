// src/db/migrate.js — run SQL files in src/db/migrations/ in order
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function applied() {
  const result = await query('SELECT name FROM _migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function applyOne(file) {
  const full = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(full, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[migrate] applying ${file}`);
  await query(sql);
  await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
}

async function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[migrate] no migrations to run');
    return;
  }
  await ensureTable();
  const done = await applied();
  let count = 0;
  for (const f of files) {
    if (done.has(f)) {
      // eslint-disable-next-line no-console
      console.log(`[migrate] skip ${f} (already applied)`);
      continue;
    }
    await applyOne(f);
    count += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[migrate] done — ${count} applied, ${files.length - count} skipped`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] FAILED', err.message);
    // eslint-disable-next-line no-console
    console.error(err.stack);
    pool.end();
    process.exit(1);
  });

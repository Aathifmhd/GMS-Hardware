// One-time copy of all data from another Postgres database (e.g. the old Neon one) into DATABASE_URL
// (e.g. the new Supabase one). Put both connection strings in backend/.env, then: npm run copy-db
//   SOURCE_DATABASE_URL = the old database (only read)     DATABASE_URL = the new, still empty database
// Everything is copied in one transaction, so a failed copy leaves the new database unchanged.
const { Client } = require('pg');
const { db, pool, tx, ready, connectionConfig } = require('./db');

// Parents before children, so every foreign key finds its row. Sessions and login failures are not
// copied: everyone signs in again on the new database.
const TABLES = ['users', 'settings', 'templates', 'areas', 'credit_types', 'customers', 'transactions', 'allocations', 'messages', 'audit_log'];
const ROWS_PER_INSERT = 500;
const COLUMNS = 'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position';
const MONEY = 'SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)::text AS total FROM transactions WHERE voided = 0';

let src = null;
(async () => {
  const sourceUrl = String(process.env.SOURCE_DATABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  if (!/^postgres(ql)?:\/\//.test(sourceUrl) || !URL.canParse(sourceUrl)) throw new Error('Set SOURCE_DATABASE_URL to the old database\'s connection string (in backend/.env).');
  if (!pool) throw new Error('Set DATABASE_URL to the new database\'s connection string (in backend/.env).');

  src = new Client(connectionConfig(sourceUrl));
  await src.connect();
  await ready(); // creates the tables in the new database if they are not there yet

  const existing = await db.get('SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM transactions) AS entries');
  if (existing.customers || existing.entries) {
    throw new Error(`The new database already has ${existing.customers} customers and ${existing.entries} entries. copy-db only fills an empty database.`);
  }

  const copied = [];
  await tx(async () => {
    // remove the default users, settings, templates and credit types the new database started with
    await db.exec(`TRUNCATE ${[...TABLES, 'sessions', 'login_failures'].join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of TABLES) {
      if (!(await src.query('SELECT to_regclass($1) AS t', [table])).rows[0].t) { copied.push([table, null]); continue; }
      const target = (await db.all(COLUMNS, table)).map((r) => r.column_name);
      const cols = (await src.query(COLUMNS, [table])).rows.map((r) => r.column_name).filter((c) => target.includes(c));
      const list = cols.map((c) => `"${c}"`).join(', ');
      const { rows } = await src.query(`SELECT ${list} FROM ${table} ORDER BY ${cols.includes('id') ? 'id' : 'key'}`);
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        const part = rows.slice(i, i + ROWS_PER_INSERT);
        await db.run(`INSERT INTO ${table} (${list}) VALUES ${part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`,
          ...part.flatMap((r) => cols.map((c) => r[c])));
      }
      if (cols.includes('id')) await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table}`);
      copied.push([table, rows.length]);
    }
  });

  // check: the same row counts and the same money total on both sides
  let ok = true;
  console.log('\n  table           old database   new database');
  for (const [table, n] of copied) {
    if (n === null) { console.log(`  ${table.padEnd(16)}not in the old database`); continue; }
    const now = (await db.get(`SELECT COUNT(*) AS c FROM ${table}`)).c;
    ok &&= now === n;
    console.log(`  ${table.padEnd(16)}${String(n).padStart(12)}${String(now).padStart(15)}${now === n ? '' : '   MISMATCH'}`);
  }
  const [before, after] = [(await src.query(MONEY)).rows[0].total, (await db.get(MONEY)).total];
  ok &&= before === after;
  console.log(`\n  Total of all entries: old ${before}, new ${after}${before === after ? '' : '   MISMATCH'}`);
  console.log(ok ? '\nCopy complete. Point DATABASE_URL (Vercel and backend/.env) at the new database and remove SOURCE_DATABASE_URL.'
    : '\nThe copy finished but the totals differ. Check the lines marked MISMATCH before switching over.');
  await src.end();
  await pool.end();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error(`\nCopy failed: ${e.message}`);
  await src?.end().catch(() => {});
  await pool?.end().catch(() => {});
  process.exit(1);
});

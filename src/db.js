// Postgres (Neon) database — connection pool, schema, seed data and small query helpers.
// Works locally (DATABASE_URL in .env) and on Vercel serverless functions.
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');

types.setTypeParser(20, (v) => parseInt(v, 10)); // COUNT / bigint → number
types.setTypeParser(1700, parseFloat);           // numeric → number

const TZ = /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(process.env.APP_TIMEZONE || '') ? process.env.APP_TIMEZONE : 'Asia/Colombo';
// Local "now" as 'YYYY-MM-DD HH24:MI:SS' text in the shop's timezone (server clocks are UTC on Vercel)
const NOW = `to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`;

// Tolerate common paste mistakes in the dashboard: surrounding quotes/spaces or a leading "DATABASE_URL="
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim().replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '').trim();

function configError() {
  const e = new Error(DATABASE_URL
    ? 'DATABASE_URL is not a valid postgresql:// connection string. Fix it in Vercel → Settings → Environment Variables, then redeploy.'
    : 'DATABASE_URL is not set. Add your Neon connection string in Vercel → Settings → Environment Variables (or .env on this PC), then redeploy.');
  e.status = 503;
  e.expose = true;
  return e;
}

// Created without a valid URL the app still starts, so every request can report what is wrong
const pool = /^postgres(ql)?:\/\//.test(DATABASE_URL)
  ? new Pool({ connectionString: DATABASE_URL, max: process.env.VERCEL ? 5 : 10, idleTimeoutMillis: 10000 })
  : null;
const txStore = new AsyncLocalStorage();

// '?' placeholders → $1, $2 … so queries read the same as before
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
async function query(sql, params = []) {
  if (!pool) throw configError();
  const client = txStore.getStore() || pool;
  return client.query(toPg(sql), params.map((p) => (p === undefined ? null : p)));
}

const db = {
  all: async (sql, ...p) => (await query(sql, p)).rows,
  get: async (sql, ...p) => (await query(sql, p)).rows[0],
  run: async (sql, ...p) => { const r = await query(sql, p); return { changes: r.rowCount, id: r.rows[0]?.id }; },
  exec: (sql) => query(sql),
};

// Run fn inside one transaction; queries made by fn (and anything it awaits) use the same connection.
async function tx(fn) {
  if (txStore.getStore()) return fn();
  if (!pool) throw configError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await txStore.run(client, fn);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  collector TEXT,
  visit_day TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_areas_name ON areas (lower(name));

CREATE TABLE IF NOT EXISTS credit_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
  default_period_days INTEGER NOT NULL DEFAULT 30,
  interest_rate DOUBLE PRECISION,
  color TEXT DEFAULT '#2a78d6',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_types_name ON credit_types (lower(name));

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  business_name TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  nic TEXT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  credit_type_id INTEGER REFERENCES credit_types(id) ON DELETE SET NULL,
  credit_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
  credit_period_days INTEGER NOT NULL DEFAULT 30,
  interest_enabled INTEGER NOT NULL DEFAULT 1,
  preferred_channel TEXT NOT NULL DEFAULT 'sms',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Debits (credit sales, interest, opening balance, debit adjustments) and credits (payments, credit adjustments)
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit','interest','opening','debit_adj','payment','credit_adj')),
  ref_no TEXT,
  date TEXT NOT NULL,
  due_date TEXT,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  settled DOUBLE PRECISION NOT NULL DEFAULT 0,
  interest_cycles INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  description TEXT,
  payment_method TEXT,
  cheque_no TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  void_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS ix_tx_customer ON transactions(customer_id, voided);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS ix_tx_parent ON transactions(parent_id);

CREATE TABLE IF NOT EXISTS allocations (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  debit_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alloc_payment ON allocations(payment_id);
CREATE INDEX IF NOT EXISTS ix_alloc_debit ON allocations(debit_id);

CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT, body TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL,
  error TEXT,
  link TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS ix_msg_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS ix_msg_customer ON messages(customer_id, kind);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
`;

// ---------- helpers ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const DEFAULT_SETTINGS = {
  business_name: 'GMS Hardware',
  business_address: '',
  business_phone: '',
  business_email: '',
  currency: 'Rs.',
  country_code: '94',
  interest_enabled: '1',
  interest_rate: '1',
  interest_cycle_days: '30',
  interest_grace_days: '0',
  auto_notify_payment: '1',
  auto_notify_credit: '1',
  auto_notify_interest: '1',
  auto_due_reminder: '1',
  due_reminder_days: '3',
  auto_overdue_notice: '1',
  overdue_notice_every_days: '7',
  default_channel: 'sms',
  sms_provider: 'none',
  sms_notifylk_user_id: '',
  sms_notifylk_api_key: '',
  sms_sender_id: '',
  sms_textlk_token: '',
  sms_generic_method: 'GET',
  sms_generic_url: '',
  sms_generic_body: '',
  whatsapp_mode: 'link',
  whatsapp_token: '',
  whatsapp_phone_id: '',
  email_enabled: '0',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  last_auto_run: '',
};

const DEFAULT_TEMPLATES = [
  ['credit_created', 'New credit sale', 'New credit bill {ref_no}',
    'Dear {name}, a credit bill {ref_no} of {amount} was added on {date}. Due date: {due_date}. Total outstanding: {balance}. - {business}'],
  ['payment_received', 'Payment received', 'Payment received - thank you',
    'Dear {name}, we received your payment of {amount} on {date} (Ref {ref_no}). Remaining balance: {balance}. Thank you! - {business}'],
  ['due_reminder', 'Due date reminder', 'Payment reminder',
    'Dear {name}, friendly reminder: {amount} on bill {ref_no} is due on {due_date}. Please settle on time to avoid {rate}% interest. - {business}'],
  ['overdue_notice', 'Overdue notice', 'Overdue payment notice',
    'Dear {name}, your account has an overdue amount of {overdue}. Total outstanding: {balance}. Please settle immediately. {rate}% interest applies per {cycle} days overdue. - {business}'],
  ['interest_applied', 'Interest applied', 'Interest charged on overdue bill',
    'Dear {name}, {rate}% interest ({amount}) was added to overdue bill {ref_no}. New outstanding: {balance}. - {business}'],
  ['statement', 'Account statement', 'Your account statement',
    'Dear {name}, your current outstanding balance with {business} is {balance} (overdue: {overdue}). Credit limit: {limit}. Thank you for your business.'],
  ['custom', 'Custom / promotion', 'Message from {business}',
    'Dear {name}, '],
];

async function init() {
  if (!pool) throw configError();
  try {
    await pool.query(SCHEMA);
  } catch (e) {
    const ce = new Error(`Cannot connect to the database: ${e.message}. Check DATABASE_URL in the Vercel settings.`);
    ce.status = 503;
    ce.expose = true;
    throw ce;
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', k, v);
  }
  for (const t of DEFAULT_TEMPLATES) {
    await db.run('INSERT INTO templates (key, name, subject, body) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO NOTHING', ...t);
  }
  if ((await db.get('SELECT COUNT(*) AS c FROM users')).c === 0) {
    await db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', 'owner', hashPassword('owner123'), 'Shop Owner', 'owner');
    await db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', 'staff', hashPassword('staff123'), 'Counter Staff', 'staff');
  }
  if ((await db.get('SELECT COUNT(*) AS c FROM credit_types')).c === 0) {
    const ins = 'INSERT INTO credit_types (name, description, default_limit, default_period_days, color) VALUES (?, ?, ?, ?, ?)';
    await db.run(ins, 'Regular', 'Walk-in regular customers', 50000, 30, '#2a78d6');
    await db.run(ins, 'Contractor', 'Building contractors & masons', 250000, 45, '#eb6834');
    await db.run(ins, 'Wholesale', 'Re-sellers and small shops', 500000, 60, '#1baf7a');
    await db.run(ins, 'Cheque', 'Post-dated cheque customers', 150000, 30, '#6250d6');
  }
}
let readyPromise = null;
const ready = () => (readyPromise ||= init().catch((e) => { readyPromise = null; throw e; }));

async function getSettings() {
  const s = {};
  for (const r of await db.all('SELECT key, value FROM settings')) s[r.key] = r.value;
  return s;
}
async function setSetting(key, value) {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key, value == null ? '' : String(value));
}
async function audit(userId, action, entity, entityId, details) {
  await db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    userId ?? null, action, entity ?? null, entityId ?? null, details ? String(details) : null);
}

module.exports = { db, pool, tx, ready, NOW, TZ, hashPassword, verifyPassword, getSettings, setSetting, audit };

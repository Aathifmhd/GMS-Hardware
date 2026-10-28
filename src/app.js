// GMS Hardware — Customer Credit Management System (Express API + static frontend)
// Used by src/server.js (local) and api/index.js (Vercel).
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, tx, ready, NOW, TZ, hashPassword, verifyPassword, getSettings, setSetting, audit } = require('./db');
const L = require('./ledger');
const M = require('./messaging');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const ROLE_RANK = { staff: 1, manager: 2, owner: 3 };
const err = L.httpError;
// async route wrapper: forwards rejections to the error handler
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SESSION_EXPIRY = `to_char((now() + interval '12 hours') AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`;

// Status check (no login): open /api/health to see whether the database is reachable
app.get('/api/health', (req, res) => ready().then(
  () => res.json({ ok: true, database: 'connected', timezone: TZ, cron_secret_set: !!process.env.CRON_SECRET }),
  (e) => res.status(503).json({ ok: false, error: e.message }),
));

// make sure the schema exists before the first query of a cold start
app.use('/api', (req, res, next) => ready().then(() => next(), next));

// ---------- scheduled job (Vercel Cron calls this daily with the CRON_SECRET) ----------
app.get('/api/cron', h(async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const r = await M.runDailyAutomation();
  res.json({ interest_charges: r.interest.length, reminders: r.reminders, overdue_notices: r.overdue, skipped: r.skipped });
}));

// ---------- auth ----------
// Slow down password guessing: an IP address with LOGIN_MAX_FAILS wrong passwords in the last
// 15 minutes cannot log in until the oldest of them is 15 minutes old.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW = `to_char((now() - interval '15 minutes') AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`;
// Vercel overwrites x-forwarded-for with the caller's real address, so it cannot be spoofed there
const clientIp = (req) => (process.env.VERCEL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

app.post('/api/auth/login', h(async (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username || '');
  const ip = clientIp(req);
  const fails = (await db.get(`SELECT COUNT(*) AS c FROM login_failures WHERE ip = ? AND created_at > ${LOGIN_WINDOW}`, ip)).c;
  if (fails >= LOGIN_MAX_FAILS) return res.status(429).json({ error: 'Too many wrong passwords. Please wait 15 minutes and try again.' });
  const u = await db.get('SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1', name);
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    await db.run(`DELETE FROM login_failures WHERE created_at <= ${LOGIN_WINDOW}`);
    await db.run('INSERT INTO login_failures (ip, username) VALUES (?, ?)', ip, name.slice(0, 100));
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  await db.run('DELETE FROM login_failures WHERE ip = ? AND lower(username) = lower(?)', ip, name);
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ${SESSION_EXPIRY})`, token, u.id);
  await db.run(`DELETE FROM sessions WHERE expires_at < ${NOW}`);
  await audit(u.id, 'login', 'user', u.id);
  res.json({ token, user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role } });
}));

app.use('/api', h(async (req, res, next) => {
  const hd = req.headers.authorization || '';
  const token = hd.startsWith('Bearer ') ? hd.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const row = await db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ${NOW} AND u.active = 1`, token);
  if (!row) return res.status(401).json({ error: 'Session expired' });
  req.user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
  next();
}));
const role = (min) => (req, res, next) =>
  ROLE_RANK[req.user.role] >= ROLE_RANK[min] ? next() : res.status(403).json({ error: `Only ${min}${min === 'owner' ? '' : ' or above'} can do this` });

app.post('/api/auth/logout', h(async (req, res) => {
  await db.run('DELETE FROM sessions WHERE token = ?', (req.headers.authorization || '').slice(7));
  res.json({ ok: true });
}));
app.get('/api/auth/me', h(async (req, res) => {
  const s = await getSettings();
  res.json({ user: req.user, business: { name: s.business_name, currency: s.currency } });
}));
app.post('/api/auth/password', h(async (req, res) => {
  const { current, next: nw } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) throw err(400, 'Current password is wrong');
  if (!nw || String(nw).length < 6) throw err(400, 'New password must be at least 6 characters');
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(nw)), u.id);
  await audit(u.id, 'change_password', 'user', u.id);
  res.json({ ok: true });
}));

// ---------- helpers ----------
function dateParam(v, fallback) {
  if (v == null || v === '') return fallback;
  if (!L.isDate(v)) throw err(400, `Invalid date: ${v}`);
  return v;
}
function monthStart() { return L.today().slice(0, 8) + '01'; }
function intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v) { return v == null ? null : (String(v).trim() || null); }
const sum = (arr, k) => L.round2(arr.reduce((s, x) => s + (typeof k === 'function' ? k(x) : x[k]), 0));

function customerQuery(asOf, where = '1=1') {
  return `SELECT c.*, a.name AS area_name, ct.name AS type_name, ct.color AS type_color, ${L.balanceColumns(asOf)}
    FROM customers c LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN credit_types ct ON ct.id = c.credit_type_id
    WHERE ${where}`;
}
function decorate(c, asOf) {
  c.balance = L.round2(c.balance);
  c.overdue = L.round2(c.overdue);
  c.days_overdue = c.oldest_overdue ? L.diffDays(asOf, c.oldest_overdue) : 0;
  c.available = L.round2(c.credit_limit - c.balance);
  c.utilization = c.credit_limit > 0 ? L.round2((c.balance / c.credit_limit) * 100) : null;
  c.over_limit = c.credit_limit > 0 && c.balance > c.credit_limit + 0.004;
  c.risk = c.days_overdue > 90 ? 'critical' : c.days_overdue > 30 ? 'serious' : c.overdue > 0 ? 'warning' : 'good';
  return c;
}
async function customers(asOf, where = '1=1', params = [], order = '') {
  return (await db.all(customerQuery(asOf, where) + order, ...params)).map((c) => decorate(c, asOf));
}
async function nextCustomerCode() {
  const r = await db.get(`SELECT code FROM customers WHERE code LIKE 'GMS-%' ORDER BY id DESC LIMIT 1`);
  const n = r ? parseInt(r.code.slice(4), 10) + 1 : 1;
  return 'GMS-' + String(isNaN(n) ? 1 : n).padStart(4, '0');
}
function openDebits(where = '1=1', params = []) {
  return db.all(`SELECT t.id, t.customer_id, t.type, t.ref_no, t.date, t.due_date, t.amount, t.amount - t.settled AS open
    FROM transactions t JOIN customers c ON c.id = t.customer_id
    WHERE t.voided = 0 AND t.type IN ${L.DEBIT_SQL} AND t.amount - t.settled > 0.004 AND ${where}`, ...params);
}
function agingFor(rows, asOf) {
  const totals = Object.fromEntries(L.AGING_BUCKETS.map((b) => [b.key, 0]));
  for (const r of rows) {
    const k = L.bucketFor(L.diffDays(asOf, r.due_date || r.date));
    totals[k] = L.round2(totals[k] + r.open);
  }
  return totals;
}

// ---------- areas ----------
app.get('/api/areas', h(async (req, res) => {
  const d = L.today();
  const [areas, custs] = await Promise.all([db.all('SELECT * FROM areas ORDER BY name'), customers(d)]);
  for (const a of areas) {
    const cs = custs.filter((c) => c.area_id === a.id);
    a.customers = cs.length;
    a.balance = sum(cs, 'balance');
    a.overdue = sum(cs, 'overdue');
  }
  res.json(areas);
}));
app.post('/api/areas', role('manager'), h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw err(400, 'Area name is required');
  const r = await db.get('INSERT INTO areas (name, description, collector, visit_day) VALUES (?, ?, ?, ?) RETURNING id',
    str(b.name), str(b.description), str(b.collector), str(b.visit_day));
  await audit(req.user.id, 'create', 'area', r.id, b.name);
  res.json({ id: r.id });
}));
app.put('/api/areas/:id', role('manager'), h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw err(400, 'Area name is required');
  await db.run('UPDATE areas SET name = ?, description = ?, collector = ?, visit_day = ? WHERE id = ?',
    str(b.name), str(b.description), str(b.collector), str(b.visit_day), req.params.id);
  await audit(req.user.id, 'update', 'area', +req.params.id, b.name);
  res.json({ ok: true });
}));
app.delete('/api/areas/:id', role('manager'), h(async (req, res) => {
  const n = (await db.get('SELECT COUNT(*) AS c FROM customers WHERE area_id = ?', req.params.id)).c;
  if (n) throw err(400, `Cannot delete: ${n} customer(s) belong to this area. Move them first.`);
  await db.run('DELETE FROM areas WHERE id = ?', req.params.id);
  await audit(req.user.id, 'delete', 'area', +req.params.id);
  res.json({ ok: true });
}));

// ---------- credit types ----------
app.get('/api/credit-types', h(async (req, res) => {
  res.json(await db.all(`SELECT ct.*, (SELECT COUNT(*) FROM customers c WHERE c.credit_type_id = ct.id) AS customers
    FROM credit_types ct ORDER BY name`));
}));
function ctFields(b) {
  if (!str(b.name)) throw err(400, 'Name is required');
  const color = str(b.color) || '#2a78d6';
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw err(400, 'Colour must be a hex code like #2a78d6');
  return [str(b.name), str(b.description), numOr(b.default_limit, 0), Math.max(1, intOrNull(b.default_period_days) || 30),
    b.interest_rate === '' || b.interest_rate == null ? null : numOr(b.interest_rate, null), color];
}
app.post('/api/credit-types', role('manager'), h(async (req, res) => {
  const r = await db.get('INSERT INTO credit_types (name, description, default_limit, default_period_days, interest_rate, color) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    ...ctFields(req.body || {}));
  await audit(req.user.id, 'create', 'credit_type', r.id, req.body.name);
  res.json({ id: r.id });
}));
app.put('/api/credit-types/:id', role('manager'), h(async (req, res) => {
  await db.run('UPDATE credit_types SET name = ?, description = ?, default_limit = ?, default_period_days = ?, interest_rate = ?, color = ? WHERE id = ?',
    ...ctFields(req.body || {}), req.params.id);
  await audit(req.user.id, 'update', 'credit_type', +req.params.id, req.body.name);
  res.json({ ok: true });
}));
app.delete('/api/credit-types/:id', role('manager'), h(async (req, res) => {
  const n = (await db.get('SELECT COUNT(*) AS c FROM customers WHERE credit_type_id = ?', req.params.id)).c;
  if (n) throw err(400, `Cannot delete: ${n} customer(s) use this credit type.`);
  await db.run('DELETE FROM credit_types WHERE id = ?', req.params.id);
  await audit(req.user.id, 'delete', 'credit_type', +req.params.id);
  res.json({ ok: true });
}));

// ---------- customers ----------
app.get('/api/customers', h(async (req, res) => {
  const d = L.today();
  const q = req.query;
  const conds = ['1=1'];
  const params = [];
  if (q.area_id) { conds.push('c.area_id = ?'); params.push(+q.area_id); }
  if (q.credit_type_id) { conds.push('c.credit_type_id = ?'); params.push(+q.credit_type_id); }
  if (q.status) { conds.push('c.status = ?'); params.push(q.status); }
  if (q.q) {
    conds.push('(c.name ILIKE ? OR c.code ILIKE ? OR c.phone ILIKE ? OR c.business_name ILIKE ? OR c.nic ILIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like, like, like);
  }
  let rows = await customers(d, conds.join(' AND '), params, ' ORDER BY c.name');
  if (q.filter === 'overdue') rows = rows.filter((c) => c.overdue > 0);
  if (q.filter === 'over_limit') rows = rows.filter((c) => c.over_limit);
  if (q.filter === 'with_balance') rows = rows.filter((c) => c.balance > 0.004);
  if (q.filter === 'clear') rows = rows.filter((c) => c.balance <= 0.004);
  res.json(rows);
}));

async function customerFields(b, existing) {
  if (!str(b.name)) throw err(400, 'Customer name is required');
  const ct = b.credit_type_id ? await db.get('SELECT * FROM credit_types WHERE id = ?', intOrNull(b.credit_type_id)) : null;
  const limit = b.credit_limit === '' || b.credit_limit == null ? (existing ? existing.credit_limit : ct ? ct.default_limit : 0) : numOr(b.credit_limit, 0);
  const period = b.credit_period_days === '' || b.credit_period_days == null
    ? (existing ? existing.credit_period_days : ct ? ct.default_period_days : 30) : Math.max(0, intOrNull(b.credit_period_days) ?? 30);
  const channel = M.CHANNELS.includes(b.preferred_channel) ? b.preferred_channel : 'sms';
  const status = ['active', 'blocked', 'inactive'].includes(b.status) ? b.status : 'active';
  return {
    name: str(b.name), business_name: str(b.business_name), phone: str(b.phone), whatsapp: str(b.whatsapp), email: str(b.email),
    address: str(b.address), nic: str(b.nic), area_id: intOrNull(b.area_id), credit_type_id: intOrNull(b.credit_type_id),
    credit_limit: limit, credit_period_days: period, interest_enabled: b.interest_enabled === false || b.interest_enabled === 0 || b.interest_enabled === '0' ? 0 : 1,
    preferred_channel: channel, status, notes: str(b.notes),
  };
}
app.post('/api/customers', h(async (req, res) => {
  const b = req.body || {};
  // Staff open accounts on the credit type's standard terms; custom limits and periods, interest-free
  // accounts and opening balances need a manager, just like editing a customer
  const staff = ROLE_RANK[req.user.role] < 2;
  if (staff && numOr(b.opening_balance, 0) > 0) throw err(403, 'Only a manager or owner can enter an opening balance');
  const f = await customerFields(staff ? { ...b, credit_limit: '', credit_period_days: '', interest_enabled: 1 } : b);
  if (staff && !f.credit_type_id) throw err(400, 'Choose a credit type: new customers get its standard credit limit and period');
  const code = str(b.code) || (await nextCustomerCode());
  const cols = Object.keys(f);
  const r = await db.get(`INSERT INTO customers (code, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')}) RETURNING id`,
    code, ...Object.values(f));
  if (numOr(b.opening_balance, 0) > 0) {
    await L.addEntry({ customerId: r.id, type: 'opening', amount: +b.opening_balance, date: b.opening_date || L.today(),
      dueDate: b.opening_due_date || undefined, description: 'Opening balance', userId: req.user.id });
  }
  await audit(req.user.id, 'create', 'customer', r.id, `${code} ${f.name}`);
  res.json({ id: r.id, code });
}));
app.get('/api/customers/:id', h(async (req, res) => {
  const d = L.today();
  const id = intOrNull(req.params.id);
  const [c] = await customers(d, 'c.id = ?', [id]);
  if (!c) throw err(404, 'Customer not found');
  const [b, transactions, open, messages, monthly] = await Promise.all([
    L.customerBalance(c.id, d),
    db.all(`SELECT t.*, u.full_name AS created_by_name FROM transactions t LEFT JOIN users u ON u.id = t.created_by
      WHERE t.customer_id = ? ORDER BY t.date DESC, t.id DESC`, c.id),
    openDebits('t.customer_id = ?', [c.id]),
    db.all('SELECT * FROM messages WHERE customer_id = ? ORDER BY id DESC LIMIT 50', c.id),
    db.all(`SELECT substr(date,1,7) AS month,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) AS credit,
        SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END) AS paid
      FROM transactions WHERE customer_id = ? AND voided = 0 AND date >= ? GROUP BY 1 ORDER BY 1`, c.id, L.addDays(d, -365)),
  ]);
  Object.assign(c, { total_interest: b.interest, total_debits: b.debits, total_credits: b.credits, transactions, messages, monthly });
  c.open_bills = open.map((r) => ({ ...r, open: L.round2(r.open), days_overdue: Math.max(0, L.diffDays(d, r.due_date || r.date)) }));
  c.aging = agingFor(c.open_bills, d);
  res.json(c);
}));
app.put('/api/customers/:id', role('manager'), h(async (req, res) => {
  const existing = await db.get('SELECT * FROM customers WHERE id = ?', intOrNull(req.params.id));
  if (!existing) throw err(404, 'Customer not found');
  const f = await customerFields(req.body || {}, existing);
  const code = str(req.body.code) || existing.code;
  await db.run(`UPDATE customers SET code = ?, ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    code, ...Object.values(f), existing.id);
  await audit(req.user.id, 'update', 'customer', existing.id, `${code} ${f.name}`);
  res.json({ ok: true });
}));
app.delete('/api/customers/:id', role('owner'), h(async (req, res) => {
  const c = await db.get('SELECT * FROM customers WHERE id = ?', intOrNull(req.params.id));
  if (!c) throw err(404, 'Customer not found');
  if (Math.abs((await L.customerBalance(c.id)).balance) > 0.004) throw err(400, 'Customer still has a balance. Settle it or set status to inactive.');
  await db.run('DELETE FROM customers WHERE id = ?', c.id);
  await audit(req.user.id, 'delete', 'customer', c.id, `${c.code} ${c.name}`);
  res.json({ ok: true });
}));

// ---------- transactions ----------
app.get('/api/transactions', h(async (req, res) => {
  const q = req.query;
  const conds = ['1=1'];
  const params = [];
  if (q.from) { conds.push('t.date >= ?'); params.push(dateParam(q.from)); }
  if (q.to) { conds.push('t.date <= ?'); params.push(dateParam(q.to)); }
  if (q.type) { conds.push('t.type = ?'); params.push(q.type); }
  if (q.customer_id) { conds.push('t.customer_id = ?'); params.push(+q.customer_id); }
  if (q.area_id) { conds.push('c.area_id = ?'); params.push(+q.area_id); }
  if (q.voided !== '1') conds.push('t.voided = 0');
  if (q.q) { conds.push('(t.ref_no ILIKE ? OR c.name ILIKE ? OR c.code ILIKE ? OR t.description ILIKE ?)'); const l = `%${q.q}%`; params.push(l, l, l, l); }
  const limit = Math.min(5000, intOrNull(q.limit) || 500);
  res.json(await db.all(`SELECT t.*, c.name AS customer_name, c.code AS customer_code, a.name AS area_name, u.full_name AS created_by_name
    FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN users u ON u.id = t.created_by
    WHERE ${conds.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT ${limit}`, ...params));
}));

app.post('/api/transactions', h(async (req, res) => {
  const b = req.body || {};
  const type = b.type;
  if (type === 'interest') throw err(400, 'Interest is calculated automatically');
  if (['debit_adj', 'credit_adj', 'opening'].includes(type) && ROLE_RANK[req.user.role] < 2) throw err(403, 'Only manager or owner can post adjustments');
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', intOrNull(b.customer_id));
  if (!customer) throw err(404, 'Customer not found');
  const s = await getSettings();

  if (type === 'credit') {
    if (customer.status === 'blocked') throw err(409, `${customer.name} is BLOCKED from taking credit.`);
    const bal = await L.customerBalance(customer.id);
    const after = L.round2(bal.balance + numOr(b.amount, 0));
    const problems = [];
    if (customer.credit_limit > 0 && after > customer.credit_limit) problems.push(`credit limit (${M.money(customer.credit_limit, s)}) will be exceeded — new balance ${M.money(after, s)}`);
    if (bal.overdue > 0) problems.push(`customer already has ${M.money(bal.overdue, s)} overdue (${bal.days_overdue} days)`);
    if (problems.length && !b.override) return res.status(409).json({ error: 'Credit warning', warnings: problems, can_override: ROLE_RANK[req.user.role] >= 2 });
    if (problems.length && ROLE_RANK[req.user.role] < 2) throw err(403, 'Only a manager or owner can approve this credit');
  }

  const t = await L.addEntry({
    customerId: customer.id, type, amount: b.amount, date: b.date, dueDate: b.due_date, refNo: b.ref_no,
    description: str(b.description), paymentMethod: str(b.payment_method), chequeNo: str(b.cheque_no), userId: req.user.id,
  });
  await audit(req.user.id, 'create', 'transaction', t.id, `${type} ${t.ref_no} ${t.amount} for ${customer.code}${b.override ? ' (override)' : ''}`);

  let message = null;
  if (b.notify !== false) {
    if (type === 'payment' && s.auto_notify_payment === '1') message = await M.notify(customer.id, 'payment_received', { amount: t.amount, ref_no: t.ref_no, date: t.date }, 'payment', req.user.id);
    if (type === 'credit' && s.auto_notify_credit === '1') message = await M.notify(customer.id, 'credit_created', { amount: t.amount, ref_no: t.ref_no, date: t.date, due_date: t.due_date }, 'credit', req.user.id);
  }
  res.json({ transaction: t, balance: await L.customerBalance(customer.id), message });
}));

app.post('/api/transactions/:id/void', role('manager'), h(async (req, res) => {
  const t = await L.voidEntry(intOrNull(req.params.id), str(req.body?.reason));
  await audit(req.user.id, 'void', 'transaction', t.id, `${t.type} ${t.ref_no} ${t.amount}: ${req.body?.reason || ''}`);
  res.json({ ok: true });
}));

// ---------- messaging ----------
app.get('/api/messages', h(async (req, res) => {
  const q = req.query;
  const conds = ['1=1'], params = [];
  if (q.channel) { conds.push('m.channel = ?'); params.push(q.channel); }
  if (q.status) { conds.push('m.status = ?'); params.push(q.status); }
  if (q.kind) { conds.push('m.kind = ?'); params.push(q.kind); }
  if (q.customer_id) { conds.push('m.customer_id = ?'); params.push(+q.customer_id); }
  if (q.from) { conds.push('substr(m.created_at, 1, 10) >= ?'); params.push(dateParam(q.from)); }
  if (q.to) { conds.push('substr(m.created_at, 1, 10) <= ?'); params.push(dateParam(q.to)); }
  res.json(await db.all(`SELECT m.*, c.name AS customer_name, c.code AS customer_code, u.full_name AS sent_by
    FROM messages m LEFT JOIN customers c ON c.id = m.customer_id LEFT JOIN users u ON u.id = m.created_by
    WHERE ${conds.join(' AND ')} ORDER BY m.id DESC LIMIT 1000`, ...params));
}));
app.get('/api/templates', h(async (req, res) => res.json(await db.all('SELECT * FROM templates ORDER BY name'))));
app.put('/api/templates/:key', role('manager'), h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.body)) throw err(400, 'Message body is required');
  await db.run('UPDATE templates SET subject = ?, body = ? WHERE key = ?', str(b.subject), b.body, req.params.key);
  await audit(req.user.id, 'update', 'template', null, req.params.key);
  res.json({ ok: true });
}));

// Bulk / single send. Audience: explicit customer_ids, or a segment (all, area, overdue, with_balance, over_limit)
app.post('/api/messages/send', h(async (req, res) => {
  const b = req.body || {};
  const d = L.today();
  let list;
  if (Array.isArray(b.customer_ids) && b.customer_ids.length) {
    list = await customers(d, 'c.id = ANY(?::int[])', [b.customer_ids.map(Number).filter(Number.isFinite)]);
  } else {
    const conds = ["c.status != 'inactive'"], params = [];
    if (b.area_id) { conds.push('c.area_id = ?'); params.push(+b.area_id); }
    if (b.credit_type_id) { conds.push('c.credit_type_id = ?'); params.push(+b.credit_type_id); }
    list = await customers(d, conds.join(' AND '), params);
    if (b.segment === 'overdue') list = list.filter((c) => c.overdue > 0);
    if (b.segment === 'with_balance') list = list.filter((c) => c.balance > 0.004);
    if (b.segment === 'over_limit') list = list.filter((c) => c.over_limit);
  }
  if (!list.length) throw err(400, 'No customers match this audience');
  const channels = (Array.isArray(b.channels) ? b.channels : [b.channel]).filter((ch) => M.CHANNELS.includes(ch));
  if (!channels.length) throw err(400, 'Choose at least one channel');
  if (!str(b.body)) throw err(400, 'Message is empty');

  const s = await getSettings();
  const results = [];
  for (const c of list) {
    const vars = await M.customerVars(c, {}, s);
    for (const ch of channels) {
      const r = await M.send({ customer: c, channel: ch, subject: M.render(b.subject, vars), body: M.render(b.body, vars), kind: list.length > 1 ? 'bulk' : 'manual', userId: req.user.id, settings: s });
      results.push({ ...r, customer_name: c.name });
    }
  }
  await audit(req.user.id, 'send_messages', 'message', null, `${results.length} message(s) via ${channels.join(', ')}`);
  res.json({
    total: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    links: results.filter((r) => r.status === 'link').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}));
app.post('/api/messages/preview', h(async (req, res) => {
  const id = intOrNull(req.body.customer_id);
  const c = (id && (await db.get('SELECT * FROM customers WHERE id = ?', id))) || (await db.get('SELECT * FROM customers ORDER BY id LIMIT 1'));
  if (!c) return res.json({ subject: req.body.subject, body: req.body.body });
  const vars = await M.customerVars(c);
  res.json({ customer: c.name, subject: M.render(req.body.subject, vars), body: M.render(req.body.body, vars) });
}));
app.post('/api/messages/test', role('manager'), h(async (req, res) => {
  const { channel, recipient } = req.body || {};
  if (!str(recipient)) throw err(400, 'Enter a recipient to test');
  const s = await getSettings();
  res.json(await M.send({ channel, recipient, subject: `Test from ${s.business_name}`, body: `This is a test message from ${s.business_name} credit system.`, kind: 'test', userId: req.user.id, settings: s }));
}));
app.post('/api/automation/run', role('manager'), h(async (req, res) => {
  const r = await M.runDailyAutomation({ force: true });
  await audit(req.user.id, 'run_automation', null, null, `interest ${r.interest.length}, reminders ${r.reminders}, overdue ${r.overdue}`);
  res.json({ interest_charges: r.interest.length, interest_total: sum(r.interest, 'amount'), reminders: r.reminders, overdue_notices: r.overdue });
}));

// ---------- dashboard ----------
function monthsBack(n) {
  const out = [];
  const [y, m] = L.today().split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
async function monthlyFlows(months) {
  const rows = await db.all(`SELECT substr(t.date,1,7) AS month,
      SUM(CASE WHEN t.type IN ('credit','debit_adj') THEN t.amount ELSE 0 END) AS credit,
      SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END) AS collected,
      SUM(CASE WHEN t.type = 'interest' THEN t.amount ELSE 0 END) AS interest
    FROM transactions t WHERE t.voided = 0 AND t.date >= ? GROUP BY 1`, months[0] + '-01');
  const map = Object.fromEntries(rows.map((r) => [r.month, r]));
  return months.map((m) => ({ month: m, credit: L.round2(map[m]?.credit || 0), collected: L.round2(map[m]?.collected || 0), interest: L.round2(map[m]?.interest || 0) }));
}
async function sumWhere(types, from, to) {
  const r = await db.get(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE voided = 0 AND type IN (${types.map(() => '?').join(',')}) AND date BETWEEN ? AND ?`,
    ...types, from, to);
  return L.round2(r.s);
}

app.get('/api/dashboard', h(async (req, res) => {
  const d = L.today();
  const ms = monthStart();
  const [custs, open, areas, ctypes, msgStats, upcoming, recent, trend, creditMonth, collectedMonth, interestMonth, creditToday, collectedToday, interestTotal] = await Promise.all([
    customers(d), openDebits(), db.all('SELECT id, name FROM areas ORDER BY name'), db.all('SELECT id, name, color FROM credit_types ORDER BY name'),
    db.all(`SELECT channel, status, COUNT(*) AS n FROM messages WHERE created_at >= ? GROUP BY channel, status`, L.addDays(d, -30)),
    db.all(`SELECT t.id, t.ref_no, t.due_date, t.amount - t.settled AS open, c.id AS customer_id, c.name AS customer_name, c.phone
      FROM transactions t JOIN customers c ON c.id = t.customer_id
      WHERE t.voided = 0 AND t.type IN ('credit','opening','debit_adj') AND t.amount - t.settled > 0.004 AND t.due_date BETWEEN ? AND ?
      ORDER BY t.due_date LIMIT 12`, d, L.addDays(d, 7)),
    db.all(`SELECT t.*, c.name AS customer_name FROM transactions t JOIN customers c ON c.id = t.customer_id
      WHERE t.voided = 0 ORDER BY t.id DESC LIMIT 10`),
    monthlyFlows(monthsBack(12)),
    sumWhere(['credit'], ms, d), sumWhere(['payment'], ms, d), sumWhere(['interest'], ms, d),
    sumWhere(['credit'], d, d), sumWhere(['payment'], d, d), sumWhere(['interest'], '0000-01-01', d),
  ]);
  const active = custs.filter((c) => c.status !== 'inactive');
  const byArea = areas.map((a) => {
    const cs = custs.filter((c) => c.area_id === a.id);
    return { id: a.id, name: a.name, customers: cs.length, balance: sum(cs, 'balance'), overdue: sum(cs, 'overdue') };
  });
  const unassigned = custs.filter((c) => !c.area_id);
  if (unassigned.length) byArea.push({ id: null, name: 'Unassigned', customers: unassigned.length, balance: sum(unassigned, 'balance'), overdue: sum(unassigned, 'overdue') });

  res.json({
    today: d,
    kpis: {
      outstanding: sum(custs, (c) => Math.max(0, c.balance)),
      overdue: sum(custs, 'overdue'),
      customers: active.length,
      with_balance: custs.filter((c) => c.balance > 0.004).length,
      overdue_customers: custs.filter((c) => c.overdue > 0).length,
      over_limit: custs.filter((c) => c.over_limit).length,
      blocked: custs.filter((c) => c.status === 'blocked').length,
      total_limit: sum(active, 'credit_limit'),
      credit_month: creditMonth, collected_month: collectedMonth, interest_month: interestMonth,
      credit_today: creditToday, collected_today: collectedToday, interest_total: interestTotal,
    },
    trend,
    aging: agingFor(open, d),
    aging_buckets: L.AGING_BUCKETS,
    by_area: byArea,
    by_type: ctypes.map((t) => { const cs = custs.filter((c) => c.credit_type_id === t.id); return { ...t, customers: cs.length, balance: sum(cs, 'balance') }; }),
    top_debtors: [...custs].sort((a, b) => b.balance - a.balance).filter((c) => c.balance > 0).slice(0, 8),
    upcoming,
    recent,
    messages: msgStats,
  });
}));

// ---------- reports ----------
function range(q) {
  const from = dateParam(q.from, monthStart());
  const to = dateParam(q.to, L.today());
  if (from > to) throw err(400, '"From" date is after "To" date');
  return { from, to };
}
function custFilter(q) {
  const conds = ['1=1'], params = [];
  if (q.area_id) { conds.push('c.area_id = ?'); params.push(+q.area_id); }
  if (q.credit_type_id) { conds.push('c.credit_type_id = ?'); params.push(+q.credit_type_id); }
  return { where: conds.join(' AND '), params };
}
const groupBy = (rows, key) => Object.values(rows.reduce((m, r) => {
  const k = r[key] || 'Other';
  m[k] = m[k] || { key: k, count: 0, amount: 0 };
  m[k].count++; m[k].amount = L.round2(m[k].amount + r.amount);
  return m;
}, {}));

app.get('/api/reports/aging', h(async (req, res) => {
  const d = dateParam(req.query.as_of, L.today());
  const f = custFilter(req.query);
  const [custs, open] = await Promise.all([customers(d, f.where, f.params, ' ORDER BY a.name, c.name'), openDebits(f.where, f.params)]);
  const byCust = {};
  for (const o of open) (byCust[o.customer_id] = byCust[o.customer_id] || []).push(o);
  const rows = [];
  for (const c of custs) {
    const ag = agingFor(byCust[c.id] || [], d);
    const total = L.round2(Object.values(ag).reduce((s, v) => s + v, 0));
    if (total > 0.004) rows.push({ id: c.id, code: c.code, name: c.name, area: c.area_name, phone: c.phone, ...ag, total, days_overdue: c.days_overdue });
  }
  const totals = Object.fromEntries([...L.AGING_BUCKETS.map((b) => b.key), 'total'].map((k) => [k, sum(rows, k)]));
  res.json({ as_of: d, buckets: L.AGING_BUCKETS, rows, totals });
}));

app.get('/api/reports/area-summary', h(async (req, res) => {
  const { from, to } = range(req.query);
  const d = L.today();
  const [areaRows, custs, flows] = await Promise.all([
    db.all('SELECT * FROM areas ORDER BY name'), customers(d),
    db.all(`SELECT c.area_id,
        SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END) AS credit,
        SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END) AS collected,
        SUM(CASE WHEN t.type = 'interest' THEN t.amount ELSE 0 END) AS interest
      FROM transactions t JOIN customers c ON c.id = t.customer_id
      WHERE t.voided = 0 AND t.date BETWEEN ? AND ? GROUP BY c.area_id`, from, to),
  ]);
  const rows = [...areaRows, { id: null, name: 'Unassigned' }].map((a) => {
    const cs = custs.filter((c) => (c.area_id ?? null) === a.id);
    const fl = flows.find((x) => (x.area_id ?? null) === a.id) || {};
    const balance = sum(cs, 'balance'), overdue = sum(cs, 'overdue');
    return {
      id: a.id, name: a.name, collector: a.collector, customers: cs.length,
      with_balance: cs.filter((c) => c.balance > 0.004).length, overdue_customers: cs.filter((c) => c.overdue > 0).length,
      balance, overdue,
      credit: L.round2(fl.credit || 0), collected: L.round2(fl.collected || 0), interest: L.round2(fl.interest || 0),
      overdue_pct: balance > 0 ? L.round2(overdue / balance * 100) : 0,
    };
  }).filter((r) => r.id !== null || r.customers > 0);
  res.json({ from, to, rows });
}));

app.get('/api/reports/overdue', h(async (req, res) => {
  const d = L.today();
  const f = custFilter(req.query);
  const minDays = intOrNull(req.query.min_days) || 0;
  const rows = (await customers(d, f.where, f.params))
    .filter((c) => c.overdue > 0 && c.days_overdue >= minDays).sort((a, b) => b.days_overdue - a.days_overdue);
  res.json({ as_of: d, rows });
}));

app.get('/api/reports/collections', h(async (req, res) => {
  const { from, to } = range(req.query);
  const f = custFilter(req.query);
  const rows = await db.all(`SELECT t.*, c.name AS customer_name, c.code AS customer_code, a.name AS area_name, u.full_name AS created_by_name
    FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN users u ON u.id = t.created_by
    WHERE t.voided = 0 AND t.type = 'payment' AND t.date BETWEEN ? AND ? AND ${f.where} ORDER BY t.date, t.id`, from, to, ...f.params);
  res.json({ from, to, rows, total: sum(rows, 'amount'), by_day: groupBy(rows, 'date'), by_method: groupBy(rows, 'payment_method'), by_area: groupBy(rows, 'area_name'), by_user: groupBy(rows, 'created_by_name') });
}));

app.get('/api/reports/credit-sales', h(async (req, res) => {
  const { from, to } = range(req.query);
  const f = custFilter(req.query);
  const rows = await db.all(`SELECT t.*, t.amount - t.settled AS open, c.name AS customer_name, c.code AS customer_code, a.name AS area_name
    FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id
    WHERE t.voided = 0 AND t.type = 'credit' AND t.date BETWEEN ? AND ? AND ${f.where} ORDER BY t.date, t.id`, from, to, ...f.params);
  res.json({ from, to, rows, total: sum(rows, 'amount'), outstanding: sum(rows, 'open'), by_day: groupBy(rows, 'date') });
}));

app.get('/api/reports/interest', h(async (req, res) => {
  const { from, to } = range(req.query);
  const f = custFilter(req.query);
  const rows = await db.all(`SELECT t.*, t.amount - t.settled AS open, c.name AS customer_name, c.code AS customer_code, a.name AS area_name, p.ref_no AS parent_ref
    FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN transactions p ON p.id = t.parent_id
    WHERE t.voided = 0 AND t.type = 'interest' AND t.date BETWEEN ? AND ? AND ${f.where} ORDER BY t.date, t.id`, from, to, ...f.params);
  const total = sum(rows, 'amount');
  const collected = sum(rows, (r) => r.amount - r.open);
  const byCustomer = Object.values(rows.reduce((m, r) => { const k = r.customer_id; m[k] = m[k] || { key: r.customer_name, code: r.customer_code, count: 0, amount: 0 }; m[k].count++; m[k].amount = L.round2(m[k].amount + r.amount); return m; }, {})).sort((a, b) => b.amount - a.amount);
  res.json({ from, to, rows, total, collected, pending: L.round2(total - collected), by_customer: byCustomer });
}));

app.get('/api/reports/limit-utilization', h(async (req, res) => {
  const f = custFilter(req.query);
  const rows = (await customers(L.today(), f.where + " AND c.status != 'inactive'", f.params))
    .sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1));
  res.json({ rows });
}));

app.get('/api/reports/statement/:id', h(async (req, res) => {
  const from = dateParam(req.query.from, '2000-01-01'), to = dateParam(req.query.to, L.today());
  const [c] = await customers(L.today(), 'c.id = ?', [intOrNull(req.params.id)]);
  if (!c) throw err(404, 'Customer not found');
  const [op, list, s] = await Promise.all([
    db.get(`SELECT COALESCE(SUM(CASE WHEN type IN ${L.DEBIT_SQL} THEN amount ELSE -amount END),0) AS s
      FROM transactions WHERE customer_id = ? AND voided = 0 AND date < ?`, c.id, from),
    db.all(`SELECT * FROM transactions WHERE customer_id = ? AND voided = 0 AND date BETWEEN ? AND ? ORDER BY date, id`, c.id, from, to),
    getSettings(),
  ]);
  const opening = L.round2(op.s);
  let run = opening;
  const rows = list.map((t) => {
    const debit = L.DEBIT_TYPES.includes(t.type) ? t.amount : 0;
    const credit = L.CREDIT_TYPES.includes(t.type) ? t.amount : 0;
    run = L.round2(run + debit - credit);
    return { ...t, debit, credit, running: run };
  });
  res.json({ customer: c, from, to, opening, closing: run, rows,
    business: { name: s.business_name, address: s.business_address, phone: s.business_phone, email: s.business_email } });
}));

app.get('/api/reports/daybook', h(async (req, res) => {
  const { from, to } = range({ from: req.query.from || L.today(), to: req.query.to || req.query.from || L.today() });
  const rows = await db.all(`SELECT t.*, c.name AS customer_name, c.code AS customer_code, a.name AS area_name, u.full_name AS created_by_name
    FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN users u ON u.id = t.created_by
    WHERE t.date BETWEEN ? AND ? ORDER BY t.date, t.id`, from, to);
  const live = rows.filter((r) => !r.voided);
  const total = (types) => sum(live.filter((r) => types.includes(r.type)), 'amount');
  res.json({ from, to, rows, totals: { credit: total(['credit']), payment: total(['payment']), interest: total(['interest']), adjustments: total(['debit_adj', 'credit_adj', 'opening']), voided: rows.length - live.length } });
}));

app.get('/api/reports/customer-directory', h(async (req, res) => {
  const f = custFilter(req.query);
  res.json({ rows: await customers(L.today(), f.where, f.params, ' ORDER BY a.name, c.name') });
}));

app.get('/api/reports/credit-types', h(async (req, res) => {
  const [custs, types] = await Promise.all([customers(L.today()), db.all('SELECT * FROM credit_types ORDER BY name')]);
  const rows = types.map((t) => {
    const cs = custs.filter((c) => c.credit_type_id === t.id);
    const bal = sum(cs, 'balance'), lim = sum(cs, 'credit_limit');
    return { ...t, customers: cs.length, balance: bal, overdue: sum(cs, 'overdue'), total_limit: lim, utilization: lim > 0 ? L.round2(bal / lim * 100) : 0 };
  });
  res.json({ rows });
}));

// ---------- owner reports ----------
app.get('/api/owner/summary', role('owner'), h(async (req, res) => {
  const { from, to } = range(req.query);
  const d = L.today();
  const months = monthsBack(12);
  const [custs, open, openingRow, credit, collected, interest, interestCollectedRow, sales90, interestAll, areaPerfRows, topCustomers, staff, trend, startRow, adj, messages, voids] = await Promise.all([
    customers(d), openDebits(),
    db.get(`SELECT COALESCE(SUM(CASE WHEN type IN ${L.DEBIT_SQL} THEN amount ELSE -amount END),0) AS s FROM transactions WHERE voided = 0 AND date < ?`, from),
    sumWhere(['credit', 'debit_adj'], from, to), sumWhere(['payment'], from, to), sumWhere(['interest'], from, to),
    db.get(`SELECT COALESCE(SUM(al.amount),0) AS s FROM allocations al
      JOIN transactions p ON p.id = al.payment_id JOIN transactions dbt ON dbt.id = al.debit_id
      WHERE dbt.type = 'interest' AND p.voided = 0 AND dbt.voided = 0 AND p.date BETWEEN ? AND ?`, from, to),
    sumWhere(['credit'], L.addDays(d, -90), d), sumWhere(['interest'], '0000-01-01', d),
    db.all(`SELECT COALESCE(a.name,'Unassigned') AS name,
        SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END) AS credit,
        SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END) AS collected,
        SUM(CASE WHEN t.type = 'interest' THEN t.amount ELSE 0 END) AS interest
      FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id
      WHERE t.voided = 0 AND t.date BETWEEN ? AND ? GROUP BY a.id, a.name ORDER BY collected DESC`, from, to),
    db.all(`SELECT c.id, c.code, c.name, a.name AS area,
        SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END) AS credit,
        SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END) AS paid,
        SUM(CASE WHEN t.type = 'interest' THEN t.amount ELSE 0 END) AS interest
      FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN areas a ON a.id = c.area_id
      WHERE t.voided = 0 AND t.date BETWEEN ? AND ? GROUP BY c.id, a.name ORDER BY credit DESC LIMIT 10`, from, to),
    db.all(`SELECT u.full_name AS name, u.role,
        COALESCE(SUM(CASE WHEN t.type = 'credit' THEN 1 ELSE 0 END), 0) AS credit_count,
        COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE 0 END), 0) AS credit_amount,
        COALESCE(SUM(CASE WHEN t.type = 'payment' THEN 1 ELSE 0 END), 0) AS payment_count,
        COALESCE(SUM(CASE WHEN t.type = 'payment' THEN t.amount ELSE 0 END), 0) AS payment_amount,
        (SELECT COUNT(*) FROM transactions v WHERE v.created_by = u.id AND v.voided = 1 AND v.date BETWEEN ? AND ?) AS voided
      FROM users u LEFT JOIN transactions t ON t.created_by = u.id AND t.voided = 0 AND t.date BETWEEN ? AND ?
      GROUP BY u.id ORDER BY payment_amount DESC`, from, to, from, to),
    monthlyFlows(months),
    db.get(`SELECT COALESCE(SUM(CASE WHEN type IN ${L.DEBIT_SQL} THEN amount ELSE -amount END),0) AS s FROM transactions WHERE voided = 0 AND date < ?`, months[0] + '-01'),
    db.all(`SELECT substr(date,1,7) AS m, SUM(CASE WHEN type = 'opening' THEN amount WHEN type = 'credit_adj' THEN -amount ELSE 0 END) AS s
      FROM transactions WHERE voided = 0 GROUP BY 1`),
    db.all(`SELECT channel, status, COUNT(*) AS n FROM messages WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY channel, status`, from, to),
    db.all(`SELECT t.ref_no, t.type, t.amount, t.void_reason, c.name AS customer_name, u.full_name AS by_user, t.date
      FROM transactions t JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.created_by
      WHERE t.voided = 1 AND t.date BETWEEN ? AND ? ORDER BY t.id DESC LIMIT 50`, from, to),
  ]);

  const outstanding = sum(custs, (c) => Math.max(0, c.balance));
  const overdue = sum(custs, 'overdue');
  const openingOutstanding = L.round2(openingRow.s);
  const dso = sales90 > 0 ? Math.round(outstanding / (sales90 / 90)) : null;
  const efficiency = openingOutstanding + credit + interest > 0 ? L.round2(collected / (openingOutstanding + credit + interest) * 100) : null;
  const aging = agingFor(open, d);

  // risk score 0-100 per customer: days overdue, overdue share, utilization, payment recency
  const risk = custs.filter((c) => c.balance > 0.004).map((c) => {
    const daysSincePay = c.last_payment ? L.diffDays(d, c.last_payment) : 365;
    const score = Math.min(100, Math.round(
      Math.min(40, c.days_overdue / 90 * 40) +
      (c.balance > 0 ? Math.min(25, c.overdue / c.balance * 25) : 0) +
      (c.utilization != null ? Math.min(20, c.utilization / 100 * 20) : 10) +
      Math.min(15, daysSincePay / 60 * 15)));
    return { id: c.id, code: c.code, name: c.name, area: c.area_name, phone: c.phone, balance: c.balance, overdue: c.overdue, days_overdue: c.days_overdue, utilization: c.utilization, last_payment: c.last_payment, score };
  }).sort((a, b) => b.score - a.score);

  const areaPerf = areaPerfRows.map((r) => {
    const cs = custs.filter((c) => (c.area_name || 'Unassigned') === r.name);
    return { ...r, credit: L.round2(r.credit), collected: L.round2(r.collected), interest: L.round2(r.interest), balance: sum(cs, 'balance'), overdue: sum(cs, 'overdue') };
  });

  // outstanding at each month end (running)
  let running = L.round2(startRow.s);
  const adjMap = Object.fromEntries(adj.map((r) => [r.m, r.s]));
  for (const t of trend) {
    running = L.round2(running + t.credit + t.interest - t.collected + (adjMap[t.month] || 0));
    t.outstanding = running;
  }
  const cur = trend[trend.length - 1], prev = trend[trend.length - 2];
  const growth = (a, b) => (b > 0 ? L.round2((a - b) / b * 100) : null);

  res.json({
    from, to,
    kpis: {
      outstanding, overdue, overdue_pct: outstanding > 0 ? L.round2(overdue / outstanding * 100) : 0,
      credit, collected, interest, interest_collected: L.round2(interestCollectedRow.s), net_change: L.round2(credit + interest - collected),
      opening_outstanding: openingOutstanding, efficiency, dso,
      bad_debt_risk: aging.d90p, customers: custs.length, active_debtors: custs.filter((c) => c.balance > 0.004).length,
      total_interest_all_time: interestAll,
      exposure: sum(custs.filter((c) => c.status !== 'inactive'), 'credit_limit'),
      credit_growth: growth(cur.credit, prev.credit), collection_growth: growth(cur.collected, prev.collected),
    },
    aging, aging_buckets: L.AGING_BUCKETS, trend, area_performance: areaPerf, top_customers: topCustomers,
    risk: risk.slice(0, 15), staff, messages, voids,
  });
}));

app.get('/api/owner/audit', role('owner'), h(async (req, res) => {
  const { from, to } = range(req.query);
  res.json(await db.all(`SELECT al.*, u.full_name AS user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    WHERE substr(al.created_at,1,10) BETWEEN ? AND ? ORDER BY al.id DESC LIMIT 2000`, from, to));
}));

// ---------- settings ----------
const SECRET_KEYS = ['sms_notifylk_api_key', 'sms_textlk_token', 'whatsapp_token', 'smtp_pass'];
const MASK = '••••••••';
app.get('/api/settings', role('manager'), h(async (req, res) => {
  const s = await getSettings();
  for (const k of SECRET_KEYS) if (s[k]) s[k] = MASK;
  res.json(s);
}));
app.put('/api/settings', role('owner'), h(async (req, res) => {
  const b = req.body || {};
  const allowed = Object.keys(await getSettings()).filter((k) => k !== 'last_auto_run');
  const changed = [];
  await tx(async () => {
    for (const [k, v] of Object.entries(b)) {
      if (!allowed.includes(k)) continue;
      if (SECRET_KEYS.includes(k) && v === MASK) continue;
      await setSetting(k, v);
      changed.push(k);
    }
  });
  await audit(req.user.id, 'update', 'settings', null, changed.join(', '));
  res.json({ ok: true });
}));

// ---------- users ----------
app.get('/api/users', role('owner'), h(async (req, res) => {
  res.json(await db.all('SELECT id, username, full_name, role, phone, active, created_at FROM users ORDER BY id'));
}));
app.post('/api/users', role('owner'), h(async (req, res) => {
  const b = req.body || {};
  if (!str(b.username) || !str(b.full_name)) throw err(400, 'Username and full name are required');
  if (!b.password || String(b.password).length < 6) throw err(400, 'Password must be at least 6 characters');
  if (!ROLE_RANK[b.role]) throw err(400, 'Invalid role');
  const r = await db.get('INSERT INTO users (username, password_hash, full_name, role, phone) VALUES (?, ?, ?, ?, ?) RETURNING id',
    str(b.username), hashPassword(String(b.password)), str(b.full_name), b.role, str(b.phone));
  await audit(req.user.id, 'create', 'user', r.id, b.username);
  res.json({ id: r.id });
}));
app.put('/api/users/:id', role('owner'), h(async (req, res) => {
  const b = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE id = ?', intOrNull(req.params.id));
  if (!u) throw err(404, 'User not found');
  if (!ROLE_RANK[b.role]) throw err(400, 'Invalid role');
  if (u.id === req.user.id && (b.role !== 'owner' || !b.active)) throw err(400, 'You cannot demote or disable your own account');
  if (b.password && String(b.password).length < 6) throw err(400, 'Password must be at least 6 characters');
  await db.run('UPDATE users SET full_name = ?, role = ?, phone = ?, active = ? WHERE id = ?',
    str(b.full_name) || u.full_name, b.role, str(b.phone), b.active ? 1 : 0, u.id);
  if (b.password) {
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(b.password)), u.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  if (!b.active) await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  await audit(req.user.id, 'update', 'user', u.id, `${u.username} role=${b.role} active=${b.active ? 1 : 0}${b.password ? ' (password reset)' : ''}`);
  res.json({ ok: true });
}));

// ---------- backup (JSON export of every table) ----------
const BACKUP_TABLES = ['settings', 'templates', 'users', 'areas', 'credit_types', 'customers', 'transactions', 'allocations', 'messages', 'audit_log'];
app.get('/api/backup', role('owner'), h(async (req, res) => {
  const out = { app: 'gms-credit-manager', exported_at: new Date().toISOString(), tables: {} };
  for (const t of BACKUP_TABLES) out.tables[t] = await db.all(`SELECT * FROM ${t} ORDER BY 1`);
  for (const u of out.tables.users) delete u.password_hash;
  await audit(req.user.id, 'backup', null, null, null);
  res.setHeader('Content-Disposition', `attachment; filename="gms-credit-backup-${L.today()}.json"`);
  res.json(out);
}));

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((e, req, res, next) => {
  let status = e.status || 500, msg = e.message;
  if (e.code === '23505') { status = 409; msg = 'That value already exists (must be unique)'; }
  else if (e.code === '23503') { status = 400; msg = 'This record is linked to other records'; }
  else if (e.code === '22P02') { status = 400; msg = 'Invalid value'; }
  if (status >= 500) console.error(e);
  res.status(status).json({ error: status >= 500 && process.env.VERCEL && !e.expose ? 'Server error — please try again' : msg });
});

module.exports = app;

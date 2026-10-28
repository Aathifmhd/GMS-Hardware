// Ledger engine: balances, FIFO payment allocation, overdue interest, aging.
const { db, tx, TZ, getSettings } = require('./db');

const DEBIT_TYPES = ['credit', 'interest', 'opening', 'debit_adj'];
const CREDIT_TYPES = ['payment', 'credit_adj'];
const DEBIT_SQL = `('credit','interest','opening','debit_adj')`;
const CREDIT_SQL = `('payment','credit_adj')`;

// ---------- dates (calendar dates as YYYY-MM-DD, in the shop's timezone) ----------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function today() {
  return dayFmt.format(new Date());
}
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + Number(n));
  return fmtDate(d);
}
function diffDays(a, b) {
  return Math.round((parseDate(a) - parseDate(b)) / 86400000);
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s));
}

// ---------- allocation ----------
// Rebuild FIFO allocations for one customer: every credit (payment / credit adjustment)
// is applied to the oldest open debits first. Always consistent after any change or void.
async function rebuildAllocations(customerId) {
  const debits = await db.all(
    `SELECT id, amount FROM transactions WHERE customer_id = ? AND voided = 0 AND type IN ${DEBIT_SQL}
     ORDER BY COALESCE(due_date, date), date, id`, customerId);
  const credits = await db.all(
    `SELECT id, amount FROM transactions WHERE customer_id = ? AND voided = 0 AND type IN ${CREDIT_SQL}
     ORDER BY date, id`, customerId);

  const alloc = { p: [], d: [], a: [] };
  const settled = new Map();
  let di = 0;
  for (const c of credits) {
    let left = round2(c.amount);
    while (left > 0.004 && di < debits.length) {
      const d = debits[di];
      const open = round2(d.amount - (settled.get(d.id) || 0));
      if (open <= 0.004) { di++; continue; }
      const use = round2(Math.min(open, left));
      alloc.p.push(c.id); alloc.d.push(d.id); alloc.a.push(use);
      settled.set(d.id, round2((settled.get(d.id) || 0) + use));
      left = round2(left - use);
      if (round2(d.amount - settled.get(d.id)) <= 0.004) di++;
    }
  }

  await db.run('DELETE FROM allocations WHERE payment_id IN (SELECT id FROM transactions WHERE customer_id = ?)', customerId);
  await db.run('UPDATE transactions SET settled = 0 WHERE customer_id = ? AND settled <> 0', customerId);
  if (alloc.p.length) {
    await db.run('INSERT INTO allocations (payment_id, debit_id, amount) SELECT * FROM unnest(?::int[], ?::int[], ?::float8[])', alloc.p, alloc.d, alloc.a);
    await db.run(`UPDATE transactions t SET settled = u.s FROM unnest(?::int[], ?::float8[]) AS u(id, s) WHERE t.id = u.id`,
      [...settled.keys()], [...settled.values()]);
  }
}

// ---------- balances ----------
async function customerBalance(customerId, asOf = today()) {
  const r = await db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN type IN ${DEBIT_SQL} THEN amount ELSE 0 END), 0) AS debits,
      COALESCE(SUM(CASE WHEN type IN ${CREDIT_SQL} THEN amount ELSE 0 END), 0) AS credits,
      COALESCE(SUM(CASE WHEN type IN ${DEBIT_SQL} AND due_date < ? THEN amount - settled ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END), 0) AS interest,
      MIN(CASE WHEN type IN ${DEBIT_SQL} AND amount - settled > 0.004 AND due_date < ? THEN due_date END) AS oldest_overdue
    FROM transactions WHERE customer_id = ? AND voided = 0`, asOf, asOf, customerId);
  return {
    debits: round2(r.debits),
    credits: round2(r.credits),
    balance: round2(r.debits - r.credits),
    overdue: round2(r.overdue),
    interest: round2(r.interest),
    oldest_overdue: r.oldest_overdue,
    days_overdue: r.oldest_overdue ? diffDays(asOf, r.oldest_overdue) : 0,
  };
}

// SQL snippet columns usable in any SELECT over customers c
function balanceColumns(asOf) {
  if (!isDate(asOf)) throw httpError(400, 'Invalid date');
  const d = `'${asOf}'`;
  return `
    COALESCE((SELECT SUM(CASE WHEN t.type IN ${DEBIT_SQL} THEN t.amount ELSE -t.amount END)
      FROM transactions t WHERE t.customer_id = c.id AND t.voided = 0), 0) AS balance,
    COALESCE((SELECT SUM(t.amount - t.settled) FROM transactions t
      WHERE t.customer_id = c.id AND t.voided = 0 AND t.type IN ${DEBIT_SQL} AND t.due_date < ${d}), 0) AS overdue,
    (SELECT MIN(t.due_date) FROM transactions t WHERE t.customer_id = c.id AND t.voided = 0
      AND t.type IN ${DEBIT_SQL} AND t.amount - t.settled > 0.004 AND t.due_date < ${d}) AS oldest_overdue,
    (SELECT MAX(t.date) FROM transactions t WHERE t.customer_id = c.id AND t.voided = 0 AND t.type = 'payment') AS last_payment`;
}

// ---------- reference numbers ----------
// Returns a generator of sequential refs (INV-00001 …). Call inside tx(): the advisory lock
// stops two requests from handing out the same number.
async function refSequence(prefix) {
  await db.get('SELECT pg_advisory_xact_lock(hashtext(?))', 'ref:' + prefix);
  const r = await db.get(`SELECT ref_no FROM transactions WHERE ref_no LIKE ? ORDER BY id DESC LIMIT 1`, prefix + '-%');
  let n = r ? parseInt(String(r.ref_no).split('-').pop(), 10) : 0;
  if (isNaN(n)) n = 0;
  return () => `${prefix}-${String(++n).padStart(5, '0')}`;
}
const REF_PREFIX = { credit: 'INV', payment: 'RCP', interest: 'INT', opening: 'OPN', debit_adj: 'DADJ', credit_adj: 'CADJ' };

// ---------- create entries ----------
async function addEntry({ customerId, type, amount, date, dueDate, refNo, description, paymentMethod, chequeNo, userId, parentId }) {
  if (![...DEBIT_TYPES, ...CREDIT_TYPES].includes(type)) throw httpError(400, 'Invalid entry type');
  amount = round2(amount);
  if (!(amount > 0)) throw httpError(400, 'Amount must be greater than zero');
  date = date || today();
  if (!isDate(date)) throw httpError(400, 'Invalid date');

  return tx(async () => {
    const customer = await db.get('SELECT * FROM customers WHERE id = ? FOR UPDATE', customerId);
    if (!customer) throw httpError(404, 'Customer not found');
    if (DEBIT_TYPES.includes(type) && type !== 'interest') {
      if (!dueDate) dueDate = type === 'debit_adj' ? date : addDays(date, customer.credit_period_days);
      if (!isDate(dueDate)) throw httpError(400, 'Invalid due date');
    } else if (type === 'interest') {
      dueDate = dueDate || date;
    } else {
      dueDate = null;
    }
    const ref = refNo && String(refNo).trim() ? String(refNo).trim() : (await refSequence(REF_PREFIX[type]))();
    const r = await db.get(`INSERT INTO transactions
      (customer_id, type, ref_no, date, due_date, amount, description, payment_method, cheque_no, created_by, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      customer.id, type, ref, date, dueDate, amount, description || null, paymentMethod || null, chequeNo || null, userId || null, parentId || null);
    await rebuildAllocations(customer.id);
    return db.get('SELECT * FROM transactions WHERE id = ?', r.id);
  });
}

async function voidEntry(id, reason) {
  return tx(async () => {
    const t = await db.get('SELECT * FROM transactions WHERE id = ? FOR UPDATE', id);
    if (!t) throw httpError(404, 'Entry not found');
    if (t.voided) throw httpError(400, 'Entry already voided');
    await db.run('UPDATE transactions SET voided = 1, void_reason = ? WHERE id = ?', reason || 'Voided', id);
    // voiding a bill also voids the interest charged on it
    await db.run(`UPDATE transactions SET voided = 1, void_reason = ? WHERE parent_id = ? AND type = 'interest' AND voided = 0`,
      'Parent bill voided', id);
    await rebuildAllocations(t.customer_id);
    return t;
  });
}

// ---------- interest engine ----------
// For every overdue bill, charge `rate`% of its outstanding amount once per `cycle` days overdue.
// The first cycle is charged on the first day after due date (+ grace days). Idempotent.
async function runInterest(asOf = today()) {
  const s = await getSettings();
  if (s.interest_enabled !== '1') return [];
  const globalRate = Number(s.interest_rate) || 0;
  const cycle = Math.max(1, Number(s.interest_cycle_days) || 30);
  const grace = Math.max(0, Number(s.interest_grace_days) || 0);

  return tx(async () => {
    await db.get(`SELECT pg_advisory_xact_lock(hashtext('interest-run'))`);
    const rows = await db.all(`
      SELECT t.*, ct.interest_rate AS type_rate
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN credit_types ct ON ct.id = c.credit_type_id
      WHERE t.voided = 0 AND t.type IN ('credit','opening','debit_adj')
        AND t.due_date IS NOT NULL AND t.amount - t.settled > 0.004
        AND c.interest_enabled = 1`);

    const created = [];
    const cycles = { id: [], n: [] };
    const touched = new Set();
    let nextRef = null;
    for (const b of rows) {
      const overdueDays = diffDays(asOf, b.due_date) - grace;
      if (overdueDays <= 0) continue;
      const cyclesDue = Math.floor((overdueDays - 1) / cycle) + 1;
      if (cyclesDue <= b.interest_cycles) continue;
      const rate = b.type_rate != null ? Number(b.type_rate) : globalRate;
      if (!(rate > 0)) continue;
      nextRef ||= await refSequence('INT');
      const outstanding = round2(b.amount - b.settled);
      for (let n = b.interest_cycles + 1; n <= cyclesDue; n++) {
        const amt = round2(outstanding * rate / 100);
        if (amt <= 0) continue;
        const chargeDate = addDays(b.due_date, grace + (n - 1) * cycle + 1);
        created.push({ customer_id: b.customer_id, ref_no: nextRef(), date: chargeDate, amount: amt, parent_id: b.id, rate, parent_ref: b.ref_no, cycle: n,
          description: `${rate}% interest on ${b.ref_no} (cycle ${n})` });
      }
      cycles.id.push(b.id); cycles.n.push(cyclesDue);
      touched.add(b.customer_id);
    }
    if (created.length) {
      const col = (k) => created.map((c) => c[k]);
      await db.run(`INSERT INTO transactions (customer_id, type, ref_no, date, due_date, amount, parent_id, description)
        SELECT u.cid, 'interest', u.ref, u.d, u.d, u.amt, u.pid, u.descr
        FROM unnest(?::int[], ?::text[], ?::text[], ?::float8[], ?::int[], ?::text[]) AS u(cid, ref, d, amt, pid, descr)`,
        col('customer_id'), col('ref_no'), col('date'), col('amount'), col('parent_id'), col('description'));
    }
    if (cycles.id.length) {
      await db.run('UPDATE transactions t SET interest_cycles = u.n FROM unnest(?::int[], ?::int[]) AS u(id, n) WHERE t.id = u.id', cycles.id, cycles.n);
    }
    for (const cid of touched) await rebuildAllocations(cid);
    return created;
  });
}

// ---------- aging ----------
const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90p', label: '90+ days' },
];
function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90p';
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = {
  DEBIT_TYPES, CREDIT_TYPES, DEBIT_SQL, CREDIT_SQL, AGING_BUCKETS,
  today, fmtDate, parseDate, addDays, diffDays, round2, isDate,
  rebuildAllocations, customerBalance, balanceColumns, addEntry, voidEntry, runInterest, bucketFor, refSequence, httpError,
};

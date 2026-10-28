// Loads sample areas, customers and 10 months of history so you can explore the system.
// Usage: npm run demo   (only runs on an empty database)
const { db, pool, tx, ready, audit } = require('./db');
const L = require('./ledger');

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

const AREAS = [
  ['Town Center', 'Main town shops', 'Nimal', 'Monday'],
  ['Station Road', 'Along the railway road', 'Kamal', 'Tuesday'],
  ['Hill Side', 'Upcountry estates', 'Sunil', 'Wednesday'],
  ['Lake View', 'Housing scheme', 'Nimal', 'Thursday'],
  ['Industrial Zone', 'Workshops & factories', 'Kamal', 'Friday'],
  ['North Village', 'Rural village route', 'Sunil', 'Saturday'],
];
const FIRST = ['Kasun', 'Ruwan', 'Fathima', 'Mohamed', 'Nuwan', 'Saman', 'Dilani', 'Rizwan', 'Chaminda', 'Tharindu', 'Ayesha', 'Imran', 'Priyantha', 'Lahiru', 'Nadeesha', 'Farook', 'Janaka', 'Sanjeewa', 'Hasitha', 'Ishara'];
const LAST = ['Perera', 'Fernando', 'Silva', 'Rasheed', 'Bandara', 'Jayasinghe', 'Wickrama', 'Nazeer', 'Kumara', 'Dissanayake', 'Hameed', 'Rathnayake'];
const BIZ = ['Constructions', 'Builders', 'Enterprises', 'Traders', 'Engineering', 'Hardware', 'Stores', ''];
const ITEMS = ['Cement 50 bags', 'Steel bars 12mm', 'PVC pipes & fittings', 'Roofing sheets', 'Paint & primer', 'Tiles 60x60', 'Electrical wiring', 'Sand & metal', 'Plumbing items', 'Door locks & hinges', 'Water tank 1000L', 'Tools & hardware'];

(async () => {
  await ready();
  if ((await db.get('SELECT COUNT(*) AS c FROM customers')).c > 0) {
    console.log('Database already has customers — demo data not loaded.');
    return pool.end();
  }
  const today = L.today();
  const owner = await db.get("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  const staff = (await db.get("SELECT id FROM users WHERE role = 'staff' LIMIT 1")) || owner;
  const types = await db.all('SELECT * FROM credit_types');
  const N = 42;

  await tx(async () => {
    const areaIds = [];
    for (const a of AREAS) areaIds.push((await db.get('INSERT INTO areas (name, description, collector, visit_day) VALUES (?, ?, ?, ?) RETURNING id', ...a)).id);

    // customers
    const cust = [];
    for (let i = 1; i <= N; i++) {
      const t = pick(types);
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const biz = pick(BIZ);
      const phone = '07' + between(0, 8) + String(between(1000000, 9999999));
      cust.push({ code: 'GMS-' + String(i).padStart(4, '0'), name, biz: biz ? `${name.split(' ')[1]} ${biz}` : null, phone,
        address: `${between(1, 300)}, ${pick(['Main St', 'Temple Rd', 'Lake Rd', 'Hill St', 'Station Rd'])}`,
        area: pick(areaIds), type: t, channel: pick(['sms', 'sms', 'whatsapp']) });
    }
    const col = (arr, f) => arr.map(f);
    const ids = await db.all(`INSERT INTO customers (code, name, business_name, phone, whatsapp, address, area_id, credit_type_id, credit_limit, credit_period_days, preferred_channel, created_at)
      SELECT u.code, u.name, u.biz, u.phone, u.phone, u.addr, u.area, u.type, u.lim, u.period, u.ch, ?
      FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::int[], ?::int[], ?::float8[], ?::int[], ?::text[])
        AS u(code, name, biz, phone, addr, area, type, lim, period, ch)
      RETURNING id, code`, L.addDays(today, -300) + ' 09:00:00',
      col(cust, (c) => c.code), col(cust, (c) => c.name), col(cust, (c) => c.biz), col(cust, (c) => c.phone), col(cust, (c) => c.address),
      col(cust, (c) => c.area), col(cust, (c) => c.type.id), col(cust, (c) => c.type.default_limit), col(cust, (c) => c.type.default_period_days), col(cust, (c) => c.channel));
    const idByCode = Object.fromEntries(ids.map((r) => [r.code, r.id]));

    // bills and payments: good payers, slow payers, defaulters
    const tr = [];
    let inv = 0, rcp = 0;
    for (const c of cust) {
      const t = c.type;
      const behaviour = rnd();
      const payRatio = behaviour < 0.55 ? 0.95 : behaviour < 0.85 ? 0.7 : 0.3;
      const payDelay = behaviour < 0.55 ? [5, t.default_period_days] : behaviour < 0.85 ? [t.default_period_days, t.default_period_days + 50] : [60, 150];
      const bills = between(3, 12);
      for (let b = 0; b < bills; b++) {
        const date = L.addDays(today, -between(1, 300));
        const amount = Math.round(between(3, Math.max(4, t.default_limit / 6000)) * 1000 + between(0, 9) * 100);
        tr.push({ cid: idByCode[c.code], type: 'credit', ref: `INV-${String(++inv).padStart(5, '0')}`, date, due: L.addDays(date, t.default_period_days), amount, descr: pick(ITEMS), method: null, by: pick([owner.id, staff.id]) });
        if (rnd() < payRatio) {
          const pdate = L.addDays(date, between(...payDelay));
          if (pdate <= today) {
            const amt = rnd() < 0.75 ? amount : Math.round(amount * (0.3 + rnd() * 0.5));
            tr.push({ cid: idByCode[c.code], type: 'payment', ref: `RCP-${String(++rcp).padStart(5, '0')}`, date: pdate, due: null, amount: amt, descr: null, method: pick(['Cash', 'Cash', 'Cheque', 'Bank transfer']), by: pick([owner.id, staff.id]) });
          }
        }
      }
    }
    tr.sort((a, b) => a.date.localeCompare(b.date));
    await db.run(`INSERT INTO transactions (customer_id, type, ref_no, date, due_date, amount, description, payment_method, created_by, created_at)
      SELECT u.cid, u.type, u.ref, u.d, u.due, u.amt, u.descr, u.method, u.by, u.d || ' 10:00:00'
      FROM unnest(?::int[], ?::text[], ?::text[], ?::text[], ?::text[], ?::float8[], ?::text[], ?::text[], ?::int[])
        AS u(cid, type, ref, d, due, amt, descr, method, by)`,
      col(tr, (x) => x.cid), col(tr, (x) => x.type), col(tr, (x) => x.ref), col(tr, (x) => x.date), col(tr, (x) => x.due),
      col(tr, (x) => x.amount), col(tr, (x) => x.descr), col(tr, (x) => x.method), col(tr, (x) => x.by));
    for (const id of ids) await L.rebuildAllocations(id.id);
  });

  const interest = await L.runInterest(today);
  await audit(owner.id, 'demo_data', null, null, `${N} customers`);
  const n = (await db.get('SELECT COUNT(*) AS c FROM transactions')).c;
  console.log(`Demo data loaded: ${AREAS.length} areas, ${N} customers, ${n} transactions, ${interest.length} interest charges.`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

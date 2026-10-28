// Reports: gallery + individual reports with filters, charts, CSV export and print.
const REPORTS = [
  ['aging', 'Aging report', 'Outstanding split by days past due — per customer', 'clock', 'var(--s1)'],
  ['area-summary', 'Area-wise summary', 'Customers, balances, overdue and collections per area', 'map', 'var(--s3)'],
  ['collections', 'Collections report', 'Payments received by day, method, area and staff', 'cash', 'var(--good)'],
  ['credit-sales', 'Credit sales report', 'Credit bills issued in a period and what is still unpaid', 'receipt', 'var(--s2)'],
  ['interest', 'Interest report', 'Overdue interest charged, collected and pending', 'percent', 'var(--s7)'],
  ['overdue', 'Overdue customers', 'Who is late, by how much and for how long', 'alert', 'var(--critical)'],
  ['limit-utilization', 'Credit limit usage', 'How much of each customer’s credit limit is used', 'trending', 'var(--s4)'],
  ['statement', 'Customer statement', 'Printable account statement with running balance', 'book', 'var(--s5)'],
  ['daybook', 'Day book', 'All entries for a day or period, including voids', 'calendar', 'var(--s6)'],
  ['customer-directory', 'Customer directory', 'Customer list grouped by area with contacts & balances', 'users', 'var(--s8)'],
  ['credit-types', 'Credit type summary', 'Balances and limit usage per credit type', 'layers', 'var(--brand)'],
];

G.pages.reports = async (view) => {
  G.head('Reports', 'Choose a report — every report can be filtered, printed and exported to Excel');
  view.innerHTML = `<div class="report-tiles">${REPORTS.map(([k, t, d, ic, c], i) => `
    <a class="report-tile" href="#/reports/${k}" style="--c:${c};animation:rise .5s ${i * 0.04}s both var(--ease)"><div class="icon-dot">${G.icon(ic)}</div><h4>${t}</h4><p>${d}</p></a>`).join('')}
    ${G.can('owner') ? `<a class="report-tile" href="#/owner" style="--c:var(--brand);border-color:var(--brand)"><div class="icon-dot">${G.icon('crown')}</div><h4>Owner reports</h4><p>Business performance, risk, efficiency, staff & audit</p></a>` : ''}</div>`;
};

function filterBar({ dates = false, area = false, type = false, extra = '' }, st) {
  return `<div class="card mb no-print"><div class="filters">
    ${dates ? `<div class="field"><label>From</label><input type="date" data-k="from" value="${st.from}"></div><div class="field"><label>To</label><input type="date" data-k="to" value="${st.to}"></div>
      <div class="chips" style="margin-bottom:6px">${[['Today', 0], ['This month', 'm'], ['Last month', 'lm'], ['3 months', 90], ['This year', 'y']].map(([l, v]) => `<button class="chip" data-range="${v}">${l}</button>`).join('')}</div>` : ''}
    ${area ? `<div class="field"><label>Area</label><select data-k="area_id">${G.areaOptions(st.area_id)}</select></div>` : ''}
    ${type ? `<div class="field"><label>Credit type</label><select data-k="credit_type_id">${G.typeOptions(st.credit_type_id)}</select></div>` : ''}
    ${extra}<span class="spacer"></span><button class="btn" onclick="window.print()">${G.icon('printer')} Print / PDF</button></div></div>`;
}
function bindFilters(view, st, load) {
  view.querySelectorAll('[data-k]').forEach((el) => (el.onchange = () => { st[el.dataset.k] = el.value; load(); }));
  view.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => {
    const v = b.dataset.range, t = G.today();
    if (v === '0') { st.from = st.to = t; }
    else if (v === 'm') { st.from = G.monthStart(); st.to = t; }
    else if (v === 'lm') { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth() - 1, 1), e = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; st.from = f(s); st.to = f(e); }
    else if (v === 'y') { st.from = t.slice(0, 4) + '-01-01'; st.to = t; }
    else { st.from = G.addDays(t, -Number(v)); st.to = t; }
    view.querySelector('[data-k=from]').value = st.from;
    view.querySelector('[data-k=to]').value = st.to;
    view.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('active', x === b));
    load();
  }));
}
const custLink = (id, name, code) => `<a href="#/customers/${id}"><b>${G.esc(name)}</b></a>${code ? ` <span class="muted" style="font-size:12px">${G.esc(code)}</span>` : ''}`;

const R = {};

R.aging = async (view, st) => {
  view.innerHTML = filterBar({ area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/aging?' + G.qs(st));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Aging report', 'As of ' + G.date(d.as_of))}
      <div class="kpis">${d.buckets.map((b, i) => G.kpi({ label: b.label, value: d.totals[b.key], icon: i ? 'clock' : 'check', accent: G.AGING_COLORS[i], foot: d.totals.total ? `${((d.totals[b.key] / d.totals.total) * 100).toFixed(1)}% of total` : '' })).join('')}</div>
      <div class="card mt"><div class="card-head"><h3>Aging by customer</h3><div class="sub">Total ${G.money(d.totals.total)}</div></div><div id="tb"></div></div>`;
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'aging-report', sortKey: 'total',
      columns: [
        { key: 'name', label: 'Customer', cls: 'wrap', render: (r) => custLink(r.id, r.name, r.code), csv: (r) => `${r.name} (${r.code})` },
        { key: 'area', label: 'Area' }, { key: 'phone', label: 'Phone' },
        ...d.buckets.map((b) => ({ key: b.key, label: b.label, align: 'right', fmt: 'money', sum: true })),
        { key: 'total', label: 'Total', align: 'right', fmt: 'money', sum: true, render: (r) => `<b class="num">${G.n2(r.total)}</b>` },
      ],
    });
    G.countUp(out);
  };
  bindFilters(view, st, load);
  await load();
};

R['area-summary'] = async (view, st) => {
  view.innerHTML = filterBar({ dates: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/area-summary?' + G.qs(st));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Area-wise summary', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="grid g2"><div class="card"><div class="card-head"><div><h3>Outstanding vs overdue per area</h3><div class="sub">Current position</div></div>${G.legend([['Outstanding', G.series(0)], ['Overdue', G.series(7)]])}</div><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h3>Credit vs collected per area</h3><div class="sub">In selected period</div></div>${G.legend([['Credit issued', G.series(1)], ['Collected', G.series(0)]])}</div><div class="chart-box"><canvas id="c2"></canvas></div></div></div>
      <div class="card mt"><div id="tb"></div></div>`;
    const labels = d.rows.map((r) => r.name);
    G.chart(out.querySelector('#c1'), { type: 'bar', data: { labels, datasets: [{ label: 'Outstanding', data: d.rows.map((r) => r.balance), backgroundColor: G.series(0) }, { label: 'Overdue', data: d.rows.map((r) => r.overdue), backgroundColor: G.series(7) }] } });
    G.chart(out.querySelector('#c2'), { type: 'bar', data: { labels, datasets: [{ label: 'Credit issued', data: d.rows.map((r) => r.credit), backgroundColor: G.series(1) }, { label: 'Collected', data: d.rows.map((r) => r.collected), backgroundColor: G.series(0) }] } });
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'area-summary', search: false, onRow: (r) => r.id && (location.hash = `#/customers?area=${r.id}`),
      columns: [
        { key: 'name', label: 'Area', render: (r) => `<b>${G.esc(r.name)}</b>` }, { key: 'collector', label: 'Collector' },
        { key: 'customers', label: 'Customers', align: 'right', fmt: 'int', sum: true },
        { key: 'overdue_customers', label: 'Overdue cust.', align: 'right', fmt: 'int', sum: true },
        { key: 'balance', label: 'Outstanding', align: 'right', fmt: 'money', sum: true },
        { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
        { key: 'overdue_pct', label: 'Overdue %', align: 'right', render: (r) => `${r.overdue_pct.toFixed(1)}%` },
        { key: 'credit', label: 'Credit (period)', align: 'right', fmt: 'money', sum: true },
        { key: 'collected', label: 'Collected (period)', align: 'right', fmt: 'money', sum: true },
        { key: 'interest', label: 'Interest (period)', align: 'right', fmt: 'money', sum: true },
      ],
    });
  };
  bindFilters(view, st, load);
  await load();
};

R.collections = async (view, st) => {
  view.innerHTML = filterBar({ dates: true, area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/collections?' + G.qs(st));
    const out = view.querySelector('#out');
    const days = Math.max(1, Math.round((new Date(d.to) - new Date(d.from)) / 86400000) + 1);
    out.innerHTML = `${G.printHead('Collections report', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="kpis">${G.kpi({ label: 'Total collected', value: d.total, icon: 'cash', accent: 'var(--good)' })}${G.kpi({ label: 'Payments', value: d.rows.length, fmt: 'int', icon: 'receipt', accent: 'var(--s1)' })}${G.kpi({ label: 'Daily average', value: d.total / days, icon: 'calendar', accent: 'var(--s3)' })}${G.kpi({ label: 'Average payment', value: d.rows.length ? d.total / d.rows.length : 0, icon: 'wallet', accent: 'var(--s7)' })}</div>
      <div class="grid g-2-1 mt"><div class="card"><div class="card-head"><h3>Collections by day</h3></div><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>By payment method</h3></div>${groupList(d.by_method, d.total)}<div class="card-head mt"><h3>By staff</h3></div>${groupList(d.by_user, d.total)}</div></div>
      <div class="card mt"><div class="card-head"><h3>By area</h3></div>${groupList(d.by_area, d.total)}</div>
      <div class="card mt"><div id="tb"></div></div>`;
    G.chart(out.querySelector('#c1'), { type: 'bar', data: { labels: d.by_day.map((x) => G.date(x.key).replace(/ \d{4}$/, '')), datasets: [{ label: 'Collected', data: d.by_day.map((x) => x.amount), backgroundColor: G.series(0) }] } });
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'collections', sortKey: 'date',
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' }, { key: 'ref_no', label: 'Receipt' },
        { key: 'customer_name', label: 'Customer', render: (r) => custLink(r.customer_id, r.customer_name, r.customer_code) },
        { key: 'area_name', label: 'Area' }, { key: 'payment_method', label: 'Method' }, { key: 'cheque_no', label: 'Cheque / ref' },
        { key: 'created_by_name', label: 'Received by' }, { key: 'amount', label: 'Amount', align: 'right', fmt: 'money', sum: true },
      ],
    });
    G.countUp(out); G.animateBars(out);
  };
  bindFilters(view, st, load);
  await load();
};
function groupList(groups, total) {
  if (!groups.length) return '<div class="muted">No data</div>';
  return [...groups].sort((a, b) => b.amount - a.amount).map((g) => `<div class="row" style="margin:8px 0;flex-wrap:nowrap"><span style="width:120px;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${G.esc(g.key)}</span>
    <div class="bar" style="flex:1"><i data-w="${total ? (g.amount / total) * 100 : 0}"></i></div><span class="num" style="min-width:110px;text-align:right;font-size:13px">${G.n2(g.amount)} <span class="muted">(${g.count})</span></span></div>`).join('');
}

R['credit-sales'] = async (view, st) => {
  view.innerHTML = filterBar({ dates: true, area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/credit-sales?' + G.qs(st));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Credit sales report', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="kpis">${G.kpi({ label: 'Credit issued', value: d.total, icon: 'receipt', accent: 'var(--s2)' })}${G.kpi({ label: 'Bills', value: d.rows.length, fmt: 'int', icon: 'list', accent: 'var(--s1)' })}${G.kpi({ label: 'Still unpaid', value: d.outstanding, icon: 'alert', accent: 'var(--critical)' })}${G.kpi({ label: 'Already paid', value: d.total - d.outstanding, icon: 'check', accent: 'var(--good)' })}</div>
      <div class="card mt"><div class="card-head"><h3>Credit issued by day</h3></div><div class="chart-box short"><canvas id="c1"></canvas></div></div>
      <div class="card mt"><div id="tb"></div></div>`;
    G.chart(out.querySelector('#c1'), { type: 'bar', data: { labels: d.by_day.map((x) => G.date(x.key).replace(/ \d{4}$/, '')), datasets: [{ label: 'Credit', data: d.by_day.map((x) => x.amount), backgroundColor: G.series(1) }] } });
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'credit-sales', sortKey: 'date',
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' }, { key: 'ref_no', label: 'Bill' },
        { key: 'customer_name', label: 'Customer', render: (r) => custLink(r.customer_id, r.customer_name, r.customer_code) },
        { key: 'area_name', label: 'Area' }, { key: 'description', label: 'Items', cls: 'wrap' }, { key: 'due_date', label: 'Due', fmt: 'date' },
        { key: 'amount', label: 'Amount', align: 'right', fmt: 'money', sum: true }, { key: 'open', label: 'Unpaid', align: 'right', fmt: 'money', sum: true },
      ],
    });
    G.countUp(out);
  };
  bindFilters(view, st, load);
  await load();
};

R.interest = async (view, st) => {
  view.innerHTML = filterBar({ dates: true, area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/interest?' + G.qs(st));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Interest report', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="kpis">${G.kpi({ label: 'Interest charged', value: d.total, icon: 'percent', accent: 'var(--s7)' })}${G.kpi({ label: 'Collected', value: d.collected, icon: 'check', accent: 'var(--good)' })}${G.kpi({ label: 'Pending', value: d.pending, icon: 'clock', accent: 'var(--warning)' })}${G.kpi({ label: 'Charges', value: d.rows.length, fmt: 'int', icon: 'list', accent: 'var(--s1)' })}</div>
      <div class="grid g-1-2 mt"><div class="card"><div class="card-head"><h3>Top interest payers</h3></div>${groupList(d.by_customer.slice(0, 10), d.total)}</div><div class="card"><div id="tb"></div></div></div>`;
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'interest-report', sortKey: 'date',
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' }, { key: 'ref_no', label: 'Ref' },
        { key: 'customer_name', label: 'Customer', render: (r) => custLink(r.customer_id, r.customer_name, r.customer_code) },
        { key: 'parent_ref', label: 'On bill' }, { key: 'description', label: 'Details', cls: 'wrap', render: (r) => `<span class="text-2" style="font-size:12px">${G.esc(r.description)}</span>` },
        { key: 'amount', label: 'Interest', align: 'right', fmt: 'money', sum: true }, { key: 'open', label: 'Unpaid', align: 'right', fmt: 'money', sum: true },
      ],
    });
    G.countUp(out); G.animateBars(out);
  };
  bindFilters(view, st, load);
  await load();
};

R.overdue = async (view, st) => {
  view.innerHTML = filterBar({ area: true, type: true, extra: `<div class="field"><label>Minimum days late</label><select data-k="min_days"><option value="">Any</option><option value="31">30+</option><option value="61">60+</option><option value="91">90+</option></select></div>` }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/overdue?' + G.qs(st));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Overdue customers', 'As of ' + G.date(d.as_of))}<div class="card"><div id="tb"></div></div>`;
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'overdue-report', sortKey: 'days_overdue',
      columns: [
        { key: 'name', label: 'Customer', cls: 'wrap', render: (r) => custLink(r.id, r.name, r.code), csv: (r) => r.name },
        { key: 'area_name', label: 'Area' }, { key: 'phone', label: 'Phone' },
        { key: 'days_overdue', label: 'Days late', align: 'right', render: (r) => G.riskBadge(r), csv: (r) => r.days_overdue },
        { key: 'oldest_overdue', label: 'Oldest due', fmt: 'date' }, { key: 'last_payment', label: 'Last payment', fmt: 'date' },
        { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true }, { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true },
      ],
    });
  };
  bindFilters(view, st, load);
  await load();
};

R['limit-utilization'] = async (view, st) => {
  view.innerHTML = filterBar({ area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/limit-utilization?' + G.qs(st));
    const out = view.querySelector('#out');
    const over = d.rows.filter((r) => r.over_limit), near = d.rows.filter((r) => !r.over_limit && r.utilization >= 80);
    out.innerHTML = `${G.printHead('Credit limit usage', '')}
      <div class="kpis">${G.kpi({ label: 'Over limit', value: over.length, fmt: 'int', icon: 'alert', accent: 'var(--critical)' })}${G.kpi({ label: '80%+ used', value: near.length, fmt: 'int', icon: 'trending', accent: 'var(--warning)' })}${G.kpi({ label: 'Total limits given', value: d.rows.reduce((s, r) => s + r.credit_limit, 0), icon: 'shield', accent: 'var(--s1)' })}${G.kpi({ label: 'Total used', value: d.rows.reduce((s, r) => s + Math.max(0, r.balance), 0), icon: 'wallet', accent: 'var(--s3)' })}</div>
      <div class="card mt"><div id="tb"></div></div>`;
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'limit-utilization', sortKey: 'utilization',
      columns: [
        { key: 'name', label: 'Customer', cls: 'wrap', render: (r) => custLink(r.id, r.name, r.code), csv: (r) => r.name },
        { key: 'area_name', label: 'Area' }, { key: 'type_name', label: 'Type' },
        { key: 'credit_limit', label: 'Limit', align: 'right', fmt: 'money', sum: true }, { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true },
        { key: 'available', label: 'Available', align: 'right', render: (r) => `<span class="num ${r.available < 0 ? 'type-interest' : ''}">${r.credit_limit > 0 ? G.n2(r.available) : '∞'}</span>` },
        { key: 'utilization', label: 'Used', render: (r) => G.utilBar(r.utilization), csv: (r) => r.utilization ?? '' },
        { key: 'status', label: 'Status', render: (r) => G.statusBadge(r.status) },
      ],
    });
    G.countUp(out);
  };
  bindFilters(view, st, load);
  await load();
};

R.statement = async (view, st, id) => {
  st.from = st.from === G.monthStart() ? G.addDays(G.today(), -90) : st.from;
  view.innerHTML = `<div class="card mb no-print"><div class="filters">
    <div class="field" style="min-width:300px"><label>Customer</label><div id="picker"></div></div>
    <div class="field"><label>From</label><input type="date" data-k="from" value="${st.from}"></div><div class="field"><label>To</label><input type="date" data-k="to" value="${st.to}"></div>
    <span class="spacer"></span><button class="btn" id="sMsg">${G.icon('send')} Send to customer</button><button class="btn primary" onclick="window.print()">${G.icon('printer')} Print / PDF</button></div></div><div id="out"></div>`;
  G.customerPicker(view.querySelector('#picker'), (c) => (location.hash = `#/reports/statement/${c.id}`));
  const out = view.querySelector('#out');
  if (!id) { out.innerHTML = `<div class="card"><div class="empty">${G.icon('book')}Pick a customer to see their statement</div></div>`; return; }
  const load = async () => {
    const d = await G.get(`/api/reports/statement/${id}?` + G.qs({ from: st.from, to: st.to }));
    const c = d.customer;
    view.querySelector('.cp-in').value = `${c.name} (${c.code})`;
    view.querySelector('#sMsg').onclick = () => G.composeModal({ customer_ids: [c.id], label: c.name, template: 'statement', channel: c.preferred_channel });
    out.innerHTML = `<div class="card">
      <div class="row between" style="align-items:flex-start;border-bottom:2px solid var(--border-strong);padding-bottom:14px">
        <div><h2 style="font-size:22px">${G.esc(d.business.name)}</h2><div class="muted">${G.esc([d.business.address, d.business.phone, d.business.email].filter(Boolean).join(' · '))}</div></div>
        <div class="right"><div style="font-size:18px;font-weight:800;letter-spacing:.08em">STATEMENT OF ACCOUNT</div><div class="muted">${G.date(d.from)} – ${G.date(d.to)}</div></div></div>
      <div class="row between mt" style="align-items:flex-start">
        <div><div class="muted" style="font-size:12px;font-weight:700">BILL TO</div><b style="font-size:16px">${G.esc(c.name)}</b>${c.business_name ? `<div>${G.esc(c.business_name)}</div>` : ''}<div class="text-2">${G.esc(c.address || '')}</div><div class="text-2">${G.esc(c.phone || '')}</div></div>
        <div class="stat-list" style="min-width:420px;grid-template-columns:repeat(3,1fr)"><div class="stat"><span>Account</span><b style="font-size:15px">${G.esc(c.code)}</b></div><div class="stat"><span>Credit limit</span><b style="font-size:15px">${G.n2(c.credit_limit)}</b></div><div class="stat"><span>Period</span><b style="font-size:15px">${c.credit_period_days} days</b></div></div></div>
      <div class="mt" id="tb"></div>
      <div class="row mt" style="justify-content:flex-end"><div class="stat-list" style="min-width:420px;grid-template-columns:repeat(3,1fr)">
        <div class="stat"><span>Opening</span><b>${G.money(d.opening)}</b></div><div class="stat"><span>Overdue now</span><b class="type-interest">${G.money(c.overdue)}</b></div><div class="stat" style="border-color:var(--brand)"><span>Closing balance</span><b>${G.money(d.closing)}</b></div></div></div>
      <p class="muted mt" style="font-size:12px">Bills unpaid after the credit period attract overdue interest. Please contact us for any discrepancies.</p></div>`;
    G.table(out.querySelector('#tb'), {
      rows: [{ date: d.from, ref_no: '', type: '', description: 'Opening balance', debit: 0, credit: 0, running: d.opening, _open: true }, ...d.rows],
      csv: `statement-${c.code}`, search: false, footer: true,
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' }, { key: 'ref_no', label: 'Ref' },
        { key: 'type', label: 'Type', render: (r) => (r._open ? '' : G.TYPE_LABEL[r.type]), csv: (r) => G.TYPE_LABEL[r.type] || '' },
        { key: 'description', label: 'Description', cls: 'wrap', render: (r) => (r._open ? '<b>Opening balance</b>' : G.esc(r.description || r.payment_method || '')) },
        { key: 'due_date', label: 'Due', render: (r) => (r.due_date && r.type !== 'interest' ? G.date(r.due_date) : '') },
        { key: 'debit', label: 'Debit', align: 'right', fmt: 'money', sum: true }, { key: 'credit', label: 'Credit', align: 'right', fmt: 'money', sum: true },
        { key: 'running', label: 'Balance', align: 'right', fmt: 'money' },
      ],
    });
  };
  bindFilters(view, st, load);
  await load();
};

R.daybook = async (view, st) => {
  st.from = st.to = G.today();
  view.innerHTML = filterBar({ dates: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/daybook?' + G.qs({ from: st.from, to: st.to }));
    const out = view.querySelector('#out');
    out.innerHTML = `${G.printHead('Day book', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="kpis">${G.kpi({ label: 'Credit sales', value: d.totals.credit, icon: 'receipt', accent: 'var(--s2)' })}${G.kpi({ label: 'Payments', value: d.totals.payment, icon: 'cash', accent: 'var(--good)' })}${G.kpi({ label: 'Interest', value: d.totals.interest, icon: 'percent', accent: 'var(--s7)' })}${G.kpi({ label: 'Voided entries', value: d.totals.voided, fmt: 'int', icon: 'x', accent: 'var(--critical)' })}</div>
      <div class="card mt"><div id="tb"></div></div>`;
    G.table(out.querySelector('#tb'), {
      rows: d.rows, csv: 'daybook',
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' }, { key: 'created_at', label: 'Time', render: (r) => r.created_at.slice(11, 16) },
        { key: 'ref_no', label: 'Ref' }, { key: 'type', label: 'Type', render: (r) => G.typeBadge(r.type), csv: (r) => G.TYPE_LABEL[r.type] },
        { key: 'customer_name', label: 'Customer', render: (r) => custLink(r.customer_id, r.customer_name, r.customer_code) },
        { key: 'description', label: 'Details', cls: 'wrap', render: (r) => `${G.esc(r.description || r.payment_method || '')}${r.voided ? ` <span class="badge critical">VOID</span>` : ''}` },
        { key: 'created_by_name', label: 'By' },
        { key: 'debit', label: 'Debit', align: 'right', sum: true, value: (r) => (G.isDebit(r.type) && !r.voided ? r.amount : 0), render: (r) => (G.isDebit(r.type) ? `<span class="num">${G.n2(r.amount)}</span>` : '') },
        { key: 'credit', label: 'Credit', align: 'right', sum: true, value: (r) => (!G.isDebit(r.type) && !r.voided ? r.amount : 0), render: (r) => (!G.isDebit(r.type) ? `<span class="num amount-neg">${G.n2(r.amount)}</span>` : '') },
      ],
    });
    G.countUp(out);
  };
  bindFilters(view, st, load);
  await load();
};

R['customer-directory'] = async (view, st) => {
  view.innerHTML = filterBar({ area: true, type: true }, st) + '<div id="out"></div>';
  const load = async () => {
    const d = await G.get('/api/reports/customer-directory?' + G.qs(st));
    const out = view.querySelector('#out');
    const groups = {};
    for (const c of d.rows) (groups[c.area_name || 'Unassigned'] = groups[c.area_name || 'Unassigned'] || []).push(c);
    out.innerHTML = `${G.printHead('Customer directory by area', '')}<div class="row mb no-print"><button class="btn sm" id="csvAll">${G.icon('download')} Export all to CSV</button></div>` +
      Object.entries(groups).map(([area, cs], i) => `<div class="card mb"><div class="card-head"><h3>${G.icon('pin').replace('<svg', '<svg width="16" height="16" style="vertical-align:-2px;color:var(--brand)"')} ${G.esc(area)}</h3><div class="sub">${cs.length} customers · ${G.money(cs.reduce((s, c) => s + c.balance, 0))}</div></div><div id="g${i}"></div></div>`).join('');
    const cols = [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Name', render: (r) => custLink(r.id, r.name) },
      { key: 'business_name', label: 'Business' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address', cls: 'wrap' },
      { key: 'type_name', label: 'Type' }, { key: 'credit_limit', label: 'Limit', align: 'right', fmt: 'money' },
      { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true }, { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
    ];
    Object.values(groups).forEach((cs, i) => G.table(out.querySelector(`#g${i}`), { rows: cs, columns: cols, search: false, sortKey: 'name', sortDir: 'asc' }));
    out.querySelector('#csvAll').onclick = () => G.downloadCsv('customer-directory', [{ key: 'area_name', label: 'Area' }, ...cols], d.rows, (c, r) => String(r[c.key] ?? ''));
  };
  bindFilters(view, st, load);
  await load();
};

R['credit-types'] = async (view) => {
  const d = await G.get('/api/reports/credit-types');
  view.innerHTML = `${G.printHead('Credit type summary', '')}<div class="card mb no-print"><div class="filters"><span class="spacer"></span><button class="btn" onclick="window.print()">${G.icon('printer')} Print / PDF</button></div></div>
    <div class="grid g-1-2"><div class="card"><div class="card-head"><h3>Balance per type</h3></div><div class="chart-box"><canvas id="c1"></canvas></div></div><div class="card"><div id="tb"></div></div></div>`;
  G.chart(view.querySelector('#c1'), { type: 'bar', data: { labels: d.rows.map((r) => r.name), datasets: [{ label: 'Balance', data: d.rows.map((r) => r.balance), backgroundColor: d.rows.map((r) => r.color) }] }, options: { indexAxis: 'y' } });
  G.table(view.querySelector('#tb'), {
    rows: d.rows, csv: 'credit-types', search: false,
    columns: [
      { key: 'name', label: 'Type', render: (r) => `<span class="badge"><span class="dot" style="color:${G.esc(r.color)}"></span>${G.esc(r.name)}</span>`, csv: (r) => r.name },
      { key: 'default_period_days', label: 'Period', align: 'right', render: (r) => `${r.default_period_days}d` },
      { key: 'customers', label: 'Customers', align: 'right', fmt: 'int', sum: true },
      { key: 'total_limit', label: 'Total limits', align: 'right', fmt: 'money', sum: true },
      { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true },
      { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
      { key: 'utilization', label: 'Used', render: (r) => G.utilBar(r.utilization), csv: (r) => r.utilization },
    ],
  });
};

G.pages.report = async (view, name, id) => {
  const meta = REPORTS.find((r) => r[0] === name);
  if (!meta || !R[name]) throw new Error('Unknown report');
  await G.loadLookups();
  G.head(meta[1], meta[2]);
  const st = { from: G.monthStart(), to: G.today(), area_id: '', credit_type_id: '' };
  await R[name](view, st, id);
};

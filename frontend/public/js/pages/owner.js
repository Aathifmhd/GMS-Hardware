// Owner reports: business performance, efficiency, risk, area & staff performance, audit trail.
G.pages.owner = async (view) => {
  if (!G.can('owner')) throw new Error('Owner reports are only available to the owner account');
  G.head('Owner Reports', 'Confidential business performance overview');
  const st = { from: G.today().slice(0, 4) + '-01-01', to: G.today() };
  view.innerHTML = `
    <div class="card mb no-print"><div class="filters">
      <div class="field"><label>From</label><input type="date" id="oFrom" value="${st.from}"></div>
      <div class="field"><label>To</label><input type="date" id="oTo" value="${st.to}"></div>
      <div class="chips" style="margin-bottom:6px"><button class="chip" data-r="m">This month</button><button class="chip" data-r="q">Last 90 days</button><button class="chip active" data-r="y">This year</button><button class="chip" data-r="all">All time</button></div>
      <span class="spacer"></span>
      <div class="tabs" id="oTabs"><button class="tab active" data-t="perf">Performance</button><button class="tab" data-t="audit">Audit trail</button></div>
      <button class="btn" onclick="window.print()">${G.icon('printer')} Print</button></div></div>
    <div id="oOut"></div>`;
  const $ = (s) => view.querySelector(s);
  let tab = 'perf';

  const perf = async () => {
    const d = await G.get('/api/owner/summary?' + G.qs(st));
    const k = d.kpis;
    const gr = (v) => (v == null ? '' : `<span class="${v >= 0 ? 'trend-up' : 'trend-down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span> vs last month`);
    const out = $('#oOut');
    out.innerHTML = `
      ${G.printHead('Owner report', `${G.date(d.from)} – ${G.date(d.to)}`)}
      <div class="hero" style="background:linear-gradient(120deg,#0f172a,#1e293b 60%,#334155);color:#fff">
        <h1 style="color:#fbbf24">${G.icon('crown').replace('<svg', '<svg width="26" height="26" style="vertical-align:-4px"')} Business health</h1>
        <p>${G.date(d.from)} – ${G.date(d.to)} · ${k.customers} customers, ${k.active_debtors} currently owe</p>
        <div class="hero-stats">
          <div><span>Collection efficiency</span><b>${k.efficiency == null ? '—' : k.efficiency.toFixed(1) + '%'}</b></div>
          <div><span>Days sales outstanding</span><b>${k.dso == null ? '—' : k.dso + ' days'}</b></div>
          <div><span>Overdue share</span><b>${k.overdue_pct.toFixed(1)}%</b></div>
          <div><span>Interest earned (all time)</span><b data-count="${k.total_interest_all_time}">0</b></div>
        </div>
      </div>
      <div class="kpis k3 mt">
        ${G.kpi({ label: 'Outstanding now', value: k.outstanding, icon: 'wallet', accent: 'var(--s1)', foot: `Exposure (limits) ${G.money(k.exposure)}` })}
        ${G.kpi({ label: 'Credit issued', value: k.credit, icon: 'receipt', accent: 'var(--s2)', foot: gr(k.credit_growth) || 'In period' })}
        ${G.kpi({ label: 'Collected', value: k.collected, icon: 'cash', accent: 'var(--good)', foot: gr(k.collection_growth) || 'In period' })}
        ${G.kpi({ label: 'Interest earned', value: k.interest, icon: 'percent', accent: 'var(--s7)', foot: `${G.money(k.interest_collected)} actually collected` })}
        ${G.kpi({ label: 'Net change in debt', value: k.net_change, icon: 'trending', accent: k.net_change > 0 ? 'var(--serious)' : 'var(--good)', foot: k.net_change > 0 ? 'Debt grew in this period' : 'Debt reduced in this period' })}
        ${G.kpi({ label: 'Bad-debt risk (90+ days)', value: k.bad_debt_risk, icon: 'alert', accent: 'var(--critical)', foot: k.outstanding ? `${((k.bad_debt_risk / k.outstanding) * 100).toFixed(1)}% of outstanding` : '' })}
      </div>

      <div class="grid g2 mt">
        <div class="card"><div class="card-head"><div><h3>Monthly flows</h3><div class="sub">Last 12 months</div></div>${G.legend([['Credit issued', G.series(1)], ['Collected', G.series(0)], ['Interest', G.series(6)]])}</div><div class="chart-box tall"><canvas id="oc1"></canvas></div></div>
        <div class="card"><div class="card-head"><div><h3>Total outstanding trend</h3><div class="sub">Balance owed at each month end</div></div></div><div class="chart-box tall"><canvas id="oc2"></canvas></div></div>
      </div>

      <div class="grid g-1-2 mt">
        <div class="card"><div class="card-head"><div><h3>Debt age profile</h3><div class="sub">Where the money is stuck</div></div></div><div class="chart-box"><canvas id="oc3"></canvas></div></div>
        <div class="card"><div class="card-head"><div><h3>Area performance</h3><div class="sub">In selected period, ranked by collections</div></div></div><div id="oArea"></div></div>
      </div>

      <div class="card mt"><div class="card-head"><div><h3>${G.icon('shield').replace('<svg', '<svg width="17" height="17" style="vertical-align:-3px;color:var(--critical)"')} Credit risk watch-list</h3><div class="sub">Score 0–100 from days late, overdue share, limit usage and payment recency</div></div></div><div id="oRisk"></div></div>

      <div class="grid g2 mt">
        <div class="card"><div class="card-head"><div><h3>Top customers by credit volume</h3><div class="sub">In selected period</div></div></div><div id="oTop"></div></div>
        <div class="card"><div class="card-head"><div><h3>Staff performance</h3><div class="sub">Entries recorded in selected period</div></div></div><div id="oStaff"></div></div>
      </div>

      <div class="grid g2 mt">
        <div class="card"><div class="card-head"><div><h3>Messaging</h3><div class="sub">Messages in selected period</div></div></div><div id="oMsg"></div></div>
        <div class="card"><div class="card-head"><div><h3>Voided entries</h3><div class="sub">Watch for unusual cancellations</div></div></div><div id="oVoid"></div></div>
      </div>`;

    const labels = d.trend.map((t) => G.month(t.month));
    G.chart(out.querySelector('#oc1'), { type: 'bar', data: { labels, datasets: [
      { label: 'Credit issued', data: d.trend.map((t) => t.credit), backgroundColor: G.series(1) },
      { label: 'Collected', data: d.trend.map((t) => t.collected), backgroundColor: G.series(0) },
      { label: 'Interest', data: d.trend.map((t) => t.interest), backgroundColor: G.series(6) },
    ] } });
    G.chart(out.querySelector('#oc2'), { type: 'line', data: { labels, datasets: [{ label: 'Outstanding', data: d.trend.map((t) => t.outstanding), borderColor: G.series(0), fill: true, backgroundColor: (c) => G.areaFill(c, G.series(0)) }] } });
    G.chart(out.querySelector('#oc3'), { type: 'bar', data: { labels: d.aging_buckets.map((b) => b.label), datasets: [{ label: 'Outstanding', data: d.aging_buckets.map((b) => d.aging[b.key]), backgroundColor: G.AGING_COLORS }] } });

    G.table(out.querySelector('#oArea'), { rows: d.area_performance, search: false, csv: 'owner-area-performance', columns: [
      { key: 'name', label: 'Area', render: (r) => `<b>${G.esc(r.name)}</b>` },
      { key: 'credit', label: 'Credit', align: 'right', fmt: 'money', sum: true }, { key: 'collected', label: 'Collected', align: 'right', fmt: 'money', sum: true },
      { key: 'interest', label: 'Interest', align: 'right', fmt: 'money', sum: true }, { key: 'balance', label: 'Outstanding', align: 'right', fmt: 'money', sum: true },
      { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
      { key: 'rate', label: 'Collect / credit', align: 'right', value: (r) => (r.credit ? (r.collected / r.credit) * 100 : 0), render: (r) => (r.credit ? `${((r.collected / r.credit) * 100).toFixed(0)}%` : '—') },
    ] });
    G.table(out.querySelector('#oRisk'), { rows: d.risk, search: false, csv: 'owner-risk-list', sortKey: 'score', onRow: (r) => (location.hash = `#/customers/${r.id}`), columns: [
      { key: 'score', label: 'Risk', render: (r) => `<span class="badge ${r.score >= 70 ? 'critical' : r.score >= 45 ? 'serious' : r.score >= 25 ? 'warning' : 'good'}">${r.score}</span>` },
      { key: 'name', label: 'Customer', cls: 'wrap', render: (r) => `<b>${G.esc(r.name)}</b> <span class="muted">${G.esc(r.code)}</span>` },
      { key: 'area', label: 'Area' }, { key: 'phone', label: 'Phone' },
      { key: 'days_overdue', label: 'Days late', align: 'right', fmt: 'int' },
      { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true }, { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
      { key: 'utilization', label: 'Limit used', render: (r) => G.utilBar(r.utilization) },
      { key: 'last_payment', label: 'Last paid', fmt: 'date' },
    ] });
    G.table(out.querySelector('#oTop'), { rows: d.top_customers, search: false, onRow: (r) => (location.hash = `#/customers/${r.id}`), columns: [
      { key: 'name', label: 'Customer', cls: 'wrap', render: (r) => `<b>${G.esc(r.name)}</b><div class="muted" style="font-size:12px">${G.esc(r.area || '')}</div>` },
      { key: 'credit', label: 'Credit', align: 'right', fmt: 'money', sum: true }, { key: 'paid', label: 'Paid', align: 'right', fmt: 'money', sum: true }, { key: 'interest', label: 'Interest', align: 'right', fmt: 'money', sum: true },
    ] });
    G.table(out.querySelector('#oStaff'), { rows: d.staff, search: false, columns: [
      { key: 'name', label: 'Staff', render: (r) => `<b>${G.esc(r.name)}</b> <span class="badge">${r.role}</span>` },
      { key: 'credit_count', label: 'Bills', align: 'right', fmt: 'int' }, { key: 'credit_amount', label: 'Credit', align: 'right', fmt: 'money', sum: true },
      { key: 'payment_count', label: 'Receipts', align: 'right', fmt: 'int' }, { key: 'payment_amount', label: 'Collected', align: 'right', fmt: 'money', sum: true },
      { key: 'voided', label: 'Voided', align: 'right', render: (r) => (r.voided ? `<span class="badge critical">${r.voided}</span>` : '0') },
    ] });
    const msgs = {};
    for (const m of d.messages) { msgs[m.channel] = msgs[m.channel] || { channel: m.channel, sent: 0, link: 0, failed: 0 }; msgs[m.channel][m.status] = m.n; }
    G.table(out.querySelector('#oMsg'), { rows: Object.values(msgs), search: false, empty: 'No messages in this period', columns: [
      { key: 'channel', label: 'Channel', render: (r) => `${G.channelIcon(r.channel).replace('<svg', '<svg width="15" height="15" style="vertical-align:-3px"')} ${r.channel.toUpperCase()}` },
      { key: 'sent', label: 'Sent', align: 'right', fmt: 'int', sum: true }, { key: 'link', label: 'WhatsApp links', align: 'right', fmt: 'int', sum: true }, { key: 'failed', label: 'Failed', align: 'right', fmt: 'int', sum: true },
    ] });
    G.table(out.querySelector('#oVoid'), { rows: d.voids, search: false, empty: 'No voided entries — good', columns: [
      { key: 'date', label: 'Date', fmt: 'date' }, { key: 'ref_no', label: 'Ref' }, { key: 'customer_name', label: 'Customer' },
      { key: 'amount', label: 'Amount', align: 'right', fmt: 'money' }, { key: 'void_reason', label: 'Reason', cls: 'wrap' }, { key: 'by_user', label: 'Entered by' },
    ] });
    G.countUp(out);
    G.animateBars(out);
  };

  const audit = async () => {
    const rows = await G.get('/api/owner/audit?' + G.qs(st));
    const out = $('#oOut');
    out.innerHTML = `${G.printHead('Audit trail', `${G.date(st.from)} – ${G.date(st.to)}`)}<div class="card"><div class="card-head"><div><h3>Audit trail</h3><div class="sub">Who did what and when — logins, entries, voids, edits, settings changes</div></div></div><div id="aT"></div></div>`;
    G.table(out.querySelector('#aT'), { rows, csv: 'audit-trail', columns: [
      { key: 'created_at', label: 'When', render: (r) => `<span class="nowrap">${G.dt(r.created_at)}</span>` },
      { key: 'user_name', label: 'User' },
      { key: 'action', label: 'Action', render: (r) => `<span class="badge ${r.action === 'void' || r.action === 'delete' ? 'critical' : r.action === 'login' ? '' : 'info'}">${G.esc(r.action)}</span>` },
      { key: 'entity', label: 'Item' }, { key: 'details', label: 'Details', cls: 'wrap', render: (r) => `<span class="text-2" style="font-size:12.5px">${G.esc(r.details || '')}</span>` },
    ] });
  };

  const load = () => (tab === 'perf' ? perf() : audit()).catch(G.fail);
  $('#oFrom').onchange = (e) => { st.from = e.target.value; load(); };
  $('#oTo').onchange = (e) => { st.to = e.target.value; load(); };
  view.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => {
    const t = G.today();
    st.to = t;
    st.from = { m: G.monthStart(), q: G.addDays(t, -90), y: t.slice(0, 4) + '-01-01', all: '2000-01-01' }[b.dataset.r];
    $('#oFrom').value = st.from; $('#oTo').value = st.to;
    view.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', x === b));
    load();
  }));
  $('#oTabs').onclick = (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    tab = t.dataset.t;
    view.querySelectorAll('#oTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    G.destroyCharts();
    load();
  };
  await perf();
};

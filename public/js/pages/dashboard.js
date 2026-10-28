// Dashboard: live KPIs, trends, aging, area & credit-type breakdowns, due list, activity.
G.pages.dashboard = async (view) => {
  const d = await G.get('/api/dashboard');
  const k = d.kpis;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  G.head('Dashboard', `${G.business.name} · ${G.date(d.today)}`);
  const utilPct = k.total_limit > 0 ? (k.outstanding / k.total_limit) * 100 : 0;

  view.innerHTML = `
    <div class="hero">
      <h1>${greet}, ${G.esc(G.user.full_name.split(' ')[0])} 👋</h1>
      <p>Here is today's credit position for ${G.esc(G.business.name)}.</p>
      <div class="hero-stats">
        <div><span>Credit given today</span><b data-count="${k.credit_today}">0</b></div>
        <div><span>Collected today</span><b data-count="${k.collected_today}">0</b></div>
        <div><span>Customers overdue</span><b data-count="${k.overdue_customers}" data-fmt="int">0</b></div>
        <div><span>Due in next 7 days</span><b data-count="${d.upcoming.length}" data-fmt="int">0</b></div>
      </div>
    </div>

    <div class="kpis k3 mt">
      ${G.kpi({ label: 'Total outstanding', value: k.outstanding, icon: 'wallet', accent: 'var(--s1)', foot: `${k.with_balance} customers owe · ${utilPct.toFixed(0)}% of limits used`, href: '#/reports/aging' })}
      ${G.kpi({ label: 'Overdue amount', value: k.overdue, icon: 'alert', accent: 'var(--critical)', foot: `${k.overdue_customers} customers past due`, href: '#/overdue' })}
      ${G.kpi({ label: 'Collected this month', value: k.collected_month, icon: 'cash', accent: 'var(--good)', foot: 'Payments received', href: '#/reports/collections' })}
      ${G.kpi({ label: 'Credit this month', value: k.credit_month, icon: 'receipt', accent: 'var(--s2)', foot: 'New credit sales', href: '#/reports/credit-sales' })}
      ${G.kpi({ label: 'Interest this month', value: k.interest_month, icon: 'percent', accent: 'var(--s7)', foot: `${G.money(k.interest_total)} all time`, href: '#/reports/interest' })}
      ${G.kpi({ label: 'Active customers', value: k.customers, fmt: 'int', icon: 'users', accent: 'var(--s3)', foot: `${k.over_limit} over limit · ${k.blocked} blocked`, href: '#/customers' })}
    </div>

    <div class="grid g-2-1 mt">
      <div class="card">
        <div class="card-head"><div><h3>Credit vs collections</h3><div class="sub">Last 12 months</div></div>
          ${G.legend([['Credit issued', G.series(1)], ['Collected', G.series(0)]])}</div>
        <div class="chart-box tall"><canvas id="cTrend"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Outstanding by age</h3><div class="sub">Days past due date</div></div></div>
        <div class="chart-box tall"><canvas id="cAging"></canvas></div>
      </div>
    </div>

    <div class="grid g3 mt">
      <div class="card">
        <div class="card-head"><div><h3>Outstanding by area</h3><div class="sub">Balance owed per area</div></div><a href="#/reports/area-summary" class="no-print">Area report →</a></div>
        <div class="chart-box"><canvas id="cArea"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>By credit type</h3><div class="sub">Balance owed per type</div></div><a href="#/credit-types">Manage →</a></div>
        <div class="chart-box"><canvas id="cType"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Due in next 7 days</h3><div class="sub">Bills about to fall due</div></div></div>
        <div id="upcoming" style="max-height:290px;overflow-y:auto"></div>
      </div>
    </div>

    <div class="grid g2 mt">
      <div class="card">
        <div class="card-head"><div><h3>Top debtors</h3><div class="sub">Highest balances</div></div><a href="#/customers">All customers →</a></div>
        <div id="debtors"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Recent activity</h3><div class="sub">Latest entries</div></div><a href="#/transactions">All transactions →</a></div>
        <div id="recent"></div>
      </div>
    </div>`;

  // trend
  G.chart(view.querySelector('#cTrend'), {
    type: 'line',
    data: {
      labels: d.trend.map((t) => G.month(t.month)),
      datasets: [
        { label: 'Credit issued', data: d.trend.map((t) => t.credit), borderColor: G.series(1), fill: true, backgroundColor: (c) => G.areaFill(c, G.series(1)) },
        { label: 'Collected', data: d.trend.map((t) => t.collected), borderColor: G.series(0), fill: true, backgroundColor: (c) => G.areaFill(c, G.series(0)) },
      ],
    },
  });
  // aging
  G.chart(view.querySelector('#cAging'), {
    type: 'bar',
    data: { labels: d.aging_buckets.map((b) => b.label), datasets: [{ label: 'Outstanding', data: d.aging_buckets.map((b) => d.aging[b.key]), backgroundColor: G.AGING_COLORS }] },
  });
  // area
  const areas = d.by_area.filter((a) => a.balance > 0).sort((a, b) => b.balance - a.balance);
  G.chart(view.querySelector('#cArea'), {
    type: 'bar',
    data: { labels: areas.map((a) => a.name), datasets: [{ label: 'Outstanding', data: areas.map((a) => a.balance), backgroundColor: G.series(0) }] },
    options: { indexAxis: 'y', onClick: (e, els) => els[0] && (location.hash = `#/customers?area=${areas[els[0].index].id}`) },
  });
  // type
  const types = d.by_type.filter((t) => t.customers > 0);
  G.chart(view.querySelector('#cType'), {
    type: 'bar',
    data: { labels: types.map((t) => t.name), datasets: [{ label: 'Outstanding', data: types.map((t) => t.balance), backgroundColor: types.map((t) => t.color || G.series(0)) }] },
    options: { indexAxis: 'y' },
  });

  view.querySelector('#upcoming').innerHTML = d.upcoming.length ? d.upcoming.map((u) => {
    const days = Math.round((new Date(u.due_date) - new Date(d.today)) / 86400000);
    return `<a class="list-item" href="#/customers/${u.customer_id}" style="color:inherit;text-decoration:none">
      <div class="icon-dot" style="color:var(--warning)">${G.icon('clock')}</div>
      <div class="grow"><div class="title">${G.esc(u.customer_name)}</div><div class="sub">${G.esc(u.ref_no)} · ${days === 0 ? '<b>due today</b>' : `in ${days} day${days > 1 ? 's' : ''}`}</div></div>
      <div class="num" style="font-weight:700">${G.money(u.open)}</div></a>`;
  }).join('') : `<div class="empty">${G.icon('check')}Nothing due this week</div>`;

  const maxBal = Math.max(1, ...d.top_debtors.map((c) => c.balance));
  view.querySelector('#debtors').innerHTML = d.top_debtors.length ? d.top_debtors.map((c) => `
    <a class="list-item" href="#/customers/${c.id}" style="color:inherit;text-decoration:none">
      <div class="avatar" style="width:34px;height:34px;font-size:13px">${G.initials(c.name)}</div>
      <div class="grow"><div class="title">${G.esc(c.name)} ${c.overdue > 0 ? G.riskBadge(c) : ''}</div>
        <div class="bar" style="margin-top:6px"><i data-w="${(c.balance / maxBal) * 100}"></i></div></div>
      <div class="right"><div class="num" style="font-weight:800">${G.money(c.balance)}</div><div class="sub muted" style="font-size:12px">${G.esc(c.area_name || '—')}</div></div></a>`).join('')
    : `<div class="empty">${G.icon('users')}No balances yet</div>`;

  view.querySelector('#recent').innerHTML = d.recent.length ? d.recent.map((t) => {
    const ic = { credit: ['receipt', 'var(--s2)'], payment: ['cash', 'var(--good)'], interest: ['percent', 'var(--critical)'] }[t.type] || ['list', 'var(--s1)'];
    return `<a class="list-item" href="#/customers/${t.customer_id}" style="color:inherit;text-decoration:none">
      <div class="icon-dot" style="color:${ic[1]}">${G.icon(ic[0])}</div>
      <div class="grow"><div class="title">${G.esc(t.customer_name)}</div><div class="sub">${G.TYPE_LABEL[t.type]} · ${G.esc(t.ref_no)} · ${G.date(t.date)}</div></div>
      <div class="num ${G.isDebit(t.type) ? 'amount-pos' : 'amount-neg'}">${G.isDebit(t.type) ? '+' : '−'}${G.money(t.amount)}</div></a>`;
  }).join('') : `<div class="empty">${G.icon('inbox')}No transactions yet — add a credit sale to begin</div>`;
};

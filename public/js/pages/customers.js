// Customers: list (table / grouped by area), add/edit form, full customer profile.
G.pages.customers = async (view, query) => {
  const p = new URLSearchParams(query || '');
  const st = { filter: p.get('filter') || '', area_id: p.get('area') || '', credit_type_id: p.get('type') || '', status: '', mode: (() => { try { return localStorage.getItem('gms-cust-mode') || 'list'; } catch (e) { return 'list'; } })() };
  G.head('Customers', 'Credit customers, limits and balances');
  await G.loadLookups();

  view.innerHTML = `
    <div class="row between mb">
      <div class="chips" id="chips">
        ${[['', 'All'], ['with_balance', 'With balance'], ['overdue', 'Overdue'], ['over_limit', 'Over limit'], ['clear', 'Fully paid']]
          .map(([k, l]) => `<button class="chip ${st.filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}
      </div>
      <div class="row">
        <div class="tabs" id="modeTabs"><button class="tab" data-m="list">${G.icon('list').replace('<svg', '<svg width="15" height="15" style="vertical-align:-3px"')} List</button><button class="tab" data-m="area">${G.icon('map').replace('<svg', '<svg width="15" height="15" style="vertical-align:-3px"')} By area</button></div>
        <button class="btn primary" id="addCust">${G.icon('plus')} Add customer</button>
      </div>
    </div>
    <div class="card">
      <div class="filters mb">
        <div class="field"><label>Area</label><select id="fArea">${G.areaOptions(st.area_id)}</select></div>
        <div class="field"><label>Credit type</label><select id="fType">${G.typeOptions(st.credit_type_id)}</select></div>
        <div class="field"><label>Status</label><select id="fStatus"><option value="">Any status</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="inactive">Inactive</option></select></div>
      </div>
      <div id="custBody"></div>
    </div>`;

  const body = view.querySelector('#custBody');
  async function load() {
    view.querySelectorAll('#modeTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.m === st.mode));
    const rows = await G.get('/api/customers?' + G.qs({ filter: st.filter, area_id: st.area_id, credit_type_id: st.credit_type_id, status: st.status }));
    if (st.mode === 'area') return drawByArea(rows);
    G.table(body, {
      rows, csv: 'customers', onRow: (c) => (location.hash = `#/customers/${c.id}`), sortKey: 'balance',
      columns: [
        { key: 'code', label: 'Code', render: (c) => `<span class="muted nowrap">${G.esc(c.code)}</span>` },
        { key: 'name', label: 'Customer', cls: 'wrap', render: (c) => `<b>${G.esc(c.name)}</b>${c.business_name ? `<div class="muted" style="font-size:12px">${G.esc(c.business_name)}</div>` : ''}`, csv: (c) => c.name },
        { key: 'area_name', label: 'Area' },
        { key: 'type_name', label: 'Credit type', render: (c) => c.type_name ? `<span class="badge"><span class="dot" style="color:${c.type_color}"></span>${G.esc(c.type_name)}</span>` : '—', csv: (c) => c.type_name || '' },
        { key: 'phone', label: 'Phone', render: (c) => `<span class="nowrap">${G.esc(c.phone || '—')}</span>` },
        { key: 'credit_limit', label: 'Limit', align: 'right', fmt: 'money' },
        { key: 'credit_period_days', label: 'Period', align: 'right', render: (c) => `${c.credit_period_days}d` },
        { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true, render: (c) => `<b class="num">${G.n2(c.balance)}</b>` },
        { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true, render: (c) => c.overdue > 0 ? `<b class="num type-interest">${G.n2(c.overdue)}</b>` : '<span class="muted">—</span>' },
        { key: 'utilization', label: 'Limit used', render: (c) => G.utilBar(c.utilization), csv: (c) => c.utilization ?? '' },
        { key: 'days_overdue', label: 'Status', render: (c) => c.status !== 'active' ? G.statusBadge(c.status) : G.riskBadge(c), csv: (c) => c.status },
        { key: 'act', label: '', sort: false, export: false, render: (c) => `<div class="row" style="flex-wrap:nowrap;gap:6px"><button class="btn xs" data-credit="${c.id}">+ Credit</button><button class="btn xs success" data-pay="${c.id}">Pay</button></div>` },
      ],
    });
  }

  function drawByArea(rows) {
    const groups = {};
    for (const c of rows) (groups[c.area_name || 'Unassigned'] = groups[c.area_name || 'Unassigned'] || []).push(c);
    const names = Object.keys(groups).sort();
    body.innerHTML = names.length ? `<div class="grid g3">${names.map((n, i) => {
      const cs = groups[n].sort((a, b) => b.balance - a.balance);
      const bal = cs.reduce((s, c) => s + c.balance, 0), od = cs.reduce((s, c) => s + c.overdue, 0);
      const area = (G.areas || []).find((a) => a.name === n);
      return `<div class="card" style="padding:16px;animation:rise .5s ${i * 0.05}s both var(--ease)">
        <div class="card-head" style="margin-bottom:8px"><div><h3>${G.icon('pin').replace('<svg', '<svg width="16" height="16" style="vertical-align:-2px;color:var(--brand)"')} ${G.esc(n)}</h3>
          <div class="sub">${cs.length} customers${area?.collector ? ' · collector ' + G.esc(area.collector) : ''}${area?.visit_day ? ' · visits ' + G.esc(area.visit_day) : ''}</div></div></div>
        <div class="stat-list" style="grid-template-columns:1fr 1fr"><div class="stat"><span>Outstanding</span><b>${G.money(bal)}</b></div><div class="stat"><span>Overdue</span><b class="${od > 0 ? 'type-interest' : ''}">${G.money(od)}</b></div></div>
        <div class="mt-s" style="max-height:260px;overflow-y:auto">${cs.map((c) => `<a class="list-item" href="#/customers/${c.id}" style="color:inherit;text-decoration:none">
          <div class="grow"><div class="title">${G.esc(c.name)}</div><div class="sub">${G.esc(c.code)} · ${G.esc(c.phone || '')}</div></div>
          <div class="right"><div class="num" style="font-weight:700">${G.n2(c.balance)}</div>${c.overdue > 0 ? G.riskBadge(c) : ''}</div></a>`).join('')}</div></div>`;
    }).join('')}</div>` : `<div class="empty">${G.icon('users')}No customers match</div>`;
  }

  view.querySelector('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    st.filter = b.dataset.f;
    view.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('active', c === b));
    load();
  };
  view.querySelector('#modeTabs').onclick = (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    st.mode = t.dataset.m;
    try { localStorage.setItem('gms-cust-mode', st.mode); } catch (err) { /* ignore */ }
    load();
  };
  view.querySelector('#fArea').onchange = (e) => { st.area_id = e.target.value; load(); };
  view.querySelector('#fType').onchange = (e) => { st.credit_type_id = e.target.value; load(); };
  view.querySelector('#fStatus').onchange = (e) => { st.status = e.target.value; load(); };
  view.querySelector('#addCust').onclick = () => G.customerForm(null, (id) => (location.hash = `#/customers/${id}`));
  body.addEventListener('click', (e) => {
    const c = e.target.closest('[data-credit]'), p2 = e.target.closest('[data-pay]');
    if (c) G.entryModal('credit', +c.dataset.credit, load);
    if (p2) G.entryModal('payment', +p2.dataset.pay, load);
  });
  await load();
};

// ---------- add / edit customer ----------
G.customerForm = async (customer, onSaved) => {
  await G.loadLookups();
  const c = customer || { status: 'active', interest_enabled: 1, preferred_channel: 'sms' };
  const isNew = !customer;
  const v = (k) => G.esc(c[k] ?? '');
  G.modal({
    title: isNew ? 'New credit customer' : `Edit ${G.esc(c.name)}`, size: 'wide',
    body: `<form id="custForm" class="form-grid three" autocomplete="off">
      <div class="section-title">Customer details</div>
      <div class="field"><label>Full name *</label><input name="name" value="${v('name')}" required></div>
      <div class="field"><label>Business / shop name</label><input name="business_name" value="${v('business_name')}"></div>
      <div class="field"><label>Customer code</label><input name="code" value="${v('code')}" placeholder="Auto (GMS-0001)"></div>
      <div class="field"><label>Mobile (SMS)</label><input name="phone" value="${v('phone')}" placeholder="0771234567"></div>
      <div class="field"><label>WhatsApp number</label><input name="whatsapp" value="${v('whatsapp')}" placeholder="Same as mobile if empty"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${v('email')}"></div>
      <div class="field"><label>NIC / ID</label><input name="nic" value="${v('nic')}"></div>
      <div class="field" style="grid-column:span 2"><label>Address</label><input name="address" value="${v('address')}"></div>

      <div class="section-title">Area & credit terms</div>
      <div class="field"><label>Area *</label><div class="row" style="flex-wrap:nowrap"><select name="area_id" required>${G.areaOptions(c.area_id, '— Select area —')}</select><button type="button" class="btn sm" id="newArea" title="Add area">${G.icon('plus')}</button></div></div>
      <div class="field"><label>Credit type</label><select name="credit_type_id" id="ctSel">${G.typeOptions(c.credit_type_id, '— None —')}</select><div class="help" id="ctHelp"></div></div>
      <div class="field"><label>Status</label><select name="status">${['active', 'blocked', 'inactive'].map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
      <div class="field"><label>Credit limit (${G.business.currency})</label><input name="credit_limit" type="number" min="0" step="0.01" value="${c.credit_limit ?? ''}" placeholder="From credit type"><div class="help">0 = no limit</div></div>
      <div class="field"><label>Credit period (days)</label><input name="credit_period_days" type="number" min="0" value="${c.credit_period_days ?? ''}" placeholder="From credit type"><div class="help">Interest starts after this</div></div>
      <div class="field"><label>Preferred message channel</label><select name="preferred_channel">${['sms', 'whatsapp', 'email'].map((s) => `<option value="${s}" ${c.preferred_channel === s ? 'selected' : ''}>${{ sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }[s]}</option>`).join('')}</select></div>
      <div class="field full"><label class="check"><input type="checkbox" name="interest_enabled" ${c.interest_enabled ? 'checked' : ''}> Charge overdue interest for this customer</label></div>
      ${isNew ? `<div class="section-title">Opening balance (optional)</div>
      <div class="field"><label>Existing balance owed</label><input name="opening_balance" type="number" min="0" step="0.01" placeholder="0.00"></div>
      <div class="field"><label>Balance date</label><input name="opening_date" type="date" value="${G.today()}"></div>
      <div class="field"><label>Due date</label><input name="opening_due_date" type="date"><div class="help">Empty = date + credit period</div></div>` : ''}
      <div class="field full"><label>Notes</label><textarea name="notes" rows="2" style="min-height:60px">${v('notes')}</textarea></div>
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="saveCust">${G.icon('check')} ${isNew ? 'Create customer' : 'Save changes'}</button>`,
    onMount: (m) => {
      const f = m.el.querySelector('#custForm');
      const ctSel = f.querySelector('#ctSel');
      const showCt = (fill) => {
        const t = G.creditTypes.find((x) => String(x.id) === ctSel.value);
        m.el.querySelector('#ctHelp').textContent = t ? `Default: ${G.money(t.default_limit)} · ${t.default_period_days} days${t.interest_rate != null ? ` · ${t.interest_rate}% interest` : ''}` : '';
        if (t && fill) { f.credit_limit.value = t.default_limit; f.credit_period_days.value = t.default_period_days; }
      };
      ctSel.onchange = () => showCt(true);
      showCt(isNew && !f.credit_limit.value);
      m.el.querySelector('#newArea').onclick = async () => {
        const name = await G.confirm('Create a new area', { title: 'New area', ok: 'Add area', input: 'Area name' });
        if (!name) return;
        try {
          const r = await G.post('/api/areas', { name });
          await G.loadLookups();
          f.area_id.innerHTML = G.areaOptions(r.id, '— Select area —');
        } catch (e) { G.fail(e); }
      };
      m.el.querySelector('#saveCust').onclick = (e) => {
        if (!f.reportValidity()) return;
        G.busy(e.currentTarget, async () => {
          try {
            const data = G.formData(f);
            const r = isNew ? await G.post('/api/customers', data) : await G.put(`/api/customers/${c.id}`, data);
            G.toast(isNew ? `Customer ${r.code} created` : 'Customer updated');
            m.close();
            G.refreshBadges();
            onSaved && onSaved(isNew ? r.id : c.id);
          } catch (err) { G.fail(err); }
        });
      };
    },
  });
};

// ---------- customer profile ----------
G.pages.customer = async (view, id) => {
  const c = await G.get(`/api/customers/${id}`);
  G.head(c.name, `${c.code} · ${c.area_name || 'No area'}`);
  const u = c.utilization ?? 0;
  const R = 56, CIRC = 2 * Math.PI * R;
  const ringColor = u > 100 ? 'var(--critical)' : u > 80 ? 'var(--warning)' : 'var(--s1)';
  const agingTotal = Object.values(c.aging).reduce((s, x) => s + x, 0) || 1;
  const bucketLabels = { current: 'Not due', d1_30: '1–30', d31_60: '31–60', d61_90: '61–90', d90p: '90+' };

  view.innerHTML = `
    <div class="card">
      <div class="profile-head">
        <div class="avatar">${G.initials(c.name)}</div>
        <div style="flex:1;min-width:240px">
          <div class="row"><h2>${G.esc(c.name)}</h2>${G.statusBadge(c.status)} ${G.riskBadge(c)} ${c.over_limit ? '<span class="badge critical">Over limit</span>' : ''}</div>
          ${c.business_name ? `<div class="text-2" style="font-weight:600">${G.esc(c.business_name)}</div>` : ''}
          <div class="meta">
            <span>${G.icon('tag')}${G.esc(c.code)}</span>
            <span>${G.icon('pin')}${G.esc(c.area_name || 'No area')}</span>
            ${c.type_name ? `<span>${G.icon('layers')}${G.esc(c.type_name)}</span>` : ''}
            ${c.phone ? `<span>${G.icon('phone')}${G.esc(c.phone)}</span>` : ''}
            ${c.email ? `<span>${G.icon('mail')}${G.esc(c.email)}</span>` : ''}
            <span>${G.channelIcon(c.preferred_channel)}Prefers ${c.preferred_channel}</span>
          </div>
          ${c.address ? `<div class="muted" style="font-size:13px;margin-top:4px">${G.esc(c.address)}${c.nic ? ' · NIC ' + G.esc(c.nic) : ''}</div>` : ''}
        </div>
        <div class="ring" title="Credit limit used">
          <svg width="132" height="132"><circle cx="66" cy="66" r="${R}" stroke="var(--border)" stroke-width="12" fill="none"/>
            <circle class="prog" cx="66" cy="66" r="${R}" stroke="${ringColor}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" data-off="${CIRC * (1 - Math.min(100, u) / 100)}"/></svg>
          <div class="ring-label"><div>${c.utilization == null ? '∞' : Math.round(u) + '%'}<small>limit used</small></div></div>
        </div>
      </div>
      <div class="row mt no-print">
        <button class="btn primary" id="bCredit">${G.icon('receipt')} Credit sale</button>
        <button class="btn success" id="bPay">${G.icon('cash')} Receive payment</button>
        <button class="btn" id="bMsg">${G.icon('send')} Message</button>
        <a class="btn" href="#/reports/statement/${c.id}">${G.icon('book')} Statement</a>
        <span class="spacer"></span>
        ${G.can('manager') ? `<button class="btn ghost" id="bAdj">${G.icon('edit')} Adjustment</button><button class="btn ghost" id="bEdit">${G.icon('settings')} Edit</button>
          <button class="btn ghost" id="bBlock">${G.icon('ban')} ${c.status === 'blocked' ? 'Unblock' : 'Block'}</button>` : ''}
        ${G.can('owner') ? `<button class="btn ghost" id="bDel" title="Delete customer">${G.icon('trash')}</button>` : ''}
      </div>
    </div>

    <div class="kpis mt">
      ${G.kpi({ label: 'Balance owed', value: c.balance, icon: 'wallet', accent: 'var(--s1)', foot: `Limit ${G.money(c.credit_limit)}` })}
      ${G.kpi({ label: 'Overdue', value: c.overdue, icon: 'alert', accent: 'var(--critical)', foot: c.days_overdue ? `Oldest ${c.days_overdue} days late` : 'Nothing overdue' })}
      ${G.kpi({ label: 'Available credit', value: Math.max(0, c.available), icon: 'zap', accent: 'var(--good)', foot: c.credit_limit > 0 ? (c.available < 0 ? `Exceeded by ${G.money(-c.available)}` : 'Can still take') : 'No limit set' })}
      ${G.kpi({ label: 'Interest charged', value: c.total_interest, icon: 'percent', accent: 'var(--s7)', foot: `${c.interest_enabled ? 'Interest on' : 'Interest OFF'} · ${c.credit_period_days}-day period` })}
    </div>

    <div class="grid g-2-1 mt">
      <div class="card">
        <div class="card-head"><div class="tabs" id="cTabs">
          <button class="tab active" data-t="ledger">Ledger</button><button class="tab" data-t="open">Open bills (${c.open_bills.length})</button><button class="tab" data-t="msgs">Messages (${c.messages.length})</button>
        </div></div>
        <div id="tabBody"></div>
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>Debt age</h3></div>
          ${Object.entries(c.aging).map(([k, v], i) => `<div class="row" style="margin:8px 0;flex-wrap:nowrap"><span style="width:62px;font-size:12.5px;font-weight:700" class="text-2">${bucketLabels[k]}</span>
            <div class="bar" style="flex:1"><i data-w="${(v / agingTotal) * 100}" style="background:${G.AGING_COLORS[i]}"></i></div><span class="num" style="min-width:96px;text-align:right;font-size:13px">${G.n2(v)}</span></div>`).join('')}
        </div>
        <div class="card mt">
          <div class="card-head"><div><h3>Monthly activity</h3><div class="sub">Last 12 months</div></div>${G.legend([['Credit', G.series(1)], ['Paid', G.series(0)]])}</div>
          <div class="chart-box short"><canvas id="cMonthly"></canvas></div>
        </div>
        ${c.notes ? `<div class="card mt"><div class="card-head"><h3>Notes</h3></div><div class="text-2" style="white-space:pre-wrap">${G.esc(c.notes)}</div></div>` : ''}
      </div>
    </div>`;

  requestAnimationFrame(() => setTimeout(() => { const pr = view.querySelector('.ring .prog'); if (pr) pr.style.strokeDashoffset = pr.dataset.off; }, 60));
  G.chart(view.querySelector('#cMonthly'), {
    type: 'bar',
    data: { labels: c.monthly.map((m) => G.month(m.month)), datasets: [
      { label: 'Credit', data: c.monthly.map((m) => m.credit), backgroundColor: G.series(1) },
      { label: 'Paid', data: c.monthly.map((m) => m.paid), backgroundColor: G.series(0) },
    ] },
  });

  const reload = () => G.reload();
  const tabBody = view.querySelector('#tabBody');
  const tabs = {
    ledger: () => {
      // running balance oldest → newest
      const asc = [...c.transactions].reverse();
      let run = 0;
      for (const t of asc) { if (!t.voided) run += G.isDebit(t.type) ? t.amount : -t.amount; t.running = run; }
      G.table(tabBody, {
        rows: c.transactions, csv: `ledger-${c.code}`, search: true,
        columns: [
          { key: 'date', label: 'Date', fmt: 'date' },
          { key: 'ref_no', label: 'Ref', render: (t) => `<b>${G.esc(t.ref_no)}</b>` },
          { key: 'type', label: 'Type', render: (t) => G.typeBadge(t.type) },
          { key: 'description', label: 'Details', cls: 'wrap', render: (t) => `<span class="text-2" style="font-size:12.5px">${G.esc(t.description || '')}${t.payment_method ? ` · ${G.esc(t.payment_method)}` : ''}${t.cheque_no ? ` #${G.esc(t.cheque_no)}` : ''}${t.voided ? ` · VOID: ${G.esc(t.void_reason)}` : ''}</span>` },
          { key: 'due_date', label: 'Due', render: (t) => G.isDebit(t.type) && t.type !== 'interest' ? G.date(t.due_date) : '' },
          { key: 'debit', label: 'Debit', align: 'right', value: (t) => (G.isDebit(t.type) ? t.amount : 0), render: (t) => (G.isDebit(t.type) ? `<span class="num">${G.n2(t.amount)}</span>` : '') },
          { key: 'credit', label: 'Credit', align: 'right', value: (t) => (!G.isDebit(t.type) ? t.amount : 0), render: (t) => (!G.isDebit(t.type) ? `<span class="num amount-neg">${G.n2(t.amount)}</span>` : '') },
          { key: 'running', label: 'Balance', align: 'right', fmt: 'money' },
          { key: 'act', label: '', sort: false, export: false, render: (t) => (G.can('manager') && !t.voided ? `<button class="btn xs ghost" data-void="${t.id}" title="Void">${G.icon('x').replace('<svg', '<svg width="14" height="14"')}</button>` : '') },
        ],
      });
    },
    open: () => G.table(tabBody, {
      rows: c.open_bills, search: false, sortKey: 'days_overdue',
      columns: [
        { key: 'ref_no', label: 'Bill', render: (b) => `<b>${G.esc(b.ref_no)}</b>` },
        { key: 'type', label: 'Type', render: (b) => G.typeBadge(b.type) },
        { key: 'date', label: 'Date', fmt: 'date' },
        { key: 'due_date', label: 'Due', fmt: 'date' },
        { key: 'days_overdue', label: 'Late', align: 'right', render: (b) => (b.days_overdue > 0 ? `<span class="badge ${b.days_overdue > 90 ? 'critical' : b.days_overdue > 30 ? 'serious' : 'warning'}">${b.days_overdue} days</span>` : '<span class="badge good">Not due</span>') },
        { key: 'amount', label: 'Amount', align: 'right', fmt: 'money', sum: true },
        { key: 'open', label: 'Unpaid', align: 'right', fmt: 'money', sum: true },
      ],
    }),
    msgs: () => {
      tabBody.innerHTML = c.messages.length ? c.messages.map((m) => `<div class="list-item"><div class="icon-dot">${G.channelIcon(m.channel)}</div>
        <div class="grow"><div style="white-space:pre-wrap;font-size:13.5px">${G.esc(m.body)}</div><div class="sub">${G.dt(m.created_at)} · ${m.kind} · ${G.esc(m.recipient || '')}${m.error ? ` · <span class="type-interest">${G.esc(m.error)}</span>` : ''}</div></div>
        <div>${G.msgStatus(m.status)}${m.link ? `<div class="mt-s"><a class="btn xs" target="_blank" rel="noopener" href="${G.esc(m.link)}">Open WhatsApp</a></div>` : ''}</div></div>`).join('')
        : `<div class="empty">${G.icon('message')}No messages sent to this customer yet</div>`;
    },
  };
  tabs.ledger();
  view.querySelector('#cTabs').onclick = (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    view.querySelectorAll('#cTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    tabs[t.dataset.t]();
  };
  tabBody.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-void]');
    if (!b) return;
    const reason = await G.confirm('Void this entry? Balances and allocations will be recalculated. Interest charged on a voided bill is voided too.', { title: 'Void entry', ok: 'Void entry', danger: true, input: 'Reason' });
    if (reason === false) return;
    try { await G.post(`/api/transactions/${b.dataset.void}/void`, { reason }); G.toast('Entry voided'); reload(); } catch (err) { G.fail(err); }
  });

  view.querySelector('#bCredit').onclick = () => G.entryModal('credit', c.id, reload);
  view.querySelector('#bPay').onclick = () => G.entryModal('payment', c.id, reload);
  view.querySelector('#bMsg').onclick = () => G.composeModal({ customer_ids: [c.id], label: c.name, template: c.overdue > 0 ? 'overdue_notice' : 'statement', channel: c.preferred_channel });
  const q = (s) => view.querySelector(s);
  if (q('#bAdj')) q('#bAdj').onclick = () => G.entryModal('debit_adj', c.id, reload);
  if (q('#bEdit')) q('#bEdit').onclick = () => G.customerForm(c, reload);
  if (q('#bBlock')) q('#bBlock').onclick = async () => {
    const block = c.status !== 'blocked';
    if (!(await G.confirm(block ? `Block <b>${G.esc(c.name)}</b> from taking new credit?` : `Allow <b>${G.esc(c.name)}</b> to take credit again?`, { ok: block ? 'Block' : 'Unblock', danger: block }))) return;
    try { await G.put(`/api/customers/${c.id}`, { ...c, status: block ? 'blocked' : 'active' }); G.toast(block ? 'Customer blocked' : 'Customer unblocked'); reload(); } catch (e) { G.fail(e); }
  };
  if (q('#bDel')) q('#bDel').onclick = async () => {
    if (!(await G.confirm(`Permanently delete <b>${G.esc(c.name)}</b> and all their history? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
    try { await G.del(`/api/customers/${c.id}`); G.toast('Customer deleted'); location.hash = '#/customers'; } catch (e) { G.fail(e); }
  };
};

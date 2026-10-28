// Credit sales, payments & adjustments entry; transactions journal; overdue follow-up.
const PAY_METHODS = ['Cash', 'Cheque', 'Bank transfer', 'Card', 'Online / mobile'];

// Customer autocomplete used in entry forms. Calls onPick(customer).
G.customerPicker = (wrap, onPick) => {
  wrap.innerHTML = `<div class="top-search" style="width:100%;margin:0;display:block"><input placeholder="Type name, code or phone…" class="cp-in" autocomplete="off"><div class="search-results cp-res"></div></div>`;
  const inp = wrap.querySelector('.cp-in'), res = wrap.querySelector('.cp-res');
  let timer, list = [];
  const search = async () => {
    list = (await G.get('/api/customers?' + G.qs({ q: inp.value.trim(), status: '' }))).filter((c) => c.status !== 'inactive').slice(0, 10);
    res.innerHTML = list.length ? list.map((c, i) => `<a href="javascript:void 0" data-i="${i}"><span><b>${G.esc(c.name)}</b> <span class="muted">${G.esc(c.code)} · ${G.esc(c.area_name || '')}</span></span><span class="num">${G.money(c.balance)}</span></a>`).join('') : '<div class="empty" style="padding:14px">No match</div>';
    res.classList.add('open');
  };
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 160); });
  inp.addEventListener('focus', search);
  res.addEventListener('mousedown', (e) => {
    const a = e.target.closest('a[data-i]');
    if (!a) return;
    e.preventDefault();
    const c = list[+a.dataset.i];
    inp.value = `${c.name} (${c.code})`;
    res.classList.remove('open');
    onPick(c);
  });
  inp.addEventListener('blur', () => setTimeout(() => res.classList.remove('open'), 150));
};

const ENTRY_TITLES = { credit: 'New credit sale', payment: 'Receive payment', debit_adj: 'Account adjustment', credit_adj: 'Account adjustment' };

G.entryModal = async (type, customerId, onDone) => {
  let customer = null;
  const isAdj = type === 'debit_adj' || type === 'credit_adj';
  const m = G.modal({
    title: `${G.icon(type === 'payment' ? 'cash' : type === 'credit' ? 'receipt' : 'edit').replace('<svg', '<svg width="20" height="20" style="vertical-align:-3px;color:var(--brand)"')} ${ENTRY_TITLES[type]}`,
    body: `<form id="entryForm" class="form-grid" autocomplete="off">
      <div class="field full"><label>Customer *</label><div id="picker"></div></div>
      <div class="field full" id="custInfo"></div>
      ${isAdj ? `<div class="field full"><label>Adjustment type</label><select name="type"><option value="debit_adj" ${type === 'debit_adj' ? 'selected' : ''}>Debit — increase what the customer owes</option><option value="credit_adj">Credit — reduce what the customer owes (discount / write-off / return)</option><option value="opening">Opening balance — previous debt brought forward</option></select></div>` : `<input type="hidden" name="type" value="${type}">`}
      <div class="field"><label>Amount (${G.business.currency}) *</label><input name="amount" type="number" min="0.01" step="0.01" required style="font-size:20px;font-weight:800"></div>
      <div class="field"><label>Date</label><input name="date" type="date" value="${G.today()}" required></div>
      ${type === 'credit' ? `<div class="field"><label>Bill / invoice no.</label><input name="ref_no" placeholder="Auto (INV-00001)"></div>
        <div class="field"><label>Due date</label><input name="due_date" type="date"><div class="help" id="dueHelp">Date + customer's credit period</div></div>
        <div class="field full"><label>Items / description</label><textarea name="description" rows="2" style="min-height:64px" placeholder="e.g. 50 bags cement, 20 PVC pipes"></textarea></div>` : ''}
      ${type === 'payment' ? `<div class="field"><label>Payment method</label><select name="payment_method">${PAY_METHODS.map((p) => `<option>${p}</option>`).join('')}</select></div>
        <div class="field"><label>Cheque / reference no.</label><input name="cheque_no"></div>
        <div class="field full"><label>Note</label><input name="description" placeholder="Optional"></div>` : ''}
      ${isAdj ? `<div class="field"><label>Due date (debits)</label><input name="due_date" type="date"></div><div class="field full"><label>Reason *</label><input name="description" required></div>` : ''}
      ${!isAdj ? `<div class="field full"><label class="check"><input type="checkbox" name="notify" checked> Send ${type === 'payment' ? 'payment receipt' : 'bill notification'} to customer (if enabled in settings)</label></div>` : ''}
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn ${type === 'payment' ? 'success' : 'primary'}" id="saveEntry">${G.icon('check')} Save</button>`,
    onMount: (mm) => {
      const f = mm.el.querySelector('#entryForm');
      const info = mm.el.querySelector('#custInfo');
      const pick = (c) => {
        customer = c;
        const avail = c.credit_limit > 0 ? c.credit_limit - c.balance : null;
        info.innerHTML = `<div class="stat-list" style="animation:rise .4s var(--ease)">
          <div class="stat"><span>Balance</span><b>${G.money(c.balance)}</b></div>
          <div class="stat"><span>Overdue</span><b class="${c.overdue > 0 ? 'type-interest' : ''}">${G.money(c.overdue)}</b></div>
          <div class="stat"><span>Limit</span><b>${c.credit_limit > 0 ? G.money(c.credit_limit) : 'No limit'}</b></div>
          <div class="stat"><span>Available</span><b class="${avail != null && avail < 0 ? 'type-interest' : ''}">${avail == null ? '∞' : G.money(avail)}</b></div></div>
          ${c.status === 'blocked' ? '<div class="badge critical mt-s">This customer is BLOCKED from credit</div>' : ''}
          ${c.overdue > 0 ? `<div class="mt-s">${G.riskBadge(c)}</div>` : ''}`;
        if (type === 'payment' && c.balance > 0 && !f.amount.value) f.amount.placeholder = `Full: ${G.n2(c.balance)}`;
        updateDue();
      };
      const updateDue = () => {
        if (type !== 'credit' || !customer) return;
        mm.el.querySelector('#dueHelp').textContent = `${customer.credit_period_days}-day credit period → ${G.date(G.addDays(f.date.value || G.today(), customer.credit_period_days))}`;
        f.due_date.value = G.addDays(f.date.value || G.today(), customer.credit_period_days);
      };
      if (f.date) f.date.addEventListener('change', updateDue);
      G.customerPicker(mm.el.querySelector('#picker'), pick);
      if (customerId) G.get(`/api/customers/${customerId}`).then((c) => { mm.el.querySelector('.cp-in').value = `${c.name} (${c.code})`; pick(c); });

      const save = async (override) => {
        if (!customer) return G.toast('Select a customer first', 'warn');
        if (!f.reportValidity()) return;
        const data = { ...G.formData(f), customer_id: customer.id, override };
        try {
          const r = await G.post('/api/transactions', data);
          mm.close();
          G.refreshBadges();
          entryDone(r, customer, data.type);
          onDone ? onDone() : G.reload();
        } catch (e) {
          if (e.status === 409 && e.data?.warnings) {
            const ok = e.data.can_override && (await G.confirm(`<b>Credit warning for ${G.esc(customer.name)}</b><ul>${e.data.warnings.map((w) => `<li>${G.esc(w)}</li>`).join('')}</ul>${e.data.can_override ? 'Approve this credit anyway?' : ''}`, { title: 'Credit check', ok: 'Approve anyway', danger: true }));
            if (!e.data.can_override) G.toast('Credit blocked: ' + e.data.warnings.join('; ') + '. Ask a manager to approve.', 'error', 7000);
            if (ok) save(true);
          } else G.fail(e);
        }
      };
      mm.el.querySelector('#saveEntry').onclick = (e) => G.busy(e.currentTarget, () => save(false));
    },
  });
  return m;
};

function entryDone(r, customer, type) {
  const t = r.transaction;
  const msg = r.message;
  G.toast(`${G.TYPE_LABEL[t.type]} ${t.ref_no} saved · new balance ${G.money(r.balance.balance)}`);
  if (msg && msg.status === 'failed') G.toast(`Message not sent: ${msg.error}`, 'warn', 6000);
  if (type !== 'payment' && !(msg && msg.link)) return;
  G.modal({
    title: `${G.icon('check').replace('<svg', '<svg width="22" height="22" style="vertical-align:-4px;color:var(--good)"')} ${type === 'payment' ? 'Payment received' : 'Saved'}`, size: 'narrow',
    body: `<div style="text-align:center"><div class="muted">${G.esc(customer.name)} · ${G.esc(t.ref_no)}</div>
      <div style="font-size:34px;font-weight:800;margin:8px 0" class="num">${G.money(t.amount)}</div>
      <div class="text-2">Remaining balance <b>${G.money(r.balance.balance)}</b></div>
      ${msg && msg.status === 'sent' ? `<div class="badge good mt-s">${msg.channel.toUpperCase()} sent to ${G.esc(msg.recipient)}</div>` : ''}</div>`,
    foot: `${msg && msg.link ? `<a class="btn success" target="_blank" rel="noopener" href="${G.esc(msg.link)}">${G.icon('whatsapp')} Send on WhatsApp</a>` : ''}
      ${type === 'payment' ? `<button class="btn" id="printRcpt">${G.icon('printer')} Print receipt</button>` : ''}<button class="btn primary" data-close>Done</button>`,
    onMount: (m) => {
      const pr = m.el.querySelector('#printRcpt');
      if (pr) pr.onclick = () => printReceipt(t, customer, r.balance.balance);
    },
  });
}

function printReceipt(t, c, balance) {
  const w = window.open('', '_blank', 'width=420,height=640');
  w.document.write(`<html><head><title>Receipt ${G.esc(t.ref_no)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;padding:18px;color:#000;max-width:340px;margin:auto}
    h2{margin:0;text-align:center}.c{text-align:center}.row{display:flex;justify-content:space-between;margin:6px 0}
    hr{border:0;border-top:1px dashed #000;margin:12px 0}.big{font-size:22px;font-weight:800}</style></head><body>
    <h2>${G.esc(G.business.name)}</h2><div class="c">PAYMENT RECEIPT</div><hr>
    <div class="row"><span>Receipt</span><b>${G.esc(t.ref_no)}</b></div>
    <div class="row"><span>Date</span><span>${G.date(t.date)}</span></div>
    <div class="row"><span>Customer</span><span>${G.esc(c.name)}</span></div>
    <div class="row"><span>Code</span><span>${G.esc(c.code)}</span></div>
    <div class="row"><span>Method</span><span>${G.esc(t.payment_method || 'Cash')}${t.cheque_no ? ' #' + G.esc(t.cheque_no) : ''}</span></div><hr>
    <div class="row big"><span>Paid</span><span>${G.money(t.amount)}</span></div>
    <div class="row"><span>Balance due</span><b>${G.money(balance)}</b></div><hr>
    <div class="c">Thank you for your payment!</div>
    <div class="c" style="margin-top:30px">.............................<br>Authorised signature</div>
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

// ---------- transactions journal ----------
G.pages.transactions = async (view) => {
  G.head('Transactions', 'Every credit sale, payment, interest charge and adjustment');
  await G.loadLookups();
  view.innerHTML = `
    <div class="card">
      <div class="filters mb">
        <div class="field"><label>From</label><input type="date" id="tFrom" value="${G.addDays(G.today(), -30)}"></div>
        <div class="field"><label>To</label><input type="date" id="tTo" value="${G.today()}"></div>
        <div class="field"><label>Type</label><select id="tType"><option value="">All types</option>${Object.entries(G.TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>Area</label><select id="tArea">${G.areaOptions('')}</select></div>
        <label class="check" style="margin-bottom:10px"><input type="checkbox" id="tVoid"> Show voided</label>
        <span class="spacer"></span>
        ${G.can('manager') ? `<button class="btn" id="tAdj">${G.icon('edit')} Adjustment</button>` : ''}
      </div>
      <div id="tBody"></div>
    </div>`;
  const $ = (s) => view.querySelector(s);
  const load = async () => {
    const rows = await G.get('/api/transactions?' + G.qs({ from: $('#tFrom').value, to: $('#tTo').value, type: $('#tType').value, area_id: $('#tArea').value, voided: $('#tVoid').checked ? '1' : '', limit: 5000 }));
    G.table($('#tBody'), {
      rows, csv: 'transactions', onRow: (t) => (location.hash = `#/customers/${t.customer_id}`),
      columns: [
        { key: 'date', label: 'Date', fmt: 'date' },
        { key: 'ref_no', label: 'Ref', render: (t) => `<b>${G.esc(t.ref_no)}</b>` },
        { key: 'type', label: 'Type', render: (t) => G.typeBadge(t.type), csv: (t) => G.TYPE_LABEL[t.type] },
        { key: 'customer_name', label: 'Customer', render: (t) => `${G.esc(t.customer_name)} <span class="muted">${G.esc(t.customer_code)}</span>` },
        { key: 'area_name', label: 'Area' },
        { key: 'description', label: 'Details', cls: 'wrap', render: (t) => `<span class="text-2" style="font-size:12.5px">${G.esc(t.description || t.payment_method || '')}${t.voided ? ' · VOID: ' + G.esc(t.void_reason) : ''}</span>` },
        { key: 'due_date', label: 'Due', render: (t) => (t.due_date && t.type !== 'interest' ? G.date(t.due_date) : '') },
        { key: 'debit', label: 'Debit', align: 'right', sum: true, value: (t) => (G.isDebit(t.type) && !t.voided ? t.amount : 0), render: (t) => (G.isDebit(t.type) ? `<span class="num">${G.n2(t.amount)}</span>` : '') },
        { key: 'credit', label: 'Credit', align: 'right', sum: true, value: (t) => (!G.isDebit(t.type) && !t.voided ? t.amount : 0), render: (t) => (!G.isDebit(t.type) ? `<span class="num amount-neg">${G.n2(t.amount)}</span>` : '') },
        { key: 'created_by_name', label: 'By' },
        { key: 'act', label: '', sort: false, export: false, render: (t) => (G.can('manager') && !t.voided ? `<button class="btn xs ghost" data-void="${t.id}" title="Void">${G.icon('x').replace('<svg', '<svg width="14" height="14"')}</button>` : '') },
      ],
    });
  };
  ['#tFrom', '#tTo', '#tType', '#tArea', '#tVoid'].forEach((s) => ($(s).onchange = load));
  if ($('#tAdj')) $('#tAdj').onclick = () => G.entryModal('debit_adj', null, load);
  $('#tBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-void]');
    if (!b) return;
    const reason = await G.confirm('Void this entry? Balances will be recalculated.', { title: 'Void entry', ok: 'Void', danger: true, input: 'Reason' });
    if (reason === false) return;
    try { await G.post(`/api/transactions/${b.dataset.void}/void`, { reason }); G.toast('Entry voided'); load(); } catch (err) { G.fail(err); }
  });
  await load();
};

// ---------- overdue & follow-up ----------
G.pages.overdue = async (view) => {
  G.head('Overdue & Follow-up', 'Customers past their credit period — call, message and collect');
  await G.loadLookups();
  const st = { min: 0, area: '' };
  view.innerHTML = `
    <div class="kpis" id="oKpis"></div>
    <div class="card mt">
      <div class="row between mb">
        <div class="chips" id="oChips">${[[0, 'All overdue'], [1, '1–30 days'], [31, '30+ days'], [61, '60+ days'], [91, '90+ days']].map(([d, l]) => `<button class="chip ${d === 0 ? 'active' : ''}" data-d="${d}">${l}</button>`).join('')}</div>
        <div class="row">
          <select id="oArea" style="width:auto">${G.areaOptions('')}</select>
          <button class="btn primary" id="oSend">${G.icon('send')} Remind selected</button>
          ${G.can('manager') ? `<button class="btn" id="oRun" title="Apply interest and send due reminders now">${G.icon('refresh')} Run interest & reminders</button>` : ''}
        </div>
      </div>
      <div id="oBody"></div>
    </div>`;
  const $ = (s) => view.querySelector(s);
  let rows = [];
  const selected = new Set();
  const load = async () => {
    const r = await G.get('/api/reports/overdue?' + G.qs({ area_id: st.area, min_days: st.min }));
    rows = r.rows.filter((c) => st.min !== 1 || c.days_overdue <= 30);
    selected.clear();
    const tot = rows.reduce((s, c) => s + c.overdue, 0), bal = rows.reduce((s, c) => s + c.balance, 0);
    $('#oKpis').innerHTML = `
      ${G.kpi({ label: 'Overdue customers', value: rows.length, fmt: 'int', icon: 'users', accent: 'var(--critical)' })}
      ${G.kpi({ label: 'Overdue amount', value: tot, icon: 'alert', accent: 'var(--serious)' })}
      ${G.kpi({ label: 'Their total balance', value: bal, icon: 'wallet', accent: 'var(--s1)' })}
      ${G.kpi({ label: 'Average days late', value: rows.length ? rows.reduce((s, c) => s + c.days_overdue, 0) / rows.length : 0, fmt: 'int', icon: 'clock', accent: 'var(--warning)' })}`;
    G.countUp($('#oKpis'));
    G.table($('#oBody'), {
      rows, csv: 'overdue-customers', sortKey: 'days_overdue',
      tools: '<label class="check"><input type="checkbox" id="oAll"> Select all</label>',
      columns: [
        { key: 'sel', label: '', sort: false, export: false, render: (c) => `<input type="checkbox" data-sel="${c.id}">` },
        { key: 'name', label: 'Customer', cls: 'wrap', render: (c) => `<a href="#/customers/${c.id}"><b>${G.esc(c.name)}</b></a><div class="muted" style="font-size:12px">${G.esc(c.code)}</div>`, csv: (c) => c.name },
        { key: 'area_name', label: 'Area' },
        { key: 'phone', label: 'Phone' },
        { key: 'days_overdue', label: 'Late', render: (c) => G.riskBadge(c), csv: (c) => c.days_overdue },
        { key: 'oldest_overdue', label: 'Oldest due', fmt: 'date' },
        { key: 'overdue', label: 'Overdue', align: 'right', fmt: 'money', sum: true },
        { key: 'balance', label: 'Balance', align: 'right', fmt: 'money', sum: true },
        { key: 'last_payment', label: 'Last paid', fmt: 'date' },
        { key: 'act', label: 'Contact', sort: false, export: false, render: (c) => `<div class="row" style="flex-wrap:nowrap;gap:6px">
          ${c.phone ? `<a class="btn xs" href="tel:${G.esc(c.phone)}" title="Call">${G.icon('phone').replace('<svg', '<svg width="14" height="14"')}</a>` : ''}
          <button class="btn xs" data-msg="${c.id}" title="Message">${G.icon('message').replace('<svg', '<svg width="14" height="14"')}</button>
          <button class="btn xs success" data-pay="${c.id}">Pay</button></div>` },
      ],
    });
    const all = $('#oAll');
    if (all) all.onchange = () => $('#oBody').querySelectorAll('[data-sel]').forEach((cb) => { cb.checked = all.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  $('#oBody').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-sel]');
    if (cb) cb.checked ? selected.add(+cb.dataset.sel) : selected.delete(+cb.dataset.sel);
  });
  $('#oBody').addEventListener('click', (e) => {
    const m = e.target.closest('[data-msg]'), p = e.target.closest('[data-pay]');
    if (m) { const c = rows.find((x) => x.id === +m.dataset.msg); G.composeModal({ customer_ids: [c.id], label: c.name, template: 'overdue_notice', channel: c.preferred_channel }); }
    if (p) G.entryModal('payment', +p.dataset.pay, load);
  });
  $('#oChips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    st.min = +b.dataset.d;
    view.querySelectorAll('#oChips .chip').forEach((c) => c.classList.toggle('active', c === b));
    load();
  };
  $('#oArea').onchange = (e) => { st.area = e.target.value; load(); };
  $('#oSend').onclick = () => {
    const ids = selected.size ? [...selected] : rows.map((c) => c.id);
    if (!ids.length) return G.toast('No overdue customers', 'warn');
    G.composeModal({ customer_ids: ids, label: `${ids.length} overdue customer(s)`, template: 'overdue_notice' });
  };
  if ($('#oRun')) $('#oRun').onclick = (e) => G.busy(e.currentTarget, async () => {
    try {
      const r = await G.post('/api/automation/run');
      G.toast(`Interest: ${r.interest_charges} charge(s) (${G.money(r.interest_total)}) · ${r.reminders} due reminder(s) · ${r.overdue_notices} overdue notice(s)`, 'ok', 7000);
      load();
    } catch (err) { G.fail(err); }
  });
  await load();
};

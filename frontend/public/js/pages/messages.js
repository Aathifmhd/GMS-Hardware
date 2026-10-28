// Messaging center: compose to one/many customers on SMS, WhatsApp, Email; delivery log.
const CH_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

async function composeBody(m, opts) {
  const templates = await G.get('/api/templates');
  const el = m.el;
  const chosen = new Set([opts.channel || 'sms']);
  el.querySelector('.modal-body').innerHTML = `
    ${opts.customer_ids ? `<div class="badge info mb">${G.icon('users').replace('<svg', '<svg width="13" height="13"')} To: ${G.esc(opts.label)}</div>` : `
    <div class="form-grid three mb">
      <div class="field"><label>Audience</label><select id="cmSeg"><option value="with_balance">Customers with a balance</option><option value="overdue">Overdue customers</option><option value="over_limit">Over credit limit</option><option value="all">All active customers</option></select></div>
      <div class="field"><label>Area</label><select id="cmArea">${G.areaOptions('', 'All areas')}</select></div>
      <div class="field"><label>Credit type</label><select id="cmType">${G.typeOptions('', 'All types')}</select></div>
    </div>`}
    <div class="field"><label>Send via</label><div class="chips" id="cmCh">${Object.entries(CH_LABEL).map(([k, l]) => `<button type="button" class="chip ${chosen.has(k) ? 'active' : ''}" data-ch="${k}">${G.channelIcon(k).replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')} ${l}</button>`).join('')}</div></div>
    <div class="form-grid mt-s">
      <div class="field"><label>Template</label><select id="cmTpl">${templates.map((t) => `<option value="${t.key}" ${t.key === opts.template ? 'selected' : ''}>${G.esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Email subject</label><input id="cmSubj"></div>
      <div class="field full"><label>Message</label><textarea id="cmBody" rows="5"></textarea>
        <div class="help"><span id="cmCount">0</span> characters · placeholders like {name} {balance} {overdue} are filled per customer</div></div>
      <div class="field full"><label>Preview <span class="muted" id="cmPrevFor"></span></label><div class="msg-preview" id="cmPrev"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const applyTpl = () => { const t = templates.find((x) => x.key === $('#cmTpl').value); $('#cmBody').value = t.body; $('#cmSubj').value = t.subject || ''; preview(); };
  let pt;
  const preview = () => {
    $('#cmCount').textContent = $('#cmBody').value.length;
    clearTimeout(pt);
    pt = setTimeout(async () => {
      const r = await G.post('/api/messages/preview', { customer_id: opts.customer_ids?.[0], body: $('#cmBody').value, subject: $('#cmSubj').value });
      $('#cmPrev').textContent = r.body;
      $('#cmPrevFor').textContent = r.customer ? `(for ${r.customer})` : '';
    }, 250);
  };
  $('#cmTpl').onchange = applyTpl;
  $('#cmBody').oninput = preview;
  $('#cmCh').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    chosen.has(b.dataset.ch) ? chosen.delete(b.dataset.ch) : chosen.add(b.dataset.ch);
    b.classList.toggle('active');
  };
  applyTpl();
  $('#cmSend').onclick = (e) => G.busy(e.currentTarget, async () => {
    if (!chosen.size) return G.toast('Choose at least one channel', 'warn');
    const payload = { channels: [...chosen], subject: $('#cmSubj').value, body: $('#cmBody').value };
    if (opts.customer_ids) payload.customer_ids = opts.customer_ids;
    else Object.assign(payload, { segment: $('#cmSeg').value, area_id: $('#cmArea').value, credit_type_id: $('#cmType').value });
    try {
      const r = await G.post('/api/messages/send', payload);
      m.close();
      showResults(r);
      opts.onSent && opts.onSent();
    } catch (err) { G.fail(err); }
  });
}

function showResults(r) {
  const links = r.results.filter((x) => x.status === 'link');
  if (!links.length && !r.failed) { G.toast(`${r.sent} message(s) sent`); return; }
  G.modal({
    title: 'Sending result',
    body: `<div class="stat-list mb"><div class="stat"><span>Sent</span><b style="color:var(--good)">${r.sent}</b></div><div class="stat"><span>WhatsApp to open</span><b>${r.links}</b></div><div class="stat"><span>Failed</span><b style="color:var(--critical)">${r.failed}</b></div></div>
      ${links.length ? `<p class="muted">Click each to open WhatsApp with the message ready, then press send.</p>${links.map((l) => `<div class="list-item"><div class="grow"><div class="title">${G.esc(l.customer_name)}</div><div class="sub">${G.esc(l.recipient)}</div></div><a class="btn xs success" target="_blank" rel="noopener" href="${G.esc(l.link)}" onclick="this.textContent='Opened ✓'">Open WhatsApp</a></div>`).join('')}` : ''}
      ${r.failed ? `<h4 class="mt">Failed</h4>${r.results.filter((x) => x.status === 'failed').map((f) => `<div class="list-item"><div class="grow"><div class="title">${G.esc(f.customer_name)} · ${CH_LABEL[f.channel]}</div><div class="sub type-interest">${G.esc(f.error)}</div></div></div>`).join('')}` : ''}`,
    foot: '<button class="btn primary" data-close>Done</button>',
  });
}

G.composeModal = (opts = {}) => {
  const m = G.modal({
    title: `${G.icon('send').replace('<svg', '<svg width="20" height="20" style="vertical-align:-3px;color:var(--brand)"')} Send message`, size: 'wide',
    body: '<div class="skeleton" style="height:300px"></div>',
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cmSend">${G.icon('send')} Send</button>`,
  });
  composeBody(m, opts).catch(G.fail);
};

G.pages.messages = async (view) => {
  G.head('Messaging Center', 'SMS, WhatsApp and Email to customers — reminders, statements, notices');
  await G.loadLookups();
  view.innerHTML = `
    <div class="kpis" id="mKpis"></div>
    <div class="grid g3 mt">
      ${[['overdue', 'alert', 'Remind overdue customers', 'Send the overdue notice to everyone past due', 'overdue_notice', 'var(--critical)'],
         ['with_balance', 'book', 'Send statements', 'Balance statement to every customer who owes', 'statement', 'var(--s1)'],
         ['all', 'message', 'Announcement', 'Custom message or promotion to all customers', 'custom', 'var(--s3)']]
        .map(([seg, ic, t, d, tpl, c]) => `<div class="report-tile" style="--c:${c}" data-seg="${seg}" data-tpl="${tpl}"><div class="icon-dot">${G.icon(ic)}</div><h4>${t}</h4><p>${d}</p></div>`).join('')}
    </div>
    <div class="card mt">
      <div class="card-head"><div><h3>Message log</h3><div class="sub">Every message sent by the system or staff</div></div>
        <div class="row"><select id="mCh" style="width:auto"><option value="">All channels</option>${Object.entries(CH_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select id="mSt" style="width:auto"><option value="">Any status</option><option value="sent">Sent</option><option value="link">WhatsApp link</option><option value="failed">Failed</option></select>
        <button class="btn primary sm" id="mNew">${G.icon('plus')} New message</button></div></div>
      <div id="mBody"></div>
    </div>`;
  const $ = (s) => view.querySelector(s);
  const load = async () => {
    const rows = await G.get('/api/messages?' + G.qs({ channel: $('#mCh').value, status: $('#mSt').value }));
    const by = (k, v) => rows.filter((r) => r[k] === v).length;
    $('#mKpis').innerHTML = `
      ${G.kpi({ label: 'Messages logged', value: rows.length, fmt: 'int', icon: 'message', accent: 'var(--s1)' })}
      ${G.kpi({ label: 'SMS', value: by('channel', 'sms'), fmt: 'int', icon: 'sms', accent: 'var(--s2)' })}
      ${G.kpi({ label: 'WhatsApp', value: by('channel', 'whatsapp'), fmt: 'int', icon: 'whatsapp', accent: 'var(--good)' })}
      ${G.kpi({ label: 'Email', value: by('channel', 'email'), fmt: 'int', icon: 'mail', accent: 'var(--s7)' })}
      ${G.kpi({ label: 'Failed', value: by('status', 'failed'), fmt: 'int', icon: 'alert', accent: 'var(--critical)', foot: 'Check Settings → gateways' })}`;
    G.countUp($('#mKpis'));
    G.table($('#mBody'), {
      rows, csv: 'messages',
      columns: [
        { key: 'created_at', label: 'When', render: (m) => `<span class="nowrap">${G.dt(m.created_at)}</span>` },
        { key: 'channel', label: 'Channel', render: (m) => `<span class="row" style="gap:6px;flex-wrap:nowrap">${G.channelIcon(m.channel).replace('<svg', '<svg width="16" height="16"')} ${CH_LABEL[m.channel] || m.channel}</span>`, csv: (m) => m.channel },
        { key: 'customer_name', label: 'Customer', render: (m) => (m.customer_id ? `<a href="#/customers/${m.customer_id}">${G.esc(m.customer_name)}</a>` : '<span class="muted">—</span>') },
        { key: 'recipient', label: 'To' },
        { key: 'kind', label: 'Type', render: (m) => `<span class="badge">${G.esc(m.kind)}</span>` },
        { key: 'body', label: 'Message', cls: 'wrap', render: (m) => `<div style="max-width:380px;font-size:12.5px" class="text-2">${G.esc(m.body.length > 140 ? m.body.slice(0, 140) + '…' : m.body)}</div>` },
        { key: 'status', label: 'Status', render: (m) => `${G.msgStatus(m.status)}${m.error ? `<div class="type-interest" style="font-size:11.5px;max-width:200px">${G.esc(m.error)}</div>` : ''}${m.link ? `<div><a target="_blank" rel="noopener" href="${G.esc(m.link)}" style="font-size:12px">Open WhatsApp</a></div>` : ''}` },
        { key: 'sent_by', label: 'By', render: (m) => G.esc(m.sent_by || 'System') },
      ],
    });
  };
  $('#mCh').onchange = load;
  $('#mSt').onchange = load;
  $('#mNew').onclick = () => G.composeModal({ template: 'custom', onSent: load });
  view.querySelectorAll('[data-seg]').forEach((t) => (t.onclick = () => {
    const m = G.modal({ title: `${G.icon('send').replace('<svg', '<svg width="20" height="20" style="vertical-align:-3px;color:var(--brand)"')} Send message`, size: 'wide', body: '', foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cmSend">${G.icon('send')} Send</button>` });
    composeBody(m, { template: t.dataset.tpl, onSent: load }).then(() => { m.el.querySelector('#cmSeg').value = t.dataset.seg; }).catch(G.fail);
  }));
  await load();
};

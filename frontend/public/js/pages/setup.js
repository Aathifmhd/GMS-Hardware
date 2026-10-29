// Setup pages: areas, credit types, settings (business, interest, automation, messaging, templates, backup), users.

// ---------- areas ----------
G.pages.areas = async (view) => {
  G.head('Areas', 'Customers are grouped by area for collection routes and reports');
  const areas = await G.get('/api/areas');
  G.areas = areas;
  const maxBal = Math.max(1, ...areas.map((a) => a.balance));
  view.innerHTML = `
    <div class="row between mb"><div class="muted">${areas.length} area(s) · ${G.money(areas.reduce((s, a) => s + a.balance, 0))} outstanding</div>
      ${G.can('manager') ? `<button class="btn primary" id="addArea">${G.icon('plus')} Add area</button>` : ''}</div>
    <div class="report-tiles">${areas.map((a, i) => `
      <div class="report-tile" style="--c:var(--s${(i % 8) + 1});animation:rise .5s ${i * 0.04}s both var(--ease)" data-go="${a.id}">
        <div class="row between"><div class="icon-dot">${G.icon('pin')}</div>
          ${G.can('manager') ? `<div class="row" style="gap:4px"><button class="btn xs ghost" data-edit="${a.id}">${G.icon('edit').replace('<svg', '<svg width="14" height="14"')}</button><button class="btn xs ghost" data-del="${a.id}">${G.icon('trash').replace('<svg', '<svg width="14" height="14"')}</button></div>` : ''}</div>
        <h4>${G.esc(a.name)}</h4>
        <p>${a.customers} customers${a.collector ? ' · ' + G.esc(a.collector) : ''}${a.visit_day ? ' · ' + G.esc(a.visit_day) : ''}</p>
        <div class="row between mt-s"><span class="muted" style="font-size:12px">Outstanding</span><b class="num">${G.money(a.balance)}</b></div>
        <div class="bar mt-s"><i data-w="${(a.balance / maxBal) * 100}"></i></div>
        <div class="row between mt-s"><span class="muted" style="font-size:12px">Overdue</span><b class="num ${a.overdue > 0 ? 'type-interest' : ''}">${G.money(a.overdue)}</b></div>
      </div>`).join('') || `<div class="card"><div class="empty">${G.icon('map')}No areas yet. Add your first area (e.g. town / village / route).</div></div>`}
    </div>`;
  const form = (a = {}) => G.modal({
    title: a.id ? 'Edit area' : 'New area', size: 'narrow',
    body: `<form id="aForm" class="grid">
      <div class="field"><label>Area name *</label><input name="name" value="${G.esc(a.name || '')}" required></div>
      <div class="field"><label>Description</label><input name="description" value="${G.esc(a.description || '')}"></div>
      <div class="field"><label>Collector / sales rep</label><input name="collector" value="${G.esc(a.collector || '')}"></div>
      <div class="field"><label>Collection day</label><select name="visit_day"><option value="">—</option>${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `<option ${a.visit_day === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div></form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="aSave">Save</button>',
    onMount: (m) => (m.el.querySelector('#aSave').onclick = async () => {
      const f = m.el.querySelector('#aForm');
      if (!f.reportValidity()) return;
      try { a.id ? await G.put(`/api/areas/${a.id}`, G.formData(f)) : await G.post('/api/areas', G.formData(f)); m.close(); G.toast('Area saved'); G.reload(); } catch (e) { G.fail(e); }
    }),
  });
  const add = view.querySelector('#addArea');
  if (add) add.onclick = () => form();
  view.querySelector('.report-tiles').onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), go = e.target.closest('[data-go]');
    if (ed) return form(areas.find((a) => a.id === +ed.dataset.edit));
    if (del) {
      const a = areas.find((x) => x.id === +del.dataset.del);
      if (await G.confirm(`Delete area <b>${G.esc(a.name)}</b>?`, { danger: true, ok: 'Delete' })) {
        try { await G.del(`/api/areas/${a.id}`); G.toast('Area deleted'); G.reload(); } catch (err) { G.fail(err); }
      }
      return;
    }
    if (go) location.hash = `#/customers?area=${go.dataset.go}`;
  };
};

// ---------- credit types ----------
G.pages.creditTypes = async (view) => {
  G.head('Credit Types', 'Each customer belongs to a credit type with a default limit, period and interest');
  const types = await G.get('/api/credit-types');
  view.innerHTML = `
    <div class="row between mb"><div class="muted">Changing a type's defaults does not change existing customers' limits.</div>
      ${G.can('manager') ? `<button class="btn primary" id="addType">${G.icon('plus')} Add credit type</button>` : ''}</div>
    <div class="report-tiles">${types.map((t, i) => `
      <div class="report-tile" style="--c:${G.esc(t.color)};animation:rise .5s ${i * 0.05}s both var(--ease);cursor:default">
        <div class="row between"><div class="icon-dot">${G.icon('layers')}</div>
          ${G.can('manager') ? `<div class="row" style="gap:4px"><button class="btn xs ghost" data-edit="${t.id}">${G.icon('edit').replace('<svg', '<svg width="14" height="14"')}</button><button class="btn xs ghost" data-del="${t.id}">${G.icon('trash').replace('<svg', '<svg width="14" height="14"')}</button></div>` : ''}</div>
        <h4>${G.esc(t.name)}</h4><p>${G.esc(t.description || '')}</p>
        <div class="stat-list mt-s" style="grid-template-columns:1fr 1fr">
          <div class="stat"><span>Default limit</span><b style="font-size:15px">${G.money(t.default_limit)}</b></div>
          <div class="stat"><span>Credit period</span><b style="font-size:15px">${t.default_period_days} days</b></div>
          <div class="stat"><span>Interest</span><b style="font-size:15px">${t.interest_rate != null ? t.interest_rate + '%' : 'Default'}</b></div>
          <div class="stat"><span>Customers</span><b style="font-size:15px">${t.customers}</b></div>
        </div></div>`).join('')}
    </div>`;
  const form = (t = { color: '#2a78d6', default_period_days: 30 }) => G.modal({
    title: t.id ? 'Edit credit type' : 'New credit type',
    body: `<form id="tForm" class="form-grid">
      <div class="field"><label>Name *</label><input name="name" value="${G.esc(t.name || '')}" required></div>
      <div class="field"><label>Colour</label><input type="color" name="color" value="${G.esc(t.color)}"></div>
      <div class="field full"><label>Description</label><input name="description" value="${G.esc(t.description || '')}"></div>
      <div class="field"><label>Default credit limit</label><input type="number" min="0" step="0.01" name="default_limit" value="${t.default_limit ?? 0}"></div>
      <div class="field"><label>Default credit period (days)</label><input type="number" min="1" name="default_period_days" value="${t.default_period_days}"></div>
      <div class="field full"><label>Interest % per cycle (override)</label><input type="number" min="0" step="0.01" name="interest_rate" value="${t.interest_rate ?? ''}" placeholder="Empty = use the global rate"></div></form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="tSave">Save</button>',
    onMount: (m) => (m.el.querySelector('#tSave').onclick = async () => {
      const f = m.el.querySelector('#tForm');
      if (!f.reportValidity()) return;
      try { t.id ? await G.put(`/api/credit-types/${t.id}`, G.formData(f)) : await G.post('/api/credit-types', G.formData(f)); m.close(); G.toast('Credit type saved'); G.reload(); } catch (e) { G.fail(e); }
    }),
  });
  const add = view.querySelector('#addType');
  if (add) add.onclick = () => form();
  view.querySelector('.report-tiles').onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) form(types.find((t) => t.id === +ed.dataset.edit));
    if (del) {
      const t = types.find((x) => x.id === +del.dataset.del);
      if (await G.confirm(`Delete credit type <b>${G.esc(t.name)}</b>?`, { danger: true, ok: 'Delete' })) {
        try { await G.del(`/api/credit-types/${t.id}`); G.toast('Deleted'); G.reload(); } catch (err) { G.fail(err); }
      }
    }
  };
};

// ---------- settings ----------
// Laid out like Cargo POS: the sections on the left (a list on phones), one section at a time on the right.
// Everyone gets My account and Appearance; managers also see the business settings (only the owner can
// change them; managers can edit message templates); the owner also gets Backup.
const SET_GROUPS = [
  { heading: 'Account', items: [
    { id: 'account', icon: 'user', label: 'My account', desc: 'Your name, phone number and password.' },
    { id: 'appearance', icon: 'sun', label: 'Appearance', desc: 'Light or dark look for this computer.' },
  ] },
  { heading: 'Business', role: 'manager', items: [
    { id: 'business', icon: 'book', label: 'Business details', desc: 'Name, address, phone and currency used on screens, statements and messages.' },
    { id: 'interest', icon: 'percent', label: 'Interest & credit', desc: 'How much overdue interest is added, how often, and after how many grace days.' },
  ] },
  { heading: 'Messages', role: 'manager', items: [
    { id: 'auto', icon: 'zap', label: 'Automatic messages', desc: 'Which messages go out by themselves: new bills, receipts, due reminders, overdue notices and interest.' },
    { id: 'sms', icon: 'sms', label: 'SMS gateway', desc: 'Notify.lk, Text.lk or any other HTTP SMS gateway.' },
    { id: 'whatsapp', icon: 'whatsapp', label: 'WhatsApp', desc: 'Click-to-chat links, or the WhatsApp Business Cloud API to send by itself.' },
    { id: 'email', icon: 'mail', label: 'Email', desc: 'The SMTP server that sends email, e.g. Gmail with an app password.' },
    { id: 'templates', icon: 'message', label: 'Message templates', desc: 'The wording of every message. Placeholders like {name} are filled in for each customer.' },
  ] },
  { heading: 'System', role: 'owner', items: [
    { id: 'backup', icon: 'database', label: 'Backup', desc: 'Download a full copy of the database.' },
  ] },
];
const SET_SECTION = 'gms-settings-section';

G.pages.settings = async (view, wanted) => {
  G.head('Settings', 'Your account, business details, interest, messages and backups, arranged by section');
  const owner = G.can('owner');
  const [s, templates] = G.can('manager') ? await Promise.all([G.get('/api/settings'), G.get('/api/templates')]) : [{}, []];
  const groups = SET_GROUPS.filter((g) => !g.role || G.can(g.role));
  const items = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.heading })));
  let remembered = null;
  try { remembered = localStorage.getItem(SET_SECTION); } catch (e) { /* storage unavailable */ }
  const first = [wanted, remembered].find((id) => items.some((i) => i.id === id)) || items[0].id;

  const inp = (k, label, attrs = '', help = '') => `<div class="field"><label>${label}</label><input name="${k}" value="${G.esc(s[k] ?? '')}" ${attrs}>${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const sel = (k, label, opts, help = '') => `<div class="field"><label>${label}</label><select name="${k}">${opts.map(([v, l]) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const chk = (k, label) => `<div class="field full"><label class="check"><input type="checkbox" name="${k}" ${s[k] === '1' ? 'checked' : ''}> ${label}</label></div>`;
  // one form per section, saved on its own; managers see the values but only the owner can change them
  const settingsForm = (fields, extra = '') => `<form class="settings-form set-form"><div class="form-grid">${fields}</div>${owner
    ? `<div class="set-save"><span class="muted set-dirty hidden">You have unsaved changes</span><button class="btn primary" type="submit" disabled>${G.icon('check')} Save changes</button></div>`
    : '<div class="set-save"><span class="muted">Only the owner can change these settings.</span></div>'}</form>${extra}`;
  const testBox = (channel, label) => `<div class="set-test"><h4 class="set-sub">Send a test</h4><div class="row" style="align-items:flex-end">
      <div class="field" style="flex:1;min-width:200px"><label>${label}</label><input class="testTo" data-ch="${channel}"></div>
      <button type="button" class="btn testBtn" data-ch="${channel}">${G.icon('send')} Send test</button></div><div class="help">Save the settings above before testing.</div></div>`;
  const theme = document.documentElement.dataset.theme;

  const sections = {
    account: `<div class="set-form">
      <form id="profileForm" class="form-grid">
        <div class="field"><label>Username</label><input value="${G.esc(G.user.username)}" disabled></div>
        <div class="field"><label>Role</label><input value="${G.esc(G.user.role[0].toUpperCase() + G.user.role.slice(1))}" disabled></div>
        <div class="field"><label>Full name *</label><input name="full_name" value="${G.esc(G.user.full_name)}" required></div>
        <div class="field"><label>Phone</label><input name="phone" value="${G.esc(G.user.phone || '')}"></div>
        <div class="field full set-save"><button class="btn primary" type="submit">${G.icon('check')} Save my details</button></div>
      </form>
      <h4 class="set-sub mt">Change password</h4>
      <form id="pwForm" class="form-grid">
        <div class="field full"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>
        <div class="field"><label>New password</label><input type="password" name="next" minlength="6" autocomplete="new-password" required></div>
        <div class="field"><label>Repeat new password</label><input type="password" name="again" minlength="6" autocomplete="new-password" required></div>
        <div class="field full set-save"><button class="btn primary" type="submit">${G.icon('key')} Change password</button></div>
      </form></div>`,
    appearance: `<div class="set-form"><p class="muted" style="margin-top:0">Light (white) is the default. The choice is saved on this computer; you can also switch it from the account menu at the foot of the menu bar.</p>
      <div class="theme-switch big" role="radiogroup" aria-label="Theme">${[['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([v, ic, l]) => `<button type="button" role="radio" aria-checked="${theme === v}" data-theme-pick="${v}" class="${theme === v ? 'on' : ''}">${G.icon(ic)} ${l}</button>`).join('')}</div></div>`,
    business: settingsForm(`${inp('business_name', 'Business name')}${inp('business_phone', 'Phone')}${inp('business_email', 'Email')}${inp('business_address', 'Address')}
      ${inp('currency', 'Currency symbol', '', 'Shown on screens, reports and messages')}${inp('country_code', 'Country dialing code', '', 'Turns 07X numbers into international numbers for SMS / WhatsApp (94 = Sri Lanka)')}`),
    interest: settingsForm(`${chk('interest_enabled', 'Charge interest on overdue bills')}
      ${inp('interest_rate', 'Interest rate (%)', 'type="number" step="0.01" min="0"', 'Charged on the unpaid part of each overdue bill')}
      ${inp('interest_cycle_days', 'Charge every (days)', 'type="number" min="1"', '30 = the rate again for each month the bill stays overdue')}
      ${inp('interest_grace_days', 'Grace days after due date', 'type="number" min="0"', 'Extra days before the first interest charge')}
      <div class="field full"><div class="stat" id="intExample"></div></div>`),
    auto: settingsForm(`${sel('default_channel', 'Default channel', [['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']], 'Used when a customer has no preferred channel')}<div></div>
      ${chk('auto_notify_credit', 'Notify the customer when a credit bill is added')}
      ${chk('auto_notify_payment', 'Send a payment receipt message when a payment is received')}
      ${chk('auto_notify_interest', 'Notify the customer when interest is charged')}
      ${chk('auto_due_reminder', 'Send a reminder before the due date')}
      ${inp('due_reminder_days', 'Days before due date', 'type="number" min="0"')}<div></div>
      ${chk('auto_overdue_notice', 'Send overdue notices automatically')}
      ${inp('overdue_notice_every_days', 'Repeat overdue notice every (days)', 'type="number" min="1"')}
      <div class="field full help">The daily job sends these at 01:00 Sri Lanka time, and managers can also run it from Overdue &amp; Follow-up. Each reminder goes at most once a day.</div>`),
    sms: settingsForm(`${sel('sms_provider', 'Provider', [['none', 'Not configured'], ['notifylk', 'Notify.lk'], ['textlk', 'Text.lk'], ['generic', 'Other HTTP gateway']])}
      ${inp('sms_sender_id', 'Sender ID / mask')}
      ${inp('sms_notifylk_user_id', 'Notify.lk user ID')}${inp('sms_notifylk_api_key', 'Notify.lk API key', 'type="password"')}
      ${inp('sms_textlk_token', 'Text.lk API token', 'type="password"')}<div></div>
      ${sel('sms_generic_method', 'HTTP method (other gateway)', [['GET', 'GET'], ['POST', 'POST (JSON)']])}
      ${inp('sms_generic_url', 'Gateway URL', 'placeholder="https://api.example.com/send?key=XXX&to={to}&msg={message}"', 'Use {to} and {message} placeholders')}
      <div class="field full"><label>POST body (JSON)</label><input name="sms_generic_body" value="${G.esc(s.sms_generic_body || '')}" placeholder='{"to":"{to}","message":"{message}"}'></div>`, testBox('sms', 'Test phone number')),
    whatsapp: settingsForm(`${sel('whatsapp_mode', 'Mode', [['link', 'Click-to-chat link (no setup)'], ['cloudapi', 'WhatsApp Business Cloud API']], 'Link mode opens WhatsApp with the message ready to send')}
      <div></div>${inp('whatsapp_phone_id', 'Cloud API phone number ID')}${inp('whatsapp_token', 'Cloud API access token', 'type="password"')}
      <div class="field full help">WhatsApp's Cloud API only delivers free-form text inside a 24-hour customer-service window; outside it Meta requires approved message templates.</div>`, testBox('whatsapp', 'Test WhatsApp number')),
    email: settingsForm(`${chk('email_enabled', 'Enable email sending')}
      ${inp('smtp_host', 'SMTP host', 'placeholder="smtp.gmail.com"')}${inp('smtp_port', 'Port', 'type="number"')}
      ${inp('smtp_user', 'Username')}${inp('smtp_pass', 'Password', 'type="password"')}
      ${inp('smtp_from', 'From address', 'placeholder="GMS Hardware <accounts@example.com>"')}
      ${chk('smtp_secure', 'Use SSL/TLS (port 465)')}`, testBox('email', 'Test email address')),
    templates: `<div class="chips var-chips mb">${['name', 'code', 'balance', 'overdue', 'limit', 'amount', 'ref_no', 'date', 'due_date', 'rate', 'cycle', 'period', 'business', 'phone'].map((v) => `<span class="chip">{${v}}</span>`).join('')}</div>
      <div class="grid g2">${templates.map((t) => `<form class="tplForm tpl-box" data-key="${t.key}">
        <div class="card-head"><h3>${G.esc(t.name)}</h3><span class="badge">${t.key}</span></div>
        <div class="field"><label>Email subject</label><input name="subject" value="${G.esc(t.subject || '')}"></div>
        <div class="field mt-s"><label>Message</label><textarea name="body" rows="4">${G.esc(t.body)}</textarea><div class="help"><span class="cc">${t.body.length}</span> characters · ~<span class="sm">${Math.ceil(t.body.length / 160)}</span> SMS part(s) before filling</div></div>
        <div class="row mt-s"><button class="btn sm primary" type="submit">Save template</button></div></form>`).join('')}</div>`,
    backup: `<div class="set-form"><button class="btn primary" id="bkBtn">${G.icon('database')} Download backup now</button>
      <p class="muted">The file is a JSON copy of every table (passwords left out) that opens in any text editor. Keep it on a USB drive or cloud storage. Supabase also keeps backups of the database, depending on your plan: Supabase dashboard → Database → Backups.</p></div>`,
  };

  view.innerHTML = `<div class="set-layout">
    <nav class="set-nav" aria-label="Settings sections">${groups.map((g) => `<div class="set-group"><div class="set-group-title">${g.heading}</div>${g.items.map((i) => `<button type="button" class="set-link" data-sec="${i.id}">${G.icon(i.icon)}<span>${i.label}</span></button>`).join('')}</div>`).join('')}</nav>
    <section class="card set-panel">
      <div class="set-head"><button type="button" class="set-back">‹ All settings</button><div class="set-crumb"></div><h2></h2><p class="muted"></p></div>
      <div class="set-body">${items.map((i) => `<div class="set-sec hidden" data-id="${i.id}">${sections[i.id]}</div>`).join('')}</div>
    </section></div>`;

  // switching sections (on phones: from the list to one section and back)
  const layout = view.querySelector('.set-layout');
  const show = (id, open) => {
    const it = items.find((i) => i.id === id);
    view.querySelectorAll('.set-link').forEach((b) => b.classList.toggle('on', b.dataset.sec === id));
    view.querySelectorAll('.set-sec').forEach((d) => d.classList.toggle('hidden', d.dataset.id !== id));
    view.querySelector('.set-crumb').textContent = it.group;
    view.querySelector('.set-head h2').textContent = it.label;
    view.querySelector('.set-head p').textContent = it.desc;
    layout.classList.toggle('show-panel', open);
    try { localStorage.setItem(SET_SECTION, id); } catch (e) { /* storage unavailable */ }
    if (open) history.replaceState(null, '', `#/settings/${id}`);
  };
  view.querySelector('.set-nav').onclick = (e) => {
    const b = e.target.closest('[data-sec]');
    if (b) { show(b.dataset.sec, true); window.scrollTo({ top: 0 }); }
  };
  view.querySelector('.set-back').onclick = () => {
    layout.classList.remove('show-panel');
    history.replaceState(null, '', '#/settings');
    window.scrollTo({ top: 0 });
  };
  show(first, !!wanted);

  // my account
  const profile = view.querySelector('#profileForm');
  profile.onsubmit = async (e) => {
    e.preventDefault();
    const data = G.formData(profile);
    try {
      await G.put('/api/auth/profile', data);
      Object.assign(G.user, { full_name: data.full_name.trim(), phone: data.phone.trim() || null });
      G.renderUser();
      G.toast('Your details are saved');
    } catch (err) { G.fail(err); }
  };
  const pw = view.querySelector('#pwForm');
  pw.onsubmit = async (e) => {
    e.preventDefault();
    const data = G.formData(pw);
    if (data.next !== data.again) return G.toast('The two new passwords are not the same', 'error');
    try { await G.post('/api/auth/password', { current: data.current, next: data.next }); pw.reset(); G.toast('Password changed'); } catch (err) { G.fail(err); }
  };
  view.querySelectorAll('[data-theme-pick]').forEach((b) => (b.onclick = () => G.setTheme(b.dataset.themePick)));

  // business settings: each section's form saves only its own fields
  const valueOf = (el) => (el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
  view.querySelectorAll('.settings-form').forEach((f) => {
    const fields = [...f.elements].filter((el) => el.name);
    if (!owner) { fields.forEach((el) => (el.disabled = true)); return; }
    const btn = f.querySelector('[type=submit]'), note = f.querySelector('.set-dirty');
    const update = () => {
      const dirty = fields.some((el) => valueOf(el) !== String(s[el.name] ?? ''));
      btn.disabled = !dirty;
      note.classList.toggle('hidden', !dirty);
    };
    f.addEventListener('input', update);
    f.addEventListener('change', update);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(fields.map((el) => [el.name, valueOf(el)]));
      try {
        await G.put('/api/settings', data);
        Object.assign(s, data);
        if ('business_name' in data) { G.business.name = data.business_name; G.business.currency = data.currency; G.renderUser(); }
        G.toast('Settings saved');
        update();
      } catch (err) { G.fail(err); }
    };
  });
  const intForm = view.querySelector('#intExample')?.closest('form');
  if (intForm) {
    const ex = () => {
      const r = Number(intForm.interest_rate.value) || 0, c = Number(intForm.interest_cycle_days.value) || 30, g = Number(intForm.interest_grace_days.value) || 0;
      view.querySelector('#intExample').innerHTML = `<span>Example</span><div style="margin-top:4px">A ${G.money(100000)} bill unpaid ${g ? g + ' grace day(s) + ' : ''}1 day after its due date gets <b>${G.money(1000 * r)}</b> (${r}%). If still unpaid after ${c} more days, another ${r}% is added — and so on every ${c} days.</div>`;
    };
    ['interest_rate', 'interest_cycle_days', 'interest_grace_days'].forEach((k) => intForm[k].addEventListener('input', ex));
    ex();
  }
  view.querySelectorAll('.testBtn').forEach((b) => (b.onclick = () => G.busy(b, async () => {
    const to = view.querySelector(`.testTo[data-ch="${b.dataset.ch}"]`).value;
    try {
      const r = await G.post('/api/messages/test', { channel: b.dataset.ch, recipient: to });
      if (r.status === 'failed') G.toast('Test failed: ' + r.error, 'error', 8000);
      else if (r.status === 'link') { window.open(r.link, '_blank'); G.toast('WhatsApp opened with the test message'); }
      else G.toast(`Test ${b.dataset.ch} sent to ${r.recipient}`);
    } catch (err) { G.fail(err); }
  })));
  view.querySelectorAll('.tplForm').forEach((f) => {
    f.body.addEventListener('input', () => { f.querySelector('.cc').textContent = f.body.value.length; f.querySelector('.sm').textContent = Math.ceil(f.body.value.length / 160); });
    f.onsubmit = async (e) => { e.preventDefault(); try { await G.put(`/api/templates/${f.dataset.key}`, G.formData(f)); G.toast('Template saved'); } catch (err) { G.fail(err); } };
  });
  const bk = view.querySelector('#bkBtn');
  if (bk) bk.onclick = () => G.busy(bk, async () => {
    const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${G.token}` } });
    if (!res.ok) return G.toast('Backup failed', 'error');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gms-credit-backup-${G.today()}.json`;
    a.click();
    G.toast('Backup downloaded');
  });
};

// ---------- users ----------
G.pages.users = async (view) => {
  G.head('Users & Security', 'Staff accounts and roles');
  const users = await G.get('/api/users');
  view.innerHTML = `
    <div class="grid g-2-1">
      <div class="card"><div class="card-head"><h3>User accounts</h3><button class="btn primary sm" id="addUser">${G.icon('plus')} Add user</button></div><div id="uBody"></div></div>
      <div class="card"><div class="card-head"><h3>Roles</h3></div>
        <div class="list-item"><div class="icon-dot" style="color:var(--brand)">${G.icon('crown')}</div><div class="grow"><div class="title">Owner</div><div class="sub">Everything, including owner reports, settings, users, deleting customers and backups.</div></div></div>
        <div class="list-item"><div class="icon-dot" style="color:var(--s1)">${G.icon('shield')}</div><div class="grow"><div class="title">Manager</div><div class="sub">Edit customers, void entries, adjustments, approve over-limit credit, areas, credit types, templates.</div></div></div>
        <div class="list-item"><div class="icon-dot" style="color:var(--s3)">${G.icon('user')}</div><div class="grow"><div class="title">Staff</div><div class="sub">Add customers (on their credit type's standard terms), record credit sales and payments, send messages, view reports.</div></div></div>
      </div>
    </div>`;
  G.table(view.querySelector('#uBody'), {
    rows: users, search: false, onRow: (u) => form(u),
    columns: [
      { key: 'full_name', label: 'Name', render: (u) => `<div class="row" style="flex-wrap:nowrap"><div class="avatar" style="width:32px;height:32px;font-size:12px">${G.initials(u.full_name)}</div><b>${G.esc(u.full_name)}</b></div>` },
      { key: 'username', label: 'Username' },
      { key: 'role', label: 'Role', render: (u) => `<span class="badge ${u.role === 'owner' ? 'warning' : u.role === 'manager' ? 'info' : ''}">${u.role}</span>` },
      { key: 'phone', label: 'Phone' },
      { key: 'active', label: 'Status', render: (u) => (u.active ? '<span class="badge good">Active</span>' : '<span class="badge critical">Disabled</span>') },
      { key: 'created_at', label: 'Created', fmt: 'date' },
    ],
  });
  const form = (u = { role: 'staff', active: 1 }) => G.modal({
    title: u.id ? `Edit ${G.esc(u.username)}` : 'New user', size: 'narrow',
    body: `<form id="uForm" class="grid">
      ${u.id ? '' : '<div class="field"><label>Username *</label><input name="username" required></div>'}
      <div class="field"><label>Full name *</label><input name="full_name" value="${G.esc(u.full_name || '')}" required></div>
      <div class="field"><label>Phone</label><input name="phone" value="${G.esc(u.phone || '')}"></div>
      <div class="field"><label>Role</label><select name="role">${['staff', 'manager', 'owner'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>${u.id ? 'Reset password (leave empty to keep)' : 'Password *'}</label><input type="password" name="password" minlength="6" ${u.id ? '' : 'required'}></div>
      ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : ''}</form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="uSave">Save</button>',
    onMount: (m) => (m.el.querySelector('#uSave').onclick = async () => {
      const f = m.el.querySelector('#uForm');
      if (!f.reportValidity()) return;
      try { u.id ? await G.put(`/api/users/${u.id}`, G.formData(f)) : await G.post('/api/users', G.formData(f)); m.close(); G.toast('User saved'); G.reload(); } catch (e) { G.fail(e); }
    }),
  });
  view.querySelector('#addUser').onclick = () => form();
};

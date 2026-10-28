// Core helpers shared by every page: API, formatting, icons, UI components, charts.
const G = (window.G = {
  token: null,
  user: null,
  business: { name: 'GMS Hardware', currency: 'Rs.' },
  pages: {},
  charts: [],
});

// ---------- API ----------
G.api = async function (method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(G.token ? { Authorization: `Bearer ${G.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (res.status === 401 && G.token) { G.logout(true); throw new Error('Session expired, please sign in again'); }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Request failed (${res.status})`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
};
G.get = (u) => G.api('GET', u);
G.post = (u, b) => G.api('POST', u, b || {});
G.put = (u, b) => G.api('PUT', u, b || {});
G.del = (u) => G.api('DELETE', u);
G.qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

// ---------- formatting ----------
G.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
G.n2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
G.money = (n) => `${G.business.currency} ${G.n2(n)}`;
G.short = (n) => {
  const a = Math.abs(n || 0);
  const s = a >= 1e7 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e5 ? (a / 1e3).toFixed(0) + 'K' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0);
  return (n < 0 ? '-' : '') + s;
};
G.int = (n) => Number(n || 0).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
G.date = (s) => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
G.dt = (s) => (s ? `${G.date(s)} ${String(s).slice(11, 16)}` : '—');
G.month = (s) => { const [y, m] = s.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };
G.today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
G.monthStart = () => G.today().slice(0, 8) + '01';
G.addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
G.initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
G.can = (role) => ({ staff: 1, manager: 2, owner: 3 }[G.user?.role] || 0) >= ({ staff: 1, manager: 2, owner: 3 }[role]);
G.TYPE_LABEL = { credit: 'Credit sale', payment: 'Payment', interest: 'Interest', opening: 'Opening bal.', debit_adj: 'Debit adj.', credit_adj: 'Credit adj.' };
G.isDebit = (t) => ['credit', 'interest', 'opening', 'debit_adj'].includes(t);

// ---------- icons (stroke icons, 24x24) ----------
const IC = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  bars: '<path d="M3 21h18"/><rect x="5" y="10" width="3" height="8" rx="1"/><rect x="10.5" y="5" width="3" height="13" rx="1"/><rect x="16" y="13" width="3" height="5" rx="1"/>',
  crown: '<path d="m2 7 5 5 5-8 5 8 5-5-2 12H4z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  trending: '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2z"/>',
  sms: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5V22h16v-5"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
};
G.icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

// ---------- badges ----------
G.statusBadge = (s) => {
  const m = { active: ['good', 'Active'], blocked: ['critical', 'Blocked'], inactive: ['', 'Inactive'] }[s] || ['', s];
  return `<span class="badge ${m[0]}"><span class="dot"></span>${m[1]}</span>`;
};
G.riskBadge = (c) => {
  if (c.risk === 'good' || !c.overdue) return c.balance > 0 ? `<span class="badge good">${G.icon('check', '').replace('<svg', '<svg width="12" height="12"')} On time</span>` : '<span class="badge">Clear</span>';
  const lbl = { warning: 'Overdue', serious: 'Late 30+', critical: 'Late 90+' }[c.risk];
  return `<span class="badge ${c.risk}">${G.icon('alert').replace('<svg', '<svg width="12" height="12"')} ${lbl} · ${c.days_overdue}d</span>`;
};
G.typeBadge = (t) => {
  const cls = { credit: 'serious', payment: 'good', interest: 'critical', opening: 'info', debit_adj: 'warning', credit_adj: 'info' }[t] || '';
  return `<span class="badge ${cls}">${G.TYPE_LABEL[t] || t}</span>`;
};
G.msgStatus = (s) => `<span class="badge ${{ sent: 'good', failed: 'critical', link: 'info' }[s] || ''}">${s === 'link' ? 'WhatsApp link' : s}</span>`;
G.channelIcon = (c) => G.icon({ sms: 'sms', whatsapp: 'whatsapp', email: 'mail' }[c] || 'message');
G.utilBar = (u) => {
  if (u == null) return '<span class="muted">No limit</span>';
  const cls = u > 100 ? 'crit' : u > 80 ? 'warn' : '';
  return `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar ${cls}" style="flex:1"><i data-w="${Math.min(100, u)}"></i></div><span class="num" style="font-size:12px;min-width:42px">${Math.round(u)}%</span></div>`;
};
G.animateBars = (root) => requestAnimationFrame(() => root.querySelectorAll('.bar > i[data-w]').forEach((i) => (i.style.width = i.dataset.w + '%')));

// ---------- toasts ----------
G.toast = (msg, type = 'ok', ms = 3800) => {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`;
  el.innerHTML = `${G.icon(type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check').replace('<svg', '<svg width="18" height="18" style="flex:none;margin-top:2px"')}<div>${G.esc(msg)}</div>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
};
G.fail = (e) => G.toast(e.message || String(e), 'error', 5500);

// ---------- modal ----------
G.modal = ({ title, body, foot = '', size = '', onMount }) => {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">${G.icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  document.getElementById('modalRoot').appendChild(back);
  const close = () => { back.classList.add('closing'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const m = { el: back.querySelector('.modal'), close };
  if (onMount) onMount(m);
  const first = back.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first) setTimeout(() => first.focus(), 60);
  return m;
};
G.confirm = (message, { title = 'Please confirm', ok = 'Confirm', danger = false, input = null } = {}) =>
  new Promise((resolve) => {
    let done = false;
    const m = G.modal({
      title, size: 'narrow',
      body: `<p style="margin:0 0 6px">${message}</p>${input ? `<div class="field mt-s"><label>${input}</label><input id="confirmInput"></div>` : ''}`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="okBtn">${ok}</button>`,
      onMount: (mm) => {
        mm.el.querySelector('#okBtn').onclick = () => { done = true; resolve(input ? mm.el.querySelector('#confirmInput').value || '' : true); mm.close(); };
        mm.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => !done && resolve(false)));
      },
    });
    m.el.parentElement.addEventListener('mousedown', (e) => { if (e.target === m.el.parentElement && !done) resolve(false); });
  });

G.formData = (form) => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
};
G.busy = async (btn, fn) => {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Working…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
};

// ---------- count-up animation ----------
G.countUp = (root = document) => {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const fmt = el.dataset.fmt || 'money';
    const show = (v) => (fmt === 'money' ? G.money(v) : fmt === 'pct' ? v.toFixed(1) + '%' : G.int(Math.round(v)));
    const t0 = performance.now(), dur = 1100;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = show(target * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = show(target);
    };
    requestAnimationFrame(step);
  });
};
G.kpi = ({ label, value, fmt = 'money', icon = 'wallet', accent = 'var(--brand)', foot = '', href = '' }) =>
  `<div class="kpi ${href ? 'clickable' : ''}" style="--accent:${accent}" ${href ? `onclick="location.hash='${href}'"` : ''}>
    <div class="k-top"><span class="k-label">${label}</span><span class="k-icon">${G.icon(icon)}</span></div>
    <div class="k-value" data-count="${value}" data-fmt="${fmt}">0</div>
    <div class="k-foot">${foot}</div></div>`;

// ---------- table ----------
// columns: { key, label, align, render(row), value(row), sum: bool, fmt: 'money'|'int', csv(row) }
G.table = (container, { columns, rows, search = true, csv = null, onRow = null, pageSize = 100, sortKey = null, sortDir = 'desc', empty = 'Nothing to show yet', footer = true, tools = '' }) => {
  const state = { q: '', sortKey, sortDir, limit: pageSize };
  const val = (c, r) => (c.value ? c.value(r) : r[c.key]);
  const cellText = (c, r) => {
    if (c.csv) return c.csv(r);
    const v = val(c, r);
    return v == null ? '' : String(v);
  };
  const fmtCell = (c, r) => {
    if (c.render) return c.render(r);
    const v = val(c, r);
    if (c.fmt === 'money') return `<span class="num">${G.n2(v)}</span>`;
    if (c.fmt === 'int') return `<span class="num">${G.int(v)}</span>`;
    if (c.fmt === 'date') return `<span class="nowrap">${G.date(v)}</span>`;
    return G.esc(v ?? '');
  };
  const filtered = () => {
    let out = rows;
    if (state.q) {
      const q = state.q.toLowerCase();
      out = out.filter((r) => columns.some((c) => cellText(c, r).toLowerCase().includes(q)));
    }
    if (state.sortKey) {
      const c = columns.find((x) => x.key === state.sortKey);
      if (c) out = [...out].sort((a, b) => {
        const x = val(c, a), y = val(c, b);
        const r = typeof x === 'number' || typeof y === 'number' ? (Number(x) || 0) - (Number(y) || 0) : String(x ?? '').localeCompare(String(y ?? ''));
        return state.sortDir === 'asc' ? r : -r;
      });
    }
    return out;
  };
  container.innerHTML = `${search || csv || tools ? `<div class="table-tools">${search ? '<input type="search" placeholder="Filter rows…" class="t-search">' : ''}<span class="muted t-count" style="font-size:12.5px"></span><span class="spacer"></span>${tools}${csv ? `<button class="btn sm t-csv">${G.icon('download')} Excel / CSV</button><button class="btn sm t-print">${G.icon('printer')} Print</button>` : ''}</div>` : ''}<div class="table-wrap"><table><thead></thead><tbody></tbody><tfoot></tfoot></table></div><div class="t-more"></div>`;
  const thead = container.querySelector('thead'), tbody = container.querySelector('tbody'), tfoot = container.querySelector('tfoot');
  const draw = () => {
    const list = filtered();
    thead.innerHTML = `<tr>${columns.map((c) => `<th class="${c.sort === false ? '' : 'sortable'} ${c.align === 'right' ? 'right' : ''}" data-k="${c.key}">${c.label}${state.sortKey === c.key ? `<span class="arrow">${state.sortDir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr>`;
    tbody.innerHTML = list.length
      ? list.slice(0, state.limit).map((r, i) => `<tr data-i="${rows.indexOf(r)}" class="${onRow ? 'clickable' : ''} ${r.voided ? 'voided' : ''}">${columns.map((c) => `<td class="${c.align === 'right' ? 'right' : ''} ${c.cls || ''}">${fmtCell(c, r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}"><div class="empty">${G.icon('inbox')}${empty}</div></td></tr>`;
    const sums = columns.filter((c) => c.sum);
    tfoot.innerHTML = footer && sums.length && list.length
      ? `<tr>${columns.map((c, i) => {
        if (c.sum) { const s = list.reduce((a, r) => a + (Number(val(c, r)) || 0), 0); return `<td class="right num">${c.fmt === 'int' ? G.int(s) : G.n2(s)}</td>`; }
        return `<td>${i === 0 ? `Total (${list.length})` : ''}</td>`;
      }).join('')}</tr>` : '';
    const cnt = container.querySelector('.t-count');
    if (cnt) cnt.textContent = `${list.length} row${list.length === 1 ? '' : 's'}`;
    container.querySelector('.t-more').innerHTML = list.length > state.limit ? `<div class="row mt-s" style="justify-content:center"><button class="btn sm">Show more (${list.length - state.limit} left)</button></div>` : '';
    const mb = container.querySelector('.t-more button');
    if (mb) mb.onclick = () => { state.limit += pageSize * 2; draw(); };
    G.animateBars(container);
  };
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const k = th.dataset.k;
    state.sortDir = state.sortKey === k && state.sortDir === 'desc' ? 'asc' : 'desc';
    state.sortKey = k;
    draw();
  });
  if (onRow) tbody.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    const tr = e.target.closest('tr[data-i]');
    if (tr) onRow(rows[+tr.dataset.i]);
  });
  const s = container.querySelector('.t-search');
  if (s) s.addEventListener('input', () => { state.q = s.value.trim(); state.limit = pageSize; draw(); });
  const cb = container.querySelector('.t-csv');
  if (cb) cb.onclick = () => G.downloadCsv(csv, columns.filter((c) => c.export !== false), filtered(), cellText);
  const pb = container.querySelector('.t-print');
  if (pb) pb.onclick = () => { state.limit = 1e9; draw(); setTimeout(() => window.print(), 50); };
  draw();
  return { redraw: draw, setRows: (r) => { rows = r; draw(); } };
};
G.downloadCsv = (name, columns, rows, cellText) => {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => q(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => {
    const v = c.value ? c.value(r) : r[c.key];
    return q(c.fmt === 'money' && typeof v === 'number' ? v.toFixed(2) : cellText(c, r));
  }).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${G.today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- charts ----------
G.css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
G.series = (i) => G.css(`--s${(i % 8) + 1}`);
G.destroyCharts = () => { G.charts.forEach((c) => c.destroy()); G.charts = []; };
G.chart = (canvas, cfg) => {
  if (!window.Chart || !canvas) return null;
  const text2 = G.css('--text-2'), grid = G.css('--grid'), surface = G.css('--surface-solid');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = text2;
  const isMoney = cfg.money !== false;
  const horizontal = cfg.options?.indexAxis === 'y';
  const valueAxis = {
    beginAtZero: true, border: { display: false }, grid: { color: grid },
    ticks: { callback: (v) => (isMoney ? G.short(v) : v), maxTicksLimit: 6 },
  };
  const catAxis = { grid: { display: false }, border: { color: grid }, ticks: { autoSkip: true, maxRotation: 0 } };
  const base = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 1100, easing: 'easeOutQuart' },
    interaction: { mode: cfg.type === 'line' ? 'index' : 'nearest', intersect: cfg.type !== 'line', axis: horizontal ? 'y' : 'x' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surface, titleColor: G.css('--text'), bodyColor: text2, borderColor: G.css('--border-strong'), borderWidth: 1,
        padding: 12, cornerRadius: 10, boxPadding: 5, usePointStyle: true,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${isMoney ? G.money(ctx.parsed[horizontal ? 'x' : 'y'] ?? ctx.parsed) : ctx.formattedValue}` },
      },
    },
    scales: cfg.type === 'doughnut' ? {} : horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
  const merged = { type: cfg.type, data: cfg.data, options: deepMerge(base, cfg.options || {}) };
  const defaults = (ds, d) => { for (const [k, v] of Object.entries(d)) if (ds[k] === undefined) ds[k] = v; };
  for (const ds of merged.data.datasets) {
    if (cfg.type === 'bar') defaults(ds, { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34, borderColor: surface, borderWidth: 0 });
    if (cfg.type === 'line') defaults(ds, { borderWidth: 2, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 14, pointBackgroundColor: ds.borderColor, pointBorderColor: surface, pointBorderWidth: 2 });
  }
  const ch = new Chart(canvas, merged);
  G.charts.push(ch);
  return ch;
};
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}
G.legend = (items) => `<div class="legend">${items.map(([label, color]) => `<span><i style="background:${color}"></i>${G.esc(label)}</span>`).join('')}</div>`;
G.alpha = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
G.areaFill = (ctx, color) => {
  const { chart } = ctx;
  if (!chart.chartArea) return G.alpha(color, 0.1);
  const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
  g.addColorStop(0, G.alpha(color, 0.28));
  g.addColorStop(1, G.alpha(color, 0));
  return g;
};
// ordinal ramp for aging buckets (light -> dark on one hue)
G.AGING_COLORS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

// ---------- shared option lists ----------
G.loadLookups = async () => {
  [G.areas, G.creditTypes] = await Promise.all([G.get('/api/areas'), G.get('/api/credit-types')]);
};
G.areaOptions = (sel, any = 'All areas') => `${any ? `<option value="">${any}</option>` : ''}${(G.areas || []).map((a) => `<option value="${a.id}" ${String(sel) === String(a.id) ? 'selected' : ''}>${G.esc(a.name)}</option>`).join('')}`;
G.typeOptions = (sel, any = 'All credit types') => `${any ? `<option value="">${any}</option>` : ''}${(G.creditTypes || []).map((t) => `<option value="${t.id}" ${String(sel) === String(t.id) ? 'selected' : ''}>${G.esc(t.name)}</option>`).join('')}`;

// page header used inside views
G.head = (title, sub, actions = '') => {
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSub').textContent = sub || '';
  document.title = `${title} · ${G.business.name}`;
  return actions ? `<div class="row between mb no-print"><div class="muted">${G.esc(sub || '')}</div><div class="row">${actions}</div></div>` : '';
};
G.printHead = (title, sub) => `<div class="print-only print-head"><h1>${G.esc(G.business.name)}</h1><div><b>${G.esc(title)}</b> ${sub ? '· ' + G.esc(sub) : ''} · Printed ${G.date(G.today())}</div></div>`;

// button ripple
document.addEventListener('click', (e) => {
  const b = e.target.closest('.btn');
  if (!b) return;
  const r = document.createElement('span');
  const rect = b.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  r.className = 'ripple';
  r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  b.appendChild(r);
  setTimeout(() => r.remove(), 600);
});

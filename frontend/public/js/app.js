// App shell: login, navigation, router, global search and quick actions.
(function () {
  const NAV = [
    ['Overview'],
    ['#/dashboard', 'Dashboard', 'dashboard'],
    ['#/customers', 'Customers', 'users'],
    ['#/transactions', 'Transactions', 'list'],
    ['Collections'],
    ['#/overdue', 'Overdue & Follow-up', 'alert', null, 'overdueBadge'],
    ['#/messages', 'Messaging Center', 'message'],
    ['Insights'],
    ['#/reports', 'Reports', 'bars'],
    ['#/owner', 'Owner Reports', 'crown', 'owner'],
    ['Setup'],
    ['#/areas', 'Areas', 'map'],
    ['#/credit-types', 'Credit Types', 'tag'],
    ['#/settings', 'Settings', 'settings', 'manager'],
    ['#/users', 'Users & Security', 'shield', 'owner'],
  ];

  const ROUTES = [
    [/^#\/dashboard$/, 'dashboard'],
    [/^#\/customers(?:\?(.*))?$/, 'customers'],
    [/^#\/customers\/(\d+)$/, 'customer'],
    [/^#\/transactions$/, 'transactions'],
    [/^#\/overdue$/, 'overdue'],
    [/^#\/messages$/, 'messages'],
    [/^#\/reports$/, 'reports'],
    [/^#\/reports\/([\w-]+)(?:\/(\d+))?$/, 'report'],
    [/^#\/owner$/, 'owner'],
    [/^#\/areas$/, 'areas'],
    [/^#\/credit-types$/, 'creditTypes'],
    [/^#\/settings$/, 'settings'],
    [/^#\/users$/, 'users'],
  ];

  const $ = (id) => document.getElementById(id);

  function renderNav() {
    $('nav').innerHTML = NAV.filter((n) => !n[3] || G.can(n[3])).map((n) =>
      n.length === 1 ? `<div class="nav-group">${n[0]}</div>`
        : `<a class="nav-link" href="${n[0]}">${G.icon(n[2])}<span>${n[1]}</span>${n[4] ? `<span class="nav-badge hidden" id="${n[4]}"></span>` : ''}</a>`).join('');
    $('userChip').innerHTML = `<div class="avatar">${G.initials(G.user.full_name)}</div><div class="user-text"><div class="user-name">${G.esc(G.user.full_name)}</div><div class="role-pill">${G.user.role}</div></div>`;
    $('brandName').textContent = G.business.name;
  }

  async function route() {
    const hash = location.hash || '#/dashboard';
    let page = null, params = [];
    for (const [re, name] of ROUTES) {
      const m = hash.match(re);
      if (m) { page = name; params = m.slice(1); break; }
    }
    if (!page) { location.hash = '#/dashboard'; return; }
    document.querySelectorAll('.nav-link').forEach((a) => {
      const href = a.getAttribute('href'), base = hash.split('?')[0];
      a.classList.toggle('active', base === href || (href !== '#/dashboard' && base.startsWith(href + '/')));
    });
    $('sidebar').classList.remove('open');
    $('scrim').classList.remove('open');
    G.destroyCharts();
    const view = $('view');
    view.innerHTML = `<div class="kpis">${'<div class="skeleton" style="height:118px"></div>'.repeat(4)}</div><div class="skeleton mt" style="height:320px"></div>`;
    window.scrollTo({ top: 0 });
    try {
      await G.pages[page](view, ...params);
      G.countUp(view);
      G.animateBars(view);
    } catch (e) {
      view.innerHTML = `<div class="card"><div class="empty">${G.icon('alert')}<b>Could not load this page</b><br>${G.esc(e.message)}</div></div>`;
    }
  }
  G.reload = route;

  async function start() {
    try {
      const me = await G.get('/api/auth/me');
      G.user = me.user;
      G.business = me.business;
    } catch (e) { return showLogin(); }
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    await G.loadLookups();
    renderNav();
    refreshBadges();
    route();
  }

  async function refreshBadges() {
    try {
      const rows = await G.get('/api/customers?filter=overdue');
      const b = $('overdueBadge');
      if (b) { b.textContent = rows.length; b.classList.toggle('hidden', !rows.length); }
    } catch (e) { /* ignore */ }
  }
  G.refreshBadges = refreshBadges;

  function showLogin() {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
  }
  G.logout = async (silent) => {
    if (!silent) try { await G.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    G.token = null;
    try { localStorage.removeItem('gms-token'); } catch (e) { /* ignore */ }
    showLogin();
  };

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = G.formData(e.target);
    try {
      const r = await G.post('/api/auth/login', f);
      G.token = r.token;
      try { localStorage.setItem('gms-token', r.token); } catch (err) { /* ignore */ }
      e.target.reset();
      start();
    } catch (err) {
      e.target.classList.remove('shake');
      void e.target.offsetWidth;
      e.target.classList.add('shake');
      G.fail(err);
    }
  });

  // ---------- topbar ----------
  $('menuBtn').innerHTML = G.icon('menu');
  $('logoutBtn').innerHTML = G.icon('logout');
  $('quickCredit').innerHTML = `${G.icon('receipt')}<span class="lbl">Credit Sale</span>`;
  $('quickPay').innerHTML = `${G.icon('cash')}<span class="lbl">Payment</span>`;
  const setThemeIcon = () => ($('themeBtn').innerHTML = G.icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  setThemeIcon();
  $('themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('gms-theme', t); } catch (e) { /* ignore */ }
    setThemeIcon();
    route();
  };
  $('logoutBtn').onclick = () => G.logout();
  $('menuBtn').onclick = () => { $('sidebar').classList.add('open'); $('scrim').classList.add('open'); };
  $('scrim').onclick = () => { $('sidebar').classList.remove('open'); $('scrim').classList.remove('open'); };
  $('quickCredit').onclick = () => G.entryModal('credit');
  $('quickPay').onclick = () => G.entryModal('payment');
  $('userChip').onclick = () => G.passwordModal();

  // global customer search
  const gs = $('globalSearch'), sr = $('searchResults');
  let timer, hl = -1;
  gs.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = gs.value.trim();
      if (!q) { sr.classList.remove('open'); return; }
      const rows = (await G.get('/api/customers?' + G.qs({ q }))).slice(0, 8);
      hl = -1;
      sr.innerHTML = rows.length
        ? rows.map((c) => `<a href="#/customers/${c.id}"><span><b>${G.esc(c.name)}</b> <span class="muted">${G.esc(c.code)} · ${G.esc(c.area_name || '')}</span></span><span class="num ${c.overdue > 0 ? 'type-interest' : ''}">${G.money(c.balance)}</span></a>`).join('')
        : '<div class="empty" style="padding:16px">No customer found</div>';
      sr.classList.add('open');
    }, 180);
  });
  gs.addEventListener('keydown', (e) => {
    const items = [...sr.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter' && items.length) {
      location.hash = items[Math.max(0, hl)].getAttribute('href');
      sr.classList.remove('open'); gs.value = ''; gs.blur();
    } else if (e.key === 'Escape') { sr.classList.remove('open'); gs.blur(); }
  });
  sr.addEventListener('click', () => { sr.classList.remove('open'); gs.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.top-search')) sr.classList.remove('open'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); gs.focus(); }
  });

  G.passwordModal = () => G.modal({
    title: 'My account', size: 'narrow',
    body: `<p class="muted" style="margin-top:0">${G.esc(G.user.full_name)} · ${G.user.username} · <b>${G.user.role}</b></p>
      <form id="pwForm" class="grid"><div class="field"><label>Current password</label><input type="password" name="current" required></div>
      <div class="field"><label>New password</label><input type="password" name="next" minlength="6" required></div></form>`,
    foot: '<button class="btn" data-close>Close</button><button class="btn primary" id="pwSave">Change password</button>',
    onMount: (m) => {
      m.el.querySelector('#pwSave').onclick = async () => {
        const f = m.el.querySelector('#pwForm');
        if (!f.reportValidity()) return;
        try { await G.post('/api/auth/password', G.formData(f)); G.toast('Password changed'); m.close(); } catch (e) { G.fail(e); }
      };
    },
  });

  window.addEventListener('hashchange', route);
  try { G.token = localStorage.getItem('gms-token'); } catch (e) { /* ignore */ }
  if (G.token) start(); else showLogin();
})();

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
    ['#/settings', 'Settings', 'settings'],
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
    [/^#\/settings(?:\/([\w-]+))?$/, 'settings'],
    [/^#\/users$/, 'users'],
  ];

  const $ = (id) => document.getElementById(id);

  function renderNav() {
    $('nav').innerHTML = NAV.filter((n) => !n[3] || G.can(n[3])).map((n) =>
      n.length === 1 ? `<div class="nav-group">${n[0]}</div>`
        : `<a class="nav-link" href="${n[0]}">${G.icon(n[2])}<span>${n[1]}</span>${n[4] ? `<span class="nav-badge hidden" id="${n[4]}"></span>` : ''}</a>`).join('');
    renderUser();
  }
  // the account button and the business name in the menu bar (redrawn after My account or business details change)
  function renderUser() {
    $('userChip').innerHTML = `<div class="avatar">${G.initials(G.user.full_name)}</div><div class="user-text"><div class="user-name">${G.esc(G.user.full_name)}</div><div class="role-pill">${G.user.role}</div></div>${G.icon('settings', 'uc-icon')}`;
    $('brandName').textContent = G.business.name;
  }
  G.renderUser = renderUser;

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
  $('quickCredit').innerHTML = `${G.icon('receipt')}<span class="lbl">Credit Sale</span>`;
  $('quickPay').innerHTML = `${G.icon('cash')}<span class="lbl">Payment</span>`;
  $('menuBtn').onclick = () => { $('sidebar').classList.add('open'); $('scrim').classList.add('open'); };
  $('scrim').onclick = () => { $('sidebar').classList.remove('open'); $('scrim').classList.remove('open'); };
  $('quickCredit').onclick = () => G.entryModal('credit');
  $('quickPay').onclick = () => G.entryModal('payment');

  // ---------- account menu: the account button at the foot of the menu bar ----------
  const userMenu = $('userMenu'), chip = $('userChip');
  const syncTheme = () => userMenu.querySelectorAll('[data-theme-set]').forEach((b) => {
    const on = b.dataset.themeSet === document.documentElement.dataset.theme;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  G.setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('gms-theme', t); } catch (e) { /* ignore */ }
    syncTheme();
    route(); // redraw the charts in the new colours
  };
  const openMenu = (open) => {
    userMenu.classList.toggle('hidden', !open);
    chip.setAttribute('aria-expanded', open);
    $('sidebar').classList.toggle('menu-open', open); // keeps the menu bar unfolded while the account menu shows
  };
  userMenu.querySelector('[data-theme-set="light"]').innerHTML = `${G.icon('sun')} Light`;
  userMenu.querySelector('[data-theme-set="dark"]').innerHTML = `${G.icon('moon')} Dark`;
  $('accountLink').innerHTML = `${G.icon('user')} Account settings`;
  $('logoutItem').innerHTML = `${G.icon('logout')} Log out`;
  syncTheme();
  chip.onclick = () => openMenu(userMenu.classList.contains('hidden'));
  chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.click(); } };
  userMenu.onclick = (e) => {
    const t = e.target.closest('[data-theme-set]');
    if (t) return G.setTheme(t.dataset.themeSet);
    if (e.target.closest('#accountLink')) openMenu(false);
    if (e.target.closest('#logoutItem')) { openMenu(false); G.logout(); }
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.side-foot')) openMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMenu(false); });
  $('sidebar').addEventListener('mouseleave', () => openMenu(false)); // the menu bar folds back to icons

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

  window.addEventListener('hashchange', route);
  try { G.token = localStorage.getItem('gms-token'); } catch (e) { /* ignore */ }
  if (G.token) start(); else showLogin();
})();

(function () {
  'use strict';

  /* ---------- constants ---------- */
  var TILE_COLORS = ['#AC83C6', '#D889AC', '#A995CD', '#CC8BBE', '#B895CF', '#DCA1BA', '#9F88BF', '#C99ACF'];
  var BRACKETS = [
    { label: 'Under ₹1,000', min: '', max: 999 },
    { label: '₹1,000 – 2,500', min: 1000, max: 2500 },
    { label: '₹2,500 – 5,000', min: 2500, max: 5000 },
    { label: '₹5,000 and above', min: 5000, max: '' }
  ];
  var HANGER = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 14a5 5 0 1 1 5 5c-3 1-5 3-5 6v3M32 28 8 44a3 3 0 0 0 2 5.5h44a3 3 0 0 0 2-5.5L32 28z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>';

  /* ---------- helpers ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
        else e.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(parent, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(parent, k); }); return; }
    parent.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function svgEl(markup) { var t = document.createElement('template'); t.innerHTML = markup; return t.content.firstChild; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function rupee(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function img(id) { return '/img/' + id; }
  function slug(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newest(a, b) { return Date.parse(b.created) - Date.parse(a.created); }
  function tint(id) { var n = 0; for (var i = 0; i < id.length; i++) n += id.charCodeAt(i); return TILE_COLORS[n % TILE_COLORS.length]; }
  function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  function api(method, url, body, signal) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (signal) opt.signal = signal;
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  /* ---------- state ---------- */
  var state = { settings: { tagline: '', whatsapp: '' }, categories: [], items: [] };
  var ui = { q: '', min: '', max: '', sort: 'new', tab: 'items' };
  var isAdmin = false, loaded = false, loadError = '';
  var els = {}, route = null, lastKey = null, curRefresh = null;

  function catById(id) { for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i]; return null; }
  function itemById(id) { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i]; return null; }
  function isNew(it) { return (Date.now() - Date.parse(it.created)) < 21 * 864e5; }

  function reload(keep) {
    return api('GET', '/api/store').then(function (d) {
      state = d; loaded = true; loadError = '';
      if (els.main) render(keep !== false);
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, bad) {
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (bad ? ' bad' : '');
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, bad ? 7000 : 3500);
  }

  function headerIcon(name) {
    var paths = {
      heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      studio: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      logout: '<path d="M9 4H4v16h5M14 8l4 4-4 4m-6-4h13"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2m-8 3h2"/>'
    };
    return svgEl('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths[name] + '</svg>');
  }

  /* ---------- shell ---------- */
  function build() {
    var app = document.getElementById('app');
    clear(app);
    els.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
    els.adminLogin = h('a', { class: 'header-icon', href: '#admin', 'aria-label': 'Admin login', title: 'Admin login' }, headerIcon('user'));
    els.wishlist = h('a', { class: 'header-icon', href: '#wishlist', 'aria-label': 'Wishlist', title: 'Wishlist' }, headerIcon('heart'));
    els.calendar = h('a', { class: 'header-icon', href: '#diary', 'aria-label': 'Diary calendar', title: 'Diary calendar', hidden: true }, headerIcon('calendar'));
    els.manage = h('button', { class: 'header-icon', type: 'button', hidden: true, 'aria-label': 'Manage store', title: 'Manage store', onclick: function () { ui.tab = 'items'; location.hash = route && route.name === 'admin' ? 'home' : 'admin'; } }, headerIcon('studio'));
    els.logout = h('button', { class: 'header-icon', type: 'button', hidden: true, 'aria-label': 'Log out', title: 'Log out', onclick: function () {
      els.logout.disabled = true;
      api('POST', '/api/logout').then(function () {
        isAdmin = false; diaryState.cache = {}; wishlist.entries = null; wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' };
        location.hash = 'home';
        render(true);
      }).catch(function (e) {
        els.logout.disabled = false;
        toast(e.message, true);
      });
    } });
    els.logout.appendChild(headerIcon('logout'));
    els.search = h('input', {
      type: 'search', id: 'q', placeholder: 'Search pieces', 'aria-label': 'Search pieces',
      oninput: function () {
        ui.q = els.search.value;
        if (!route || route.name !== 'search') location.hash = 'search';
        else if (curRefresh) curRefresh();
      }
    });
    var masthead = h('header', { class: 'masthead' },
      h('a', { class: 'wordmark', href: '#home', 'aria-label': 'Aakriti’s Wardrobe — home' }, h('img', { class: 'site-logo', src: '/logo.png', alt: '' }), h('span', { text: 'Aakriti’s Wardrobe' })),
      h('div', { class: 'head-tools' }, h('div', { class: 'search' }, svgEl('<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>'), els.search), els.adminLogin, els.wishlist, els.calendar, els.manage, els.logout));
    els.navList = h('ul');
    els.nav = h('nav', { class: 'catnav', 'aria-label': 'Categories' }, els.navList);
    els.main = h('main');
    els.foot = h('footer', { class: 'foot' });
    els.editor = h('dialog', { id: 'editor', 'aria-label': 'Item editor' });
    app.appendChild(h('div', { class: 'wrap' }, masthead, els.nav, els.main, els.foot));
    app.appendChild(els.editor);
    app.appendChild(els.toast);
    document.addEventListener('click', function (ev) {
      var other = els.navList.querySelector('.nav-other');
      if (other && !other.contains(ev.target)) other.open = false;
    });
    window.addEventListener('resize', function () {
      var other = els.navList.querySelector('.nav-other');
      if (other) other.open = false;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { var other = els.navList.querySelector('.nav-other'); if (other && other.open) { other.open = false; other.querySelector('summary').focus(); } }
      if (ev.key === 'Escape' && document.body.classList.contains('filters-open')) document.body.classList.remove('filters-open');
    });
  }

  function renderNav() {
    clear(els.navList);
    var cur = '';
    if (route.name === 'cat') cur = 'c-' + route.id;
    else if (route.name === 'item') { var it = itemById(route.id); if (it) cur = 'c-' + it.cat; }
    else if (route.name === 'home') cur = 'home';
    var standard = ['lingerie', 'layering', 'topwear', 'bottomwear', 'dresses', 'nightwear', 'activewear', 'footwear'];
    var primary = state.categories.filter(function (c) { return standard.indexOf(c.id) !== -1; });
    var extra = state.categories.filter(function (c) { return standard.indexOf(c.id) === -1; });
    function categoryNav(c) {
      var group = h('div', { class: 'nav-category' });
      group.appendChild(h('a', { href: '#c-' + c.id, text: c.name, 'aria-current': cur === 'c-' + c.id ? 'page' : null }));
      if (!(c.subcategories || []).length) return group;
      var menu = h('div', { class: 'subcategory-menu', hidden: true }, c.subcategories.map(function (sub) {
        return h('a', { href: '#c-' + c.id + '?sub=' + encodeURIComponent(sub.id), text: sub.name,
          'aria-current': route.name === 'cat' && route.id === c.id && route.subcat === sub.id ? 'page' : null,
          onclick: function () { close(); var other = els.navList.querySelector('.nav-other'); if (other) other.open = false; } });
      }));
      function close() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
      function open() {
        var rect = group.getBoundingClientRect();
        menu.style.top = rect.bottom + 'px';
        menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 248)) + 'px';
        menu.style.maxHeight = Math.max(80, window.innerHeight - rect.bottom - 16) + 'px';
        menu.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      }
      var toggle = h('button', { class: 'subcategory-toggle', type: 'button', text: '⌄', 'aria-label': 'Show subcategories for ' + c.name, 'aria-expanded': 'false',
        onclick: function () { if (menu.hidden) open(); else close(); } });
      group.appendChild(toggle); group.appendChild(menu);
      group.addEventListener('mouseenter', open);
      group.addEventListener('mouseleave', close);
      group.addEventListener('focusin', open);
      group.addEventListener('focusout', function (ev) { if (!group.contains(ev.relatedTarget)) close(); });
      group.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { toggle.focus(); close(); ev.stopPropagation(); } });
      return group;
    }
    els.navList.appendChild(h('li', null, h('a', { href: '#home', 'aria-label': 'Home', title: 'Home', 'aria-current': cur === 'home' ? 'page' : null },
      svgEl('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/></svg>'))));
    primary.forEach(function (c) { els.navList.appendChild(h('li', null, categoryNav(c))); });
    if (extra.length) {
      var active = extra.some(function (c) { return cur === 'c-' + c.id; });
      var menu = h('div', { class: 'other-menu' }, extra.map(function (c) {
        return categoryNav(c);
      }));
      var dropdown = h('details', { class: 'nav-other', ontoggle: function () {
        if (!dropdown.open) return;
        var rect = dropdown.getBoundingClientRect();
        menu.style.top = (rect.bottom + 6) + 'px';
        menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 232)) + 'px';
        menu.style.maxHeight = Math.max(80, window.innerHeight - rect.bottom - 24) + 'px';
      } }, h('summary', { class: active ? 'other-active' : '', text: 'Other', 'aria-label': 'Other categories' }), menu);
      els.navList.appendChild(h('li', null, dropdown));
    }
  }

  function renderFoot() {
    clear(els.foot);
    els.foot.appendChild(h('span', null, '© ' + new Date().getFullYear() + ' Aakriti’s Wardrobe'));
  }

  /* ---------- routing ---------- */
  function parseRoute() {
    var t = (location.hash || '').replace(/^#/, '');
    if (t.indexOf('p-') === 0) return { name: 'item', id: t.slice(2), token: t };
    if (t.indexOf('c-') === 0) { var parts = t.slice(2).split('?'); return { name: 'cat', id: parts[0], subcat: new URLSearchParams(parts[1] || '').get('sub') || '', token: t }; }
    if (t === 'new' || t === 'search' || t === 'admin' || t === 'wishlist' || t === 'diary') return { name: t, token: t };
    return { name: 'home', token: 'home' };
  }

  function render(keep) {
    route = parseRoute();
    var changed = route.token !== lastKey;
    if (changed) {
      ui.min = ''; ui.max = ''; ui.sort = 'new';
      if (route.name !== 'search') { ui.q = ''; els.search.value = ''; }
      document.body.classList.remove('filters-open');
    }
    lastKey = route.token;
    renderNav(); renderFoot();
    clear(els.main);
    curRefresh = null;
    var node;
    if (!loaded) node = loadError ? h('div', { class: 'empty' }, h('h2', { text: 'Could not load the wardrobe' }), h('p', { text: loadError }), h('button', { class: 'btn primary', type: 'button', text: 'Try again', onclick: function () { location.reload(); } })) : h('p', { class: 'boot', text: 'Loading…' });
    else if (route.name === 'item') node = pageItem(itemById(route.id));
    else if (route.name === 'cat') {
      var c = catById(route.id);
      node = c ? pageList({ name: 'cat', title: c.name, subcategories: c.subcategories || [], crumbs: [['Home', '#home'], [c.name]], base: function () { return state.items.filter(function (i) { return i.cat === c.id; }); }, emptyText: 'Nothing in ' + c.name + ' yet. Check back soon.' })
        : pageMessage('That category isn’t here', 'Pick one from the menu above.');
    } else if (route.name === 'new') node = pageList({ name: 'new', title: 'New arrivals', crumbs: [['Home', '#home'], ['New arrivals']], base: function () { return state.items; }, emptyText: 'New pieces are on their way.' });
    else if (route.name === 'search') node = pageList({ name: 'search', title: 'Search', crumbs: [['Home', '#home'], ['Search']], base: function () { return state.items; }, emptyText: 'Nothing matches that search.' });
    else if (route.name === 'admin' || route.name === 'wishlist') {
      if (route.name === 'wishlist') ui.tab = 'wishlist';
      if (route.name === 'wishlist' && !isAdmin) {
        node = h('section', { class: 'public-wishlist' }, h('p', { class: 'eyebrow', text: 'SOMETHING FOR LATER' }), h('h1', { text: 'Aakriti’s wishlist' }), h('p', { class: 'studio-description', text: 'A little collection of things I’m thinking about.' }));
        adminWishlist(node);
      } else node = isAdmin ? pageAdmin() : pageLogin();
    }
    else if (route.name === 'diary') node = isAdmin ? pageDiary() : pageLogin();
    else node = pageHome();
    els.main.appendChild(node);
    document.body.classList.toggle('on-home', route.name === 'home');
    document.body.classList.toggle('on-login', !!els.main.querySelector('.studio-login'));
    document.body.classList.toggle('on-item', route.name === 'item');
    document.body.classList.toggle('on-diary', route.name === 'diary' && isAdmin);
    document.body.classList.toggle('on-list', ['cat', 'new', 'search'].indexOf(route.name) !== -1);
    els.adminLogin.hidden = isAdmin;
    els.manage.hidden = !isAdmin;
    els.wishlist.hidden = false;
    els.wishlist.setAttribute('aria-current', route.name === 'wishlist' ? 'page' : 'false');
    els.calendar.hidden = !isAdmin;
    els.calendar.setAttribute('aria-current', route.name === 'diary' ? 'page' : 'false');
    els.manage.setAttribute('aria-label', route.name === 'admin' ? 'View store' : 'Manage store');
    els.manage.title = route.name === 'admin' ? 'View store' : 'Manage store';
    els.logout.hidden = !isAdmin;
    els.logout.disabled = false;
    document.title = pageTitle();
    if (changed && !keep) window.scrollTo(0, 0);
  }

  function pageTitle() {
    var base = 'Aakriti’s Wardrobe';
    if (!loaded) return base;
    if (route.name === 'item') { var it = itemById(route.id); return it ? it.name + ' · ' + base : base; }
    if (route.name === 'cat') { var c = catById(route.id); return c ? c.name + ' · ' + base : base; }
    if (route.name === 'new') return 'New arrivals · ' + base;
    if (route.name === 'wishlist') return 'Wishlist · ' + base;
    if (route.name === 'diary') return 'Diary calendar · ' + base;
    return base;
  }

  function pageMessage(title, text) {
    return h('div', { class: 'empty' }, h('h2', { text: title }), h('p', { text: text }), h('a', { class: 'btn primary', href: '#home', text: 'Back to home' }));
  }

  function crumbs(list) {
    var nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    list.forEach(function (c, i) {
      if (i) nav.appendChild(h('span', { 'aria-hidden': 'true', text: '/' }));
      nav.appendChild(c[1] ? h('a', { href: c[1], text: c[0] }) : h('span', { text: c[0], 'aria-current': 'page' }));
    });
    return nav;
  }

  /* ---------- cards ---------- */
  function placeholder(it, small) {
    var d = h('div', { class: 'ph' }, svgEl(HANGER), small ? null : h('small', { text: 'Photo coming soon' }));
    d.style.setProperty('--ph', tint(it.id));
    return d;
  }
  function media(it) {
    var m = h('div', { class: 'media' });
    if (it.images.length) {
      m.appendChild(h('img', { src: img(it.images[0]), alt: it.name, loading: 'lazy', decoding: 'async' }));
      if (it.images[1]) m.appendChild(h('img', { class: 'alt', src: img(it.images[1]), alt: '', loading: 'lazy', decoding: 'async' }));
    } else m.appendChild(placeholder(it));
    return m;
  }
  function card(it) {
    var c = catById(it.cat);
    var subcategory = c && (c.subcategories || []).find(function (sub) { return sub.id === it.subcat; });
    var label = route.name === 'cat' ? (subcategory ? subcategory.name : '') : (c ? c.name : 'Uncategorised');
    var art = h('article', { class: 'card' },
      h('a', { class: 'card-main', href: '#p-' + it.id },
        media(it),
        h('div', { class: 'card-info' },
          label ? h('span', { class: 'cat', text: label }) : null,
          h('h3', { text: it.name }),
          h('div', { class: 'price' }, h('b', { text: rupee(it.price) })))));
    if (isAdmin) art.appendChild(h('button', { class: 'btn sm edit-pill', type: 'button', onclick: function () { openEditor(it); }, text: 'Edit' }));
    return art;
  }

  /* ---------- home ---------- */
  function pageHome() {
    var exploreHref = state.categories[0] ? '#c-' + state.categories[0].id : '#new';
    return h('section', { class: 'home-hero' },
      h('div', { class: 'hero-atmosphere', 'aria-hidden': 'true' },
        h('span', { class: 'silk silk-one' }), h('span', { class: 'silk silk-two' }), h('span', { class: 'silk silk-three' })),
      h('div', { class: 'home-intro' },
        h('p', { class: 'hero-eyebrow', text: 'A PRIVATE EDIT · AAKRITI’S WARDROBE' }),
        h('h1', null, 'A little world,', h('em', { text: ' entirely mine.' })),
        h('p', { class: 'lead', text: state.settings.tagline || 'The pieces I love. The details I keep coming back to. A personal wardrobe, thoughtfully collected.' }),
        h('a', { class: 'btn primary hero-cta', href: exploreHref }, 'Explore my wardrobe', h('span', { 'aria-hidden': 'true', text: '→' }))),
      h('div', { class: 'hero-index' },
        h('a', { class: 'about-aakriti', href: 'https://beingaakriti.in', target: '_blank', rel: 'noopener noreferrer' }, 'About Aakriti ', h('span', { 'aria-hidden': 'true', text: '→' })),
        h('span', { text: 'THE PERSONAL COLLECTION / A.W.' })));
  }

  /* ---------- list pages ---------- */
  function pageList(o) {
    var f = document.createDocumentFragment();
    var catalogHeading = h('header', { class: 'catalog-heading' }, crumbs(o.crumbs.slice(0, -1)));
    f.appendChild(catalogHeading);
    var subEl = h('p');
    var selectedSubcategory = o.name === 'cat' && (o.subcategories || []).some(function (s) { return s.id === route.subcat; }) ? route.subcat : '';
    var subcategoryFilter = o.subcategories && o.subcategories.length ? h('select', {
      class: 'subcat-filter',
      'aria-label': 'Filter by subcategory',
      onchange: function () { selectedSubcategory = subcategoryFilter.value; refresh(); }
    }, h('option', { value: '', text: 'All subcategories' }), o.subcategories.map(function (s) {
      return h('option', { value: s.id, text: s.name, selected: s.id === selectedSubcategory });
    })) : null;
    catalogHeading.appendChild(h('div', { class: 'list-head category-heading' }, h('h2', { text: o.title }), subEl));

    var count = h('p', { class: 'count', 'aria-live': 'polite' });
    catalogHeading.appendChild(count);
    var active = h('div', { class: 'active' });
    var grid = h('div', { class: 'grid' });
    var badge = h('span', { class: 'badge-n', hidden: true });
    var filterPanel = h('aside', { class: 'filters', 'aria-label': 'Price filter' });
    var filterMenu = h('details', { class: 'filter-dropdown' },
      h('summary', { class: 'btn', text: 'Filters ' }, badge),
      filterPanel);
    var sort = h('select', { class: 'sort', id: 'sort', 'aria-label': 'Sort pieces', onchange: function () { ui.sort = sort.value; refresh(); } },
      h('option', { value: 'new', text: 'Newest first' }),
      h('option', { value: 'low', text: 'Price: low to high' }),
      h('option', { value: 'high', text: 'Price: high to low' }),
      h('option', { value: 'name', text: 'Name: A to Z' }));
    sort.value = ui.sort;

    function visible() {
      var q = ui.q.trim().toLowerCase();
      var min = ui.min === '' ? null : Number(ui.min), max = ui.max === '' ? null : Number(ui.max);
      var out = o.base().filter(function (it) {
        if (selectedSubcategory && it.subcat !== selectedSubcategory) return false;
        if (q) { var c = catById(it.cat); if ((it.name + ' ' + (c ? c.name : '')).toLowerCase().indexOf(q) < 0) return false; }
        if (min != null && it.price < min) return false;
        if (max != null && it.price > max) return false;
        return true;
      });
      out.sort(function (a, b) {
        if (ui.sort === 'low') return a.price - b.price;
        if (ui.sort === 'high') return b.price - a.price;
        if (ui.sort === 'name') return a.name.localeCompare(b.name);
        return newest(a, b);
      });
      return out;
    }

    function buildFilters() {
      clear(filterPanel);
      var minIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, id: 'pmin', placeholder: 'Min', 'aria-label': 'Minimum price', value: ui.min, oninput: function () { ui.min = minIn.value; refresh(); } });
      var maxIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, id: 'pmax', placeholder: 'Max', 'aria-label': 'Maximum price', value: ui.max, oninput: function () { ui.max = maxIn.value; refresh(); } });
      var prices = o.base().map(function (i) { return i.price; });
      var range = prices.length ? 'Pieces here range from ' + rupee(Math.min.apply(null, prices)) + ' to ' + rupee(Math.max.apply(null, prices)) + '.' : '';
      filterPanel.appendChild(h('div', { class: 'filter-panel-head' }, h('b', { text: 'Price range' }),
        h('button', { class: 'link', type: 'button', text: 'Clear', onclick: function () { ui.min = ''; ui.max = ''; buildFilters(); refresh(); } })));
      filterPanel.appendChild(h('div', { class: 'f-body' },
        BRACKETS.map(function (b) {
          var on = String(ui.min) === String(b.min) && String(ui.max) === String(b.max);
          return h('button', { class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: b.label, onclick: function () {
            if (on) { ui.min = ''; ui.max = ''; } else { ui.min = b.min; ui.max = b.max; }
            buildFilters(); refresh();
          } });
        }),
        h('div', { class: 'price-row' }, minIn, h('span', { text: 'to' }), maxIn),
        range ? h('p', { class: 'hint', text: range }) : null));
    }

    function refresh() {
      var list = visible();
      clear(grid);
      list.forEach(function (it) { grid.appendChild(card(it)); });
      var n = list.length + (list.length === 1 ? ' piece' : ' pieces');
      count.textContent = n;
      if (o.name === 'search') subEl.textContent = ui.q.trim() ? 'Results for “' + ui.q.trim() + '”' : 'All pieces';
      var on = ui.min !== '' || ui.max !== '';
      badge.hidden = !on; badge.textContent = on ? '1' : '';
      clear(active);
      if (selectedSubcategory && subcategoryFilter) {
        var selectedOption = subcategoryFilter.options[subcategoryFilter.selectedIndex];
        active.appendChild(h('button', { class: 'pill', type: 'button', 'aria-label': 'Remove subcategory filter', onclick: function () { selectedSubcategory = ''; subcategoryFilter.value = ''; refresh(); } }, selectedOption.textContent, h('span', { 'aria-hidden': 'true', text: '×' })));
      }
      if (on) {
        var l = ui.min !== '' && ui.max !== '' ? rupee(ui.min) + ' – ' + rupee(ui.max) : ui.min !== '' ? rupee(ui.min) + ' and above' : 'Under ' + rupee(Number(ui.max) + 1);
        active.appendChild(h('button', { class: 'pill', type: 'button', 'aria-label': 'Remove price filter', onclick: function () { ui.min = ''; ui.max = ''; buildFilters(); refresh(); } }, l, h('span', { 'aria-hidden': 'true', text: '×' })));
      }
      if (!list.length) {
        grid.style.display = 'block';
        var anyBase = o.base().length > 0;
        grid.appendChild(h('div', { class: 'empty' },
          h('h2', { text: anyBase ? 'Nothing matches yet' : 'Nothing here yet' }),
          h('p', { text: anyBase ? 'Try another subcategory, price range or search.' : o.emptyText }),
          anyBase ? h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { ui.min = ''; ui.max = ''; selectedSubcategory = ''; if (subcategoryFilter) subcategoryFilter.value = ''; if (o.name === 'search') { ui.q = ''; els.search.value = ''; } buildFilters(); refresh(); } })
            : (isAdmin ? h('button', { class: 'btn primary', type: 'button', text: 'Add an item', onclick: function () { openEditor(null, route.name === 'cat' ? route.id : null); } }) : null)));
      } else grid.style.display = '';
    }

    f.appendChild(h('div', { class: 'shop nofilter' },
      h('section', { class: 'results', 'aria-label': 'Pieces' },
        h('div', { class: 'toolbar' }, h('div', { class: 'tb-right' },
          subcategoryFilter, sort, filterMenu)),
        active, grid)));
    buildFilters(); refresh();
    curRefresh = refresh;
    return f;
  }

  /* ---------- item page ---------- */
  function pageItem(it) {
    if (!it) return pageMessage('This piece isn’t available', 'It may have been removed. Browse the categories to see what’s in.');
    var f = document.createDocumentFragment();
    var c = catById(it.cat);
    f.appendChild(crumbs([['Home', '#home'], c ? [c.name, '#c-' + c.id] : ['Uncategorised', '#home'], [it.name]]));

    var main = h('div', { class: 'media' });
    var thumbs = h('div', { class: 'thumbs' });
    function show(i) {
      clear(main);
      if (it.images.length) main.appendChild(h('img', { src: img(it.images[i]), alt: it.name + (it.images.length > 1 ? ' photo ' + (i + 1) : '') }));
      else main.appendChild(placeholder(it));
      Array.prototype.forEach.call(thumbs.children, function (b, k) { b.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    }
    it.images.forEach(function (name, i) {
      thumbs.appendChild(h('button', { type: 'button', 'aria-label': 'Show photo ' + (i + 1), onclick: function () { show(i); } }, h('img', { src: img(name), alt: '' })));
    });

    var actions = h('div', { class: 'i-actions' });
    var wa = String(state.settings.whatsapp || '').replace(/\D/g, '');
    if (wa) {
      var msg = 'Hi Aakriti, I’m interested in ' + it.name + ' (' + rupee(it.price) + ').';
      actions.appendChild(h('a', { class: 'btn hot', href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener', text: 'Enquire on WhatsApp' }));
    }
    if (it.original_link) {
      actions.appendChild(h('a', { class: 'btn', href: it.original_link, target: '_blank', rel: 'noopener', text: 'Original link' }));
    }
    var linkSlot = h('div', { class: 'linkbox' });
    var url = location.origin + location.pathname + '#p-' + it.id;
    var copyBtn = h('button', { class: 'btn copy-link-icon', type: 'button', 'aria-label': 'Copy link', title: 'Copy link' });
    copyBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/></svg>';
    function showBox() {
      var inp = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Link to this piece' });
      clear(linkSlot); linkSlot.appendChild(inp); inp.focus(); inp.select();
    }
    copyBtn.addEventListener('click', function () {
      var done = function () { toast('Link copied'); };
      try { navigator.clipboard.writeText(url).then(done, showBox); } catch (e) { showBox(); }
    });
    actions.appendChild(copyBtn);

    f.appendChild(h('section', { class: 'item' },
      h('div', { class: 'gal' }, main, it.images.length > 1 ? thumbs : null),
      h('div', { class: 'i-body' },
        c ? h('a', { class: 'cat-link', href: '#c-' + c.id, text: c.name }) : null,
        h('h1', { text: it.name }),
        h('div', { class: 'price' }, h('b', { text: rupee(it.price) })),
        actions, linkSlot)));
    show(0);

    return f;
  }

  /* ---------- admin ---------- */
  function pageLogin() {
    var msg = h('p', { class: 'err', role: 'alert' });
    var pw = h('input', { type: 'password', id: 'adm-pw', autocomplete: 'current-password' });
    var go = h('button', { class: 'btn primary', type: 'submit', text: 'Log in' });
    var form = h('form', { class: 'panel login', onsubmit: function (ev) {
      ev.preventDefault();
      msg.textContent = ''; go.disabled = true;
      api('POST', '/api/login', { password: pw.value }).then(function () { isAdmin = true; render(true); })
        .catch(function (e) { go.disabled = false; msg.textContent = e.message; pw.select(); });
    } },
      h('p', { class: 'eyebrow', text: 'JUST FOR YOU' }),
      h('h2', { text: 'Welcome back, Aakriti' }),
      h('p', { class: 'hint', text: 'Your wardrobe is waiting for you.' }),
      h('div', { class: 'field' }, h('label', { for: 'adm-pw', text: 'Password' }), pw),
      msg, h('div', null, go));
    return h('section', { class: 'studio-login' },
      h('div', { class: 'login-welcome' },
        h('p', { class: 'eyebrow', text: 'THE WARDROBE STUDIO' }),
        h('h1', null, 'Your collection.', h('em', { text: ' Your own little space.' })),
        h('p', { text: 'Come in, make yourself at home, and give your favourite pieces a place to live.' }),
        h('a', { class: 'link', href: '#home', text: '← Back to wardrobe' })),
      h('div', { class: 'login-form-area' }, form));
  }

  function pageAdmin() {
    if (ui.tab !== 'items' && ui.tab !== 'cats' && ui.tab !== 'import' && ui.tab !== 'wishlist') ui.tab = 'items';
    var a = h('section', { class: 'admin admin-workspace' + (ui.tab === 'import' ? ' import-workspace' : ''), 'aria-label': 'Manage store' });
    var sidebar = h('aside', { class: 'admin-sidebar' },
      h('p', { class: 'eyebrow', text: 'YOUR PRIVATE SPACE' }),
      h('h2', { text: 'Wardrobe studio' }),
      h('p', { class: 'hint', text: 'A little room for everything you love.' }));
    var tabs = [['items', 'My pieces', state.items.length], ['cats', 'Categories', state.categories.length], ['wishlist', 'Wishlist', wishlist.entries ? wishlist.entries.length : '♡'], ['import', 'Import from link', '→']];
    sidebar.appendChild(h('div', { class: 'studio-nav', role: 'tablist', 'aria-label': 'Manage wardrobe' }, tabs.map(function (t) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': ui.tab === t[0] ? 'true' : 'false', 'aria-controls': 'studio-panel', id: 'studio-' + t[0], onclick: function () { ui.tab = t[0]; if (t[0] === 'wishlist') location.hash = 'wishlist'; else if (route.name === 'wishlist') location.hash = 'admin'; render(true); } },
        h('span', { text: t[1] }), h('span', { class: 'studio-count', text: String(t[2]) }));
    })));
    sidebar.appendChild(h('a', { class: 'studio-back', href: '#home', text: '← Back to wardrobe' }));
    var content = h('div', { class: 'studio-content', id: 'studio-panel', role: 'tabpanel', 'aria-labelledby': 'studio-' + ui.tab });
    content.appendChild(h('div', { class: 'admin-head' },
      h('div', null, h('p', { class: 'eyebrow', text: ui.tab === 'wishlist' ? 'SOMETHING FOR LATER' : ui.tab === 'import' ? 'FOUND SOMETHING YOU LOVE?' : ui.tab === 'items' ? 'COLLECTED & CURATED' : 'A PLACE FOR EVERY PIECE' }),
        h('h1', { text: ui.tab === 'wishlist' ? 'My wishlist' : ui.tab === 'import' ? 'Import from link' : ui.tab === 'items' ? 'My pieces' : 'Your categories' }),
        h('p', { class: 'studio-description', text: ui.tab === 'wishlist' ? 'Save the pieces you’re thinking about. Just a title and a link, until you’re ready.' : ui.tab === 'import' ? 'Paste a webpage link, choose your photos, then make the piece your own.' : ui.tab === 'items' ? 'Your collection, all in one place. Add, edit and revisit your favourites.' : 'Organise your wardrobe with categories and subcategories.' })),
      ui.tab === 'items' ? h('div', { class: 'studio-header-actions' }, h('button', { class: 'btn', type: 'button', text: 'Import from link', onclick: function () { ui.tab = 'import'; render(true); } }), h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null); }, text: '+ Add item' })) : null));
    if (ui.tab === 'import') {
      var caption = content.querySelector('.studio-description');
      clear(caption);
      caption.appendChild(h('span', { class: 'import-caption-full', text: 'Paste a webpage link, choose your photos, then make the piece your own.' }));
      caption.appendChild(h('span', { class: 'import-caption-short', text: 'Paste a link. Pick photos. Make it yours.' }));
    }
    if (ui.tab === 'items') {
      adminItems(content);
    } else if (ui.tab === 'wishlist') adminWishlist(content);
    else if (ui.tab === 'import') adminImport(content);
    else adminCats(content);
    a.appendChild(sidebar); a.appendChild(content);
    return a;
  }

  var wishlist = { entries: null, loading: false, error: '' };
  var wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' };
  function loadWishlist() {
    if (wishlist.loading) return;
    wishlist.loading = true; wishlist.error = '';
    api('GET', '/api/wishlist').then(function (result) { wishlist.entries = result.entries; })
      .catch(function (e) { wishlist.error = e.message; }).then(function () {
        wishlist.loading = false;
        if (route.name === 'wishlist' || (isAdmin && route.name === 'admin' && ui.tab === 'wishlist')) render(true);
      });
  }
  function adminWishlist(a) {
    if (!wishlist.entries && !wishlist.loading && !wishlist.error) loadWishlist();
    var draft = wishlistDraft;
    var title = h('input', { type: 'text', id: 'wish-title', value: draft.title, placeholder: 'The linen dress I loved', maxlength: 100, required: true, disabled: draft.saving, oninput: function () { draft.title = title.value; } });
    var url = h('input', { type: 'url', id: 'wish-url', value: draft.url, placeholder: 'https://example.com/product', required: true, disabled: draft.saving, oninput: function () { draft.url = url.value; } });
    var form = h('form', { class: 'wishlist-form panel', onsubmit: function (ev) {
      ev.preventDefault();
      if (draft.saving) return;
      draft.saving = true; draft.error = ''; render(true);
      api(draft.id ? 'PUT' : 'POST', '/api/wishlist' + (draft.id ? '/' + encodeURIComponent(draft.id) : ''), { title: draft.title, url: draft.url })
        .then(function (entry) {
          if (wishlist.entries) {
            if (draft.id) wishlist.entries = wishlist.entries.map(function (it) { return it.id === entry.id ? entry : it; });
            else wishlist.entries.unshift(entry);
          }
          wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' };
          toast(draft.id ? 'Wishlist entry updated' : 'Saved to your wishlist'); render(true);
          if (!wishlist.entries) loadWishlist();
        }).catch(function (e) { draft.saving = false; draft.error = e.message; render(true); });
    } },
      h('h2', { text: draft.id ? 'Edit saved idea' : 'Save something for later' }),
      h('div', { class: 'wishlist-fields' },
        h('div', { class: 'field' }, h('label', { for: 'wish-title', text: 'Title' }), title),
        h('div', { class: 'field' }, h('label', { for: 'wish-url', text: 'Link' }), url)),
      draft.error ? h('p', { class: 'err', role: 'alert', text: draft.error }) : null,
      h('div', { class: 'wishlist-form-actions' },
        draft.id ? h('button', { class: 'btn', type: 'button', disabled: draft.saving, text: 'Cancel editing', onclick: function () { wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' }; render(true); } }) : null,
        h('button', { class: 'btn primary', type: 'submit', disabled: draft.saving, text: draft.saving ? 'Saving…' : draft.id ? 'Save changes' : '+ Save to wishlist' })));
    if (isAdmin) a.appendChild(form);
    if (wishlist.loading) a.appendChild(h('p', { class: 'hint', role: 'status', text: 'Loading your saved ideas…' }));
    if (wishlist.error) a.appendChild(h('div', { class: 'wishlist-error' }, h('p', { class: 'err', role: 'alert', text: wishlist.error }), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { loadWishlist(); render(true); } })));
    if (!wishlist.entries) return;
    if (!wishlist.entries.length) {
      a.appendChild(h('div', { class: 'wishlist-empty' }, h('span', { class: 'wishlist-heart', 'aria-hidden': 'true', text: '♡' }), h('h2', { text: 'Room for a little inspiration' }), h('p', { text: isAdmin ? 'Save a link above. Photos, price and category can wait until you add it to your wardrobe.' : 'Nothing saved yet. Check back for new ideas.' })));
      return;
    }
    if (isAdmin) a.appendChild(h('p', { class: 'hint', text: 'Add to wardrobe opens an item draft with the title and link filled in. Your wish stays here until the item is saved.' }));
    var list = h('div', { class: 'wishlist-list' });
    wishlist.entries.forEach(function (entry) {
      var host;
      try { host = new URL(entry.url).hostname.replace(/^www\./, ''); } catch (e) { host = entry.url; }
      var remove = h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () {
        if (remove.dataset.armed !== '1') { remove.dataset.armed = '1'; remove.textContent = 'Confirm remove'; setTimeout(function () { remove.dataset.armed = ''; remove.textContent = 'Remove'; }, 4000); return; }
        remove.disabled = true;
        api('DELETE', '/api/wishlist/' + encodeURIComponent(entry.id)).then(function () {
          wishlist.entries = wishlist.entries.filter(function (it) { return it.id !== entry.id; });
          if (wishlistDraft.id === entry.id) wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' };
          toast('Removed from wishlist'); render(true);
        }).catch(function (e) { remove.disabled = false; toast(e.message, true); });
      } });
      list.appendChild(h('article', { class: 'wishlist-row' },
        h('div', { class: 'wishlist-info' }, h('h2', { text: entry.title }),
          h('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', text: host + ' →', 'aria-label': 'Open ' + entry.title + ' on ' + host })),
        isAdmin ? h('div', { class: 'wishlist-actions' },
          h('button', { class: 'btn sm', type: 'button', text: 'Edit', disabled: draft.saving, onclick: function () { wishlistDraft = { id: entry.id, title: entry.title, url: entry.url, saving: false, error: '' }; render(true); document.getElementById('wish-title').focus(); } }), remove,
          h('button', { class: 'btn sm primary', type: 'button', text: 'Add to wardrobe →', onclick: function () { openEditor(null, null, { name: entry.title, source: entry.url, wishlistId: entry.id }); } })) : null));
    });
    a.appendChild(list);
  }

  var importDraft = { url: '', result: null, selected: [], scanning: false, preparing: false, error: '' };
  function adminImport(a) {
    var d = importDraft;
    var busy = d.scanning || d.preparing;
    var url = h('input', { type: 'url', id: 'import-url', placeholder: 'https://example.com/product', value: d.url, required: true, disabled: busy, oninput: function () { d.url = url.value; } });
    var form = h('form', { class: 'import-form panel', onsubmit: function (ev) {
      ev.preventDefault();
      if (d.scanning || d.preparing) return;
      d.scanning = true; d.error = ''; d.result = null; d.selected = []; render(true);
      api('POST', '/api/import/scan', { url: d.url.trim() }).then(function (result) { d.result = result; })
        .catch(function (e) { d.error = e.message; }).then(function () { d.scanning = false; render(true); });
    } }, h('div', { class: 'field' }, h('label', { for: 'import-url', text: 'Webpage link' }), url),
      h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: d.scanning ? 'Finding photos…' : 'Find photos' }),
      h('p', { class: 'hint', text: 'Works with public pages. Some sites block imports or load photos only after the page opens. You can always upload photos manually.' }));
    a.appendChild(form);
    if (d.error) {
      a.appendChild(h('p', { class: 'err', role: 'alert', text: d.error }));
      var source = d.url.trim();
      if (/^https?:\/\//i.test(source)) a.appendChild(h('div', { class: 'acts' },
        h('a', { class: 'btn', href: source, target: '_blank', rel: 'noopener noreferrer', text: 'Open product page' }),
        h('button', { class: 'btn', type: 'button', text: 'Add item manually', onclick: function () { openEditor(null, null, { source: source, importSession: d }); } })));
    }
    a.appendChild(h('details', { class: 'import-saved-page', open: !!d.error },
      h('summary', { text: 'Import a saved webpage instead' }),
      h('p', { class: 'hint', text: 'If a site blocks automatic imports: open the product page in your browser, save it as Webpage, HTML Only, then choose that .html file here. Keep the original link in the field above.' }),
      h('label', { class: 'field' }, h('span', { text: 'Saved webpage (.html)' }),
        h('input', { type: 'file', accept: '.html,.htm,text/html', disabled: busy, 'aria-label': 'Saved webpage HTML', onchange: function (ev) {
          var file = ev.target.files[0];
          if (!file || d.scanning || d.preparing) return;
          if (!d.url.trim()) { d.error = 'Enter the original webpage link above first.'; render(true); return; }
          if (file.size > 2 * 1024 * 1024) { d.error = 'Choose an HTML-only file smaller than 2 MB.'; render(true); return; }
          var fd = new FormData(); fd.append('page', file); fd.append('url', d.url.trim());
          d.scanning = true; d.error = ''; d.result = null; d.selected = []; render(true);
          api('POST', '/api/import/html', fd).then(function (result) { d.result = result; })
            .catch(function (e) { d.error = e.message; }).then(function () { d.scanning = false; render(true); });
        } }))));

    if (busy) a.appendChild(h('p', { class: 'hint', role: 'status', text: d.scanning ? 'Reading the webpage and looking for images…' : 'Preparing your selected photos…' }));
    if (!d.result) return;
    if (!d.result.images.length) {
      a.appendChild(h('div', { class: 'import-empty' }, h('h2', { text: 'No photos found' }), h('p', { text: 'Try the direct product page, or add the photos yourself.' }),
        h('button', { class: 'btn', text: 'Add item manually', type: 'button', onclick: function () { openEditor(null, null, { source: d.result.source, name: d.result.name, price: d.result.price, importSession: d }); } })));
      return;
    }
    var grid = h('div', { class: 'import-grid' });
    var count = h('span', { class: 'hint', text: d.selected.length + ' of 10 photos selected' });
    var use = h('button', { class: 'btn primary', type: 'button', disabled: busy || !d.selected.length, text: 'Use selected photos', onclick: function () {
      if (d.preparing || !d.selected.length) return;
      d.preparing = true; d.error = '';
      var selected = d.selected.slice(), result = d.result;
      render(true);
      var files = [], failures = 0, chain = Promise.resolve();
      selected.forEach(function (id) {
        chain = chain.then(function () {
          var photo = result.images.find(function (entry) { return entry.id === id; });
          return fetch(photo.preview, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) return r.json().catch(function () { return {}; }).then(function (data) { throw new Error(data.error || 'Could not download that photo.'); });
            return r.blob();
          }).then(function (blob) { files.push(new File([blob], 'import-' + (id + 1), { type: blob.type })); })
            .catch(function () { failures++; });
        });
      });
      chain.then(function () {
        d.preparing = false;
        if (!files.length) d.error = 'Could not download the selected photos. Try different photos or upload them manually.';
        render(true);
        if (files.length) {
          openEditor(null, null, { files: files, source: result.source, name: result.name, price: result.price, importSession: d });
          if (failures) toast(failures + ' photos could not be imported. The other photos are ready.', true);
        }
      });
    } });
    a.appendChild(h('div', { class: 'import-result-heading' }, h('div', null,
      h('h2', { text: 'Choose your photos' }), h('p', { class: 'hint', text: 'Select up to 10. You can reorder or remove them in the item editor.' })), count));
    d.result.images.forEach(function (photo, index) {
      var checkbox = h('input', { type: 'checkbox', checked: d.selected.indexOf(photo.id) !== -1, disabled: busy, 'aria-label': 'Select photo ' + (index + 1), onchange: function () {
        if (checkbox.checked) {
          if (d.selected.length >= 10) { checkbox.checked = false; toast('Select up to 10 photos.', true); return; }
          d.selected.push(photo.id);
        } else d.selected = d.selected.filter(function (id) { return id !== photo.id; });
        count.textContent = d.selected.length + ' of 10 photos selected'; use.disabled = !d.selected.length;
      } });
      var label = h('label', { class: 'import-photo' }, checkbox,
        h('img', { src: photo.preview, alt: 'Photo ' + (index + 1) + ' from webpage', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: function () {
          checkbox.disabled = true; checkbox.checked = false;
          d.selected = d.selected.filter(function (id) { return id !== photo.id; });
          count.textContent = d.selected.length + ' of 10 photos selected'; use.disabled = busy || !d.selected.length;
          label.classList.add('unavailable');
        } }), h('span', { class: 'import-photo-caption', text: 'Photo ' + (index + 1) }));
      grid.appendChild(label);
    });
    a.appendChild(grid);
    a.appendChild(h('div', { class: 'category-save-bar' }, h('p', { class: 'hint', text: 'Nothing is saved until you confirm the item details.' }), use));
  }

  function adminItems(a) {
    var samples = state.items.filter(function (i) { return i.sample; });
    if (samples.length) {
      var rm = h('button', { class: 'btn sm', type: 'button', text: 'Remove sample items', onclick: function () {
        rm.disabled = true; rm.textContent = 'Removing…';
        api('DELETE', '/api/items?sample=1').then(function () { toast('Sample items removed'); return reload(); })
          .catch(function (e) { rm.disabled = false; rm.textContent = 'Remove sample items'; toast(e.message, true); });
      } });
      a.appendChild(h('div', { class: 'note' }, h('span', { text: samples.length + ' items are samples with no photos. Remove them once you have added your own.' }), rm));
    }
    if (!state.items.length) {
      a.appendChild(h('div', { class: 'empty' }, h('h2', { text: 'No items yet' }), h('p', { text: 'Add your first piece with a photo, name, category and price.' })));
      return;
    }
    var rows = h('div', { class: 'rows studio-items' });
    state.items.slice().sort(newest).forEach(function (it) {
      var c = catById(it.cat);
      var th = h('div', { class: 'thumb' });
      if (it.images.length) th.appendChild(h('img', { src: img(it.images[0]), alt: '', loading: 'lazy' })); else th.appendChild(placeholder(it, true));
      var del = h('button', { class: 'btn sm danger', type: 'button', text: 'Delete' });
      del.addEventListener('click', function () {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Confirm delete'; setTimeout(function () { del.dataset.armed = ''; del.textContent = 'Delete'; }, 4000); return; }
        del.disabled = true;
        api('DELETE', '/api/items/' + encodeURIComponent(it.id)).then(function () { toast('Deleted “' + it.name + '”'); return reload(); })
          .catch(function (e) { del.disabled = false; toast(e.message, true); });
      });
      rows.appendChild(h('div', { class: 'row' }, th,
        h('div', { class: 'info' }, h('b', { text: it.name }), h('span', { text: [c ? c.name : 'Uncategorised', rupee(it.price), it.images.length + (it.images.length === 1 ? ' photo' : ' photos')].join(' · ') })),
        h('div', { class: 'acts' },
          h('a', { class: 'btn sm', href: '#p-' + it.id, text: 'View' }),
          h('button', { class: 'btn sm', type: 'button', text: 'Edit', onclick: function () { openEditor(it); } }), del)));
    });
    a.appendChild(rows);
  }

  var catDraft = null;
  function adminCats(a) {
    if (!catDraft) catDraft = clone(state.categories);
    var msg = h('p', { class: 'err', role: 'alert' });
    var box = h('div', { class: 'rows simple-categories' });
    catDraft.forEach(function (c, i) {
      c.subcategories = c.subcategories || [];
      var inp = h('input', { type: 'text', value: c.name, 'aria-label': 'Category name', id: 'cat-' + i, oninput: function () { c.name = inp.value; var summary = inp.closest('details').querySelector('.category-summary-name'); summary.textContent = c.name || 'Untitled category'; } });
      var used = state.items.filter(function (it) { return it.cat === c.id; }).length;
      var childRows = h('div', { class: 'subcategory-rows' });
      if (!c.subcategories.length) childRows.appendChild(h('p', { class: 'subcategory-empty', text: 'No subcategories yet. Add one below to group similar pieces.' }));
      c.subcategories.forEach(function (sub, j) {
        var subInput = h('input', { type: 'text', value: sub.name, 'aria-label': c.name + ' subcategory name', oninput: function () { sub.name = subInput.value; } });
        var subUsed = state.items.filter(function (it) { return it.subcat === sub.id; }).length;
        childRows.appendChild(h('div', { class: 'subcategory-row' },
          h('div', { class: 'field' }, subInput, subUsed ? h('span', { class: 'hint', text: subUsed + (subUsed === 1 ? ' item' : ' items') }) : null),
          h('button', { class: 'sub-remove', type: 'button', text: '×', 'aria-label': 'Remove ' + sub.name, title: 'Remove subcategory', onclick: function () {
            if (subUsed) { msg.textContent = '“' + sub.name + '” still has items assigned. Reassign them first.'; return; }
            c.subcategories.splice(j, 1); render(true);
          } })));
      });
      var subInput = h('input', { type: 'text', placeholder: 'New subcategory', 'aria-label': 'New subcategory for ' + c.name });
      var addSub = h('button', { class: 'btn sm', type: 'button', text: '+ Add', onclick: function () {
        var name = subInput.value.trim();
        if (!name) return;
        c.subcategories.push({ id: '', name: name }); render(true);
      } });
      subInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addSub.click(); } });
      box.appendChild(h('details', { class: 'category-admin-card', name: 'category-editors', open: !!(ui.categoryOpen && ui.categoryOpen[c.id]), ontoggle: function (ev) { ui.categoryOpen = ui.categoryOpen || {}; ui.categoryOpen[c.id] = ev.currentTarget.open; } },
        h('summary', { class: 'category-summary' },
          h('span', { class: 'category-order', text: String(i + 1).padStart(2, '0') }),
          h('span', { class: 'category-summary-name', text: c.name }),
          h('span', { class: 'category-meta', text: used + (used === 1 ? ' piece' : ' pieces') }),
          h('span', { class: 'category-edit-label', text: 'Edit' })),
        h('div', { class: 'category-editor' },
        h('div', { class: 'cat-row' },
        h('div', { class: 'field' }, h('label', { for: 'cat-' + i, text: 'Category name' }), inp),
        h('div', { class: 'acts category-tools' },
          h('span', { class: 'category-order-label', text: 'Menu order' }),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move earlier', disabled: i === 0, onclick: function () { catDraft.splice(i - 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '←' }),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move later', disabled: i === catDraft.length - 1, onclick: function () { catDraft.splice(i + 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '→' }),
          h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () {
            if (used) { msg.textContent = '“' + c.name + '” has ' + used + ' item' + (used === 1 ? '' : 's') + '. Move them to another category first.'; return; }
            catDraft.splice(i, 1); render(true);
          } }))),
        h('div', { class: 'category-subcategories' },
          h('div', { class: 'subcategory-heading' }, h('h3', { text: 'Subcategories' }), h('span', { text: String(c.subcategories.length) })),
          childRows,
          h('div', { class: 'subcategory-add' }, subInput, addSub)))));
    });
    var newIn = h('input', { type: 'text', id: 'new-cat', placeholder: 'New category, for example Accessories', 'aria-label': 'New category name' });
    var addBtn = h('button', { class: 'btn', type: 'button', text: 'Add category', onclick: function () {
      var name = newIn.value.trim(); if (!name) return;
      var id = slug(name), n = 2, base = id;
      while (catDraft.some(function (c) { return c.id === id; })) id = base + '-' + (n++);
      catDraft.push({ id: id, name: name, subcategories: [] }); render(true);
    } });
    newIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addBtn.click(); } });
    var save = h('button', { class: 'btn primary', type: 'button', text: 'Save categories', onclick: function () {
      save.disabled = true; save.textContent = 'Saving…'; msg.textContent = '';
      api('PUT', '/api/categories', { categories: catDraft }).then(function () { catDraft = null; toast('Categories saved'); return reload(); })
        .catch(function (e) { save.disabled = false; save.textContent = 'Save categories'; msg.textContent = e.message; });
    } });
    a.appendChild(h('p', { class: 'hint', text: 'Click a category to rename it, change its order or manage subcategories. Save when you’re done.' }));
    a.appendChild(box);
    a.appendChild(h('div', { class: 'panel' }, h('div', { class: 'field' }, h('label', { for: 'new-cat', text: 'Add a category' }), newIn), addBtn));
    a.appendChild(msg);
    a.appendChild(h('div', { class: 'category-save-bar' }, h('span', { class: 'hint', text: 'Changes are applied when you save.' }), save));
  }

  /* ---------- item editor ---------- */
  function shrink(file) {
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) return Promise.reject(new Error('Use JPG, PNG, WebP, GIF or AVIF photos.'));
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 1500 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read that photo.')); }, 'image/jpeg', 0.86); });
    }, function () { return Promise.reject(new Error('Could not read that photo.')); });
  }

  function openEditor(item, presetCat, imported) {
    var d = els.editor;
    var isEdit = !!item;
    var firstCat = presetCat && catById(presetCat) ? presetCat : (state.categories[0] ? state.categories[0].id : '');
    var draft = item ? { id: item.id, name: item.name, cat: item.cat, subcat: item.subcat || '', price: item.price, original_link: item.original_link || '' } : { id: '', name: '', cat: firstCat, subcat: '', price: '', original_link: '' };
    if (imported && !item) { draft.name = imported.name || ''; draft.price = imported.price || ''; draft.original_link = imported.source || ''; }
    var photosList = item ? item.images.map(function (n) { return { f: n }; }) : [];
    var busy = 0;
    clear(d);
    var err = h('p', { class: 'err', role: 'alert' });
    var photos = h('div', { class: 'photos' });
    var saveBtn;

    function release(e) { if (e.url) URL.revokeObjectURL(e.url); }
    function closeEditor() { photosList.forEach(release); d.close(); }

    function drawPhotos() {
      clear(photos);
      photosList.forEach(function (e, i) {
        var bar = h('div', { class: 'pt-bar' },
          i > 0 ? h('button', { type: 'button', text: 'Make cover', onclick: function () { photosList.unshift(photosList.splice(i, 1)[0]); drawPhotos(); } }) : h('span'),
          h('button', { type: 'button', text: 'Remove', onclick: function () { release(photosList.splice(i, 1)[0]); drawPhotos(); } }));
        photos.appendChild(h('div', { class: 'pt' }, h('img', { src: e.url || img(e.f), alt: 'Photo ' + (i + 1) }), i === 0 ? h('span', { class: 'tag cover', text: 'Cover' }) : null, bar));
      });
      for (var u = 0; u < busy; u++) photos.appendChild(h('div', { class: 'pt busy', text: 'Preparing…' }));
      photos.appendChild(h('label', { class: 'add-photo' },
        h('b', { text: '+' }), h('span', { text: 'Add photos' }),
        h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'photo-input', onchange: function (ev) { addFiles(ev.target.files); ev.target.value = ''; } })));
      if (saveBtn) saveBtn.disabled = busy > 0;
    }

    function addFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      err.textContent = '';
      busy += list.length; drawPhotos();
      var chain = Promise.resolve(), problems = [];
      list.forEach(function (f) {
        chain = chain.then(function () {
          return shrink(f).then(function (b) {
            if (photosList.length >= 10) throw new Error('Up to 10 photos per item.');
            photosList.push({ blob: b, url: URL.createObjectURL(b) });
          }).catch(function (e) { problems.push(f.name + ': ' + e.message); }).then(function () { busy--; drawPhotos(); });
        });
      });
      chain.then(function () { if (problems.length) err.textContent = problems.join(' '); });
    }

    photos.addEventListener('dragover', function (ev) { ev.preventDefault(); photos.classList.add('drag'); });
    photos.addEventListener('dragleave', function () { photos.classList.remove('drag'); });
    photos.addEventListener('drop', function (ev) { ev.preventDefault(); photos.classList.remove('drag'); addFiles(ev.dataTransfer.files); });

    var name = h('input', { type: 'text', id: 'f-name', value: draft.name, maxlength: 100, oninput: function () { draft.name = name.value; } });
    var subcat = h('select', { id: 'f-subcat', required: true, onchange: function () { draft.subcat = subcat.value; } });
    function drawSubcategories() {
      clear(subcat);
      var category = catById(draft.cat);
      subcat.appendChild(h('option', { value: '', text: category && (category.subcategories || []).length ? 'Choose a subcategory' : 'Add a subcategory in Categories first', disabled: true }));
      (category ? category.subcategories || [] : []).forEach(function (s) {
        subcat.appendChild(h('option', { value: s.id, text: s.name, selected: s.id === draft.subcat }));
      });
      if (!(category && (category.subcategories || []).some(function (s) { return s.id === draft.subcat; }))) draft.subcat = '';
    }
    var cat = h('select', { id: 'f-cat', onchange: function () { draft.cat = cat.value; drawSubcategories(); } },
      state.categories.map(function (c) { return h('option', { value: c.id, text: c.name, selected: c.id === draft.cat }); }));
    drawSubcategories();
    var price = h('input', { type: 'number', id: 'f-price', min: 1, inputmode: 'numeric', value: draft.price, oninput: function () { draft.price = price.value; } });
    var originalLink = h('input', { type: 'url', id: 'f-original-link', value: draft.original_link, placeholder: 'https://example.com/product', oninput: function () { draft.original_link = originalLink.value.trim(); } });

    saveBtn = h('button', { class: 'btn primary', type: 'button', text: isEdit ? 'Save changes' : 'Add to catalogue', onclick: function () {
      err.textContent = '';
      var nm = String(draft.name).trim(), p = Math.round(Number(draft.price));
      if (!nm) { err.textContent = 'Give the item a name.'; name.focus(); return; }
      if (!draft.cat || !catById(draft.cat)) { err.textContent = 'Choose a category.'; return; }
      if (!draft.subcat || !(catById(draft.cat).subcategories || []).some(function (s) { return s.id === draft.subcat; })) { err.textContent = 'Choose a subcategory. If none are available, add one in Categories first.'; subcat.focus(); return; }
      if (!(p > 0)) { err.textContent = 'Enter a price greater than zero.'; price.focus(); return; }
      if (draft.original_link && !/^https?:\/\//i.test(draft.original_link)) { err.textContent = 'Original link must start with http:// or https://.'; originalLink.focus(); return; }
      var fd = new FormData(), order = [], n = 0;
      fd.append('name', nm); fd.append('cat', draft.cat); fd.append('price', String(p));
      fd.append('subcat', draft.subcat || '');
      fd.append('original_link', draft.original_link || '');
      if (!isEdit && imported && imported.wishlistId) fd.append('wishlist_id', imported.wishlistId);
      photosList.forEach(function (e) {
        if (e.f) order.push('f:' + e.f);
        else { order.push('n:' + n); fd.append('images', e.blob, 'photo-' + n + '.jpg'); n++; }
      });
      fd.append('order', JSON.stringify(order));
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      var req = isEdit ? api('PUT', '/api/items/' + encodeURIComponent(draft.id), fd) : api('POST', '/api/items', fd);
      req.then(function (res) {
        toast(isEdit ? 'Saved “' + nm + '”' : 'Added “' + nm + '”');
        closeEditor();
        if (!isEdit && imported && imported.importSession === importDraft) {
          importDraft = { url: '', result: null, selected: [], scanning: false, preparing: false, error: '' };
          if (route.name === 'admin' && ui.tab === 'import') render(true);
        }
        if (!isEdit && imported && imported.wishlistId) {
          if (wishlist.entries) wishlist.entries = wishlist.entries.filter(function (entry) { return entry.id !== imported.wishlistId; });
          if (wishlistDraft.id === imported.wishlistId) wishlistDraft = { id: '', title: '', url: '', saving: false, error: '' };
        }
        return reload().then(function () { if (!isEdit && res.id && (route.name !== 'admin' || (imported && imported.importSession))) location.hash = 'p-' + res.id; });
      }).catch(function (e) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save changes' : 'Add to catalogue'; err.textContent = e.message; });
    } });

    d.appendChild(h('button', { class: 'dlg-close', type: 'button', 'aria-label': 'Close', onclick: closeEditor, text: '×' }));
    d.appendChild(h('div', { class: 'ed' },
      h('h2', { text: isEdit ? 'Edit item' : 'Add item' }),
      h('div', { class: 'field editor-photos' }, h('span', { class: 'lbl', text: 'Photos' }), photos,
        h('span', { class: 'hint', text: 'The first photo is the cover. JPG, PNG, WebP, GIF or AVIF. Large photos are resized for you.' })),
      h('div', { class: 'field editor-name' }, h('label', { for: 'f-name', text: 'Name' }), name),
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: 'f-cat', text: 'Category' }), cat),
        h('div', { class: 'field' }, h('label', { for: 'f-price', text: 'Price (₹)' }), price)),
      h('div', { class: 'field' }, h('label', { for: 'f-subcat', text: 'Subcategory' }), subcat),
      h('div', { class: 'field' }, h('label', { for: 'f-original-link', text: 'Original link' }), originalLink),
      err));
    d.appendChild(h('div', { class: 'ed-foot' },
        h('span', { class: 'hint', text: isEdit ? '' : 'Each item gets its own page and link.' }),
        h('div', { class: 'grp' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeEditor }), saveBtn)));
    drawPhotos();
    if (!d.open) d.showModal();
    if (imported && imported.files) addFiles(imported.files);
  }

  var diaryState = { year: Number(DiaryCalendar.todayISO().slice(0, 4)), month: Number(DiaryCalendar.todayISO().slice(5, 7)) - 1, view: 'month', cache: {}, loading: {}, errors: {} };
  var diaryMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var diaryLabels = { not_written: 'Not written', in_progress: 'In progress', written: 'Written' };
  function loadDiary(year) {
    if (diaryState.loading[year]) return;
    diaryState.loading[year] = true; delete diaryState.errors[year];
    api('GET', '/api/diary?year=' + year).then(function (data) { diaryState.cache[year] = data; })
      .catch(function (e) { diaryState.errors[year] = e.message; if (e.status === 401) isAdmin = false; })
      .then(function () { diaryState.loading[year] = false; if (route.name === 'diary') render(true); });
  }
  function pageDiary() {
    var year = diaryState.year;
    var data = diaryState.cache[year];
    if (!data && !diaryState.loading[year] && !diaryState.errors[year]) loadDiary(year);
    var today = data ? data.today : DiaryCalendar.todayISO();
    var currentYear = Number(today.slice(0, 4));
    var page = h('section', { class: 'diary-page', 'aria-label': 'Diary calendar' });
    page.appendChild(h('div', { class: 'diary-heading' }, h('div', null,
      h('p', { class: 'eyebrow', text: 'A LITTLE TIME FOR MYSELF' }), h('h1', { text: 'The Diary Calendar' }),
      h('p', { class: 'studio-description', text: 'One day, one entry. Keep track of the moments you’ve put into words.' })),
      h('a', { class: 'link', href: '#admin', text: '← Wardrobe studio' })));
    var workspace = h('div', { class: 'diary-workspace' });
    var sidebar = h('aside', { class: 'diary-sidebar', 'aria-label': 'Diary statistics' });
    var calendar = h('div', { class: 'diary-calendar-panel' });
    workspace.appendChild(sidebar); workspace.appendChild(calendar); page.appendChild(workspace);
    var yearInput = h('select', { id: 'diary-year', 'aria-label': 'Calendar year', onchange: function () { diaryState.year = Number(yearInput.value); render(true); } },
      Array.from({ length: currentYear - 2023 + 1 }, function (_, i) { var value = currentYear - i; return h('option', { value: value, selected: value === year, text: String(value) }); }));
    var views = h('div', { class: 'calendar-views', role: 'group', 'aria-label': 'Calendar view' }, ['month', 'year'].map(function (view) {
      return h('button', { class: 'btn', type: 'button', 'aria-pressed': diaryState.view === view ? 'true' : 'false', text: view === 'month' ? 'Monthly' : 'Yearly', onclick: function () { diaryState.view = view; render(true); } });
    }));
    calendar.appendChild(h('div', { class: 'diary-toolbar' }, views, h('div', { class: 'diary-period' }, h('label', { for: 'diary-year', text: 'Year' }), yearInput,
      h('button', { class: 'btn', type: 'button', text: 'Today', onclick: function () { diaryState.year = currentYear; diaryState.month = Number(today.slice(5, 7)) - 1; diaryState.view = 'month'; render(true); } }))));
    if (diaryState.loading[year]) calendar.appendChild(h('p', { class: 'hint', role: 'status', text: 'Loading your diary calendar…' }));
    if (diaryState.errors[year]) calendar.appendChild(h('div', { class: 'wishlist-error' }, h('p', { class: 'err', role: 'alert', text: diaryState.errors[year] }),
      h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { loadDiary(year); render(true); } })));
    if (!data) return page;
    var stats = DiaryCalendar.stats(year, data.entries, today);
    var statCards = h('div', { class: 'diary-stats' });
    function stat(value, label, note) { return h('div', { class: 'diary-stat' }, h('span', { text: label }), h('b', { text: String(value) }), h('small', { text: note })); }
    if (stats.dayOfYear !== null) statCards.appendChild(stat(stats.dayOfYear, 'Day of ' + year, 'Today, in India time'));
    statCards.appendChild(stat(stats.written, 'Days written in ' + year, 'Completed diary entries'));
    statCards.appendChild(stat(stats.longestStreak, 'Longest streak', 'Consecutive written days in ' + year));
    sidebar.appendChild(statCards);
    sidebar.appendChild(h('div', { class: 'diary-legend' }, Object.keys(diaryLabels).map(function (status) {
      return h('span', null, h('i', { class: 'status-dot status-' + status, 'aria-hidden': 'true' }), diaryLabels[status]);
    }), h('span', null, h('i', { class: 'status-dot status-future', 'aria-hidden': 'true' }), 'Future')));
    var dialog = h('dialog', { class: 'diary-dialog', 'aria-label': 'Update diary status' });
    var focusDate = '';
    function closeDialog() { dialog.close(); var day = document.getElementById('diary-' + focusDate); if (day) day.focus(); }
    function editDate(date) {
      focusDate = date; clear(dialog);
      var status = data.entries[date] || 'not_written';
      var saving = false;
      var error = h('p', { class: 'err', role: 'alert' });
      var buttons = [];
      dialog.appendChild(h('button', { class: 'dlg-close', type: 'button', 'aria-label': 'Close diary editor', text: '×', onclick: function () { if (!saving) closeDialog(); } }));
      dialog.appendChild(h('p', { class: 'eyebrow', text: 'A MOMENT TO CHECK IN' }));
      dialog.appendChild(h('h2', { text: new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) }));
      dialog.appendChild(h('p', { class: 'hint', text: 'How is your diary entry for this day?' }));
      var choices = h('div', { class: 'diary-status-choices' });
      Object.keys(diaryLabels).forEach(function (value) {
        var button = h('button', { class: 'diary-status-choice status-' + value, type: 'button', 'aria-pressed': status === value ? 'true' : 'false', onclick: function () {
          if (saving) return;
          saving = true; error.textContent = ''; buttons.forEach(function (b) { b.disabled = true; });
          api('PUT', '/api/diary/' + date, { status: value }).then(function () {
            if (value === 'not_written') delete data.entries[date]; else data.entries[date] = value;
            dialog.close(); render(true); var day = document.getElementById('diary-' + date); if (day) day.focus();
            toast('Diary status saved');
          }).catch(function (e) { saving = false; error.textContent = e.message; buttons.forEach(function (b) { b.disabled = false; }); });
        } }, h('i', { class: 'status-dot status-' + value, 'aria-hidden': 'true' }), diaryLabels[value]);
        buttons.push(button); choices.appendChild(button);
      });
      dialog.appendChild(choices); dialog.appendChild(error); dialog.showModal();
      dialog.oncancel = function (ev) { if (saving) ev.preventDefault(); };
    }
    function monthCard(month, compact) {
      var card = h('section', { class: 'diary-month' + (compact ? ' compact' : ''), 'aria-label': diaryMonths[month] + ' ' + year });
      if (compact) card.appendChild(h('button', { class: 'month-title', type: 'button', text: diaryMonths[month], 'aria-label': 'Open ' + diaryMonths[month] + ' ' + year, onclick: function () { diaryState.month = month; diaryState.view = 'month'; render(true); } }));
      var grid = h('div', { class: 'diary-days' });
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (day) { grid.appendChild(h('span', { class: 'diary-weekday', text: compact ? day[0] : day, 'aria-label': day })); });
      for (var i = 0; i < DiaryCalendar.offset(year, month); i++) grid.appendChild(h('span', { class: 'diary-spacer', 'aria-hidden': 'true' }));
      for (var number = 1; number <= DiaryCalendar.daysInMonth(year, month); number++) {
        (function (day) {
          var date = DiaryCalendar.key(year, month, day), future = date > today;
          var status = data.entries[date] || 'not_written';
          var label = day + ' ' + diaryMonths[month] + ' ' + year + ': ' + (future ? 'Future date' : diaryLabels[status]);
          grid.appendChild(h('button', { class: 'diary-day status-' + (future ? 'future' : status) + (date === today ? ' is-today' : ''), id: 'diary-' + date, type: 'button', disabled: future, 'aria-label': label, 'aria-current': date === today ? 'date' : null, title: label,
            onclick: function () { editDate(date); }, onkeydown: function (ev) {
              var delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
              if (!delta) return; var next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + delta);
              var target = document.getElementById('diary-' + next.toISOString().slice(0, 10));
              if (target && !target.disabled) { ev.preventDefault(); target.focus(); }
            } }, h('span', { class: 'diary-day-number', text: String(day) }), compact ? null : h('span', { class: 'diary-day-label', text: future ? '' : diaryLabels[status] })));
        })(number);
      }
      for (var trailing = DiaryCalendar.offset(year, month) + DiaryCalendar.daysInMonth(year, month); trailing < 42; trailing++) grid.appendChild(h('span', { class: 'diary-spacer', 'aria-hidden': 'true' }));
      card.appendChild(grid); return card;
    }
    if (diaryState.view === 'month') {
      var month = diaryState.month;
      function move(delta) {
        var next = new Date(Date.UTC(year, month + delta, 1)); diaryState.year = next.getUTCFullYear(); diaryState.month = next.getUTCMonth(); render(true);
      }
      calendar.appendChild(h('div', { class: 'diary-month-heading' },
        h('button', { class: 'btn', type: 'button', 'aria-label': 'Previous month', text: '←', disabled: year === 2023 && month === 0, onclick: function () { move(-1); } }),
        h('h2', { text: diaryMonths[month] + ' ' + year }),
        h('button', { class: 'btn', type: 'button', 'aria-label': 'Next month', text: '→', disabled: year === currentYear && month === 11, onclick: function () { move(1); } })));
      calendar.appendChild(monthCard(month, false));
    } else {
      calendar.appendChild(h('p', { class: 'hint diary-year-scroll-hint', text: 'Swipe through the months →' }));
      calendar.appendChild(h('div', { class: 'diary-year-grid', tabindex: '0', 'aria-label': 'Months of the year. Scroll horizontally on smaller screens.' }, diaryMonths.map(function (_, month) { return monthCard(month, true); })));
    }
    sidebar.appendChild(h('p', { class: 'hint diary-help', text: 'Choose a day to update it. Streaks count written days in the selected year.' }));
    page.appendChild(dialog); return page;
  }

  /* ---------- boot ---------- */
  function dismissLoader() {
    document.body.classList.remove('is-loading');
    var app = document.getElementById('app');
    app.removeAttribute('inert'); app.removeAttribute('aria-busy');
    var loader = document.getElementById('site-loader');
    if (loader) {
      loader.classList.add('is-leaving');
      setTimeout(function () { loader.remove(); }, 350);
    }
  }
  build();
  window.addEventListener('hashchange', function () { render(false); });
  render(false);
  var bootController = new AbortController();
  var bootTimeout = setTimeout(function () { bootController.abort(); }, 30000);
  Promise.all([
    api('GET', '/api/me', undefined, bootController.signal).then(function (m) { isAdmin = !!m.admin; }).catch(function () { isAdmin = false; }),
    api('GET', '/api/store', undefined, bootController.signal).then(function (s) { state = s; loaded = true; }).catch(function (e) { loadError = e.name === 'AbortError' ? 'The connection is taking longer than expected. Please try again.' : e.message; })
  ]).then(function () { clearTimeout(bootTimeout); render(true); dismissLoader(); });
})();

(function () {
  'use strict';

  /* ---------- constants ---------- */
  var TILE_COLORS = ['#D6336C', '#B0245A', '#E8799F', '#9C2F5C', '#F08CA9', '#C2477A', '#A8345F', '#E0628F'];
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

  function api(method, url, body) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
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

  /* ---------- shell ---------- */
  function build() {
    var app = document.getElementById('app');
    clear(app);
    els.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
    els.adminLogin = h('a', { class: 'btn', href: '#admin', text: 'Admin login' });
    els.manage = h('button', { class: 'btn', type: 'button', hidden: true, onclick: function () { location.hash = route && route.name === 'admin' ? 'home' : 'admin'; } }, 'Manage store');
    els.logout = h('button', { class: 'btn', type: 'button', hidden: true, text: 'Log out', onclick: function () {
      els.logout.disabled = true;
      api('POST', '/api/logout').then(function () {
        isAdmin = false;
        location.hash = 'home';
        render(true);
      }).catch(function (e) {
        els.logout.disabled = false;
        toast(e.message, true);
      });
    } });
    els.search = h('input', {
      type: 'search', id: 'q', placeholder: 'Search pieces', 'aria-label': 'Search pieces',
      oninput: function () {
        ui.q = els.search.value;
        if (!route || route.name !== 'search') location.hash = 'search';
        else if (curRefresh) curRefresh();
      }
    });
    var masthead = h('header', { class: 'masthead' },
      h('a', { class: 'wordmark', href: '#home', text: 'Aakriti’s Wardrobe' }),
      h('div', { class: 'head-tools' }, h('div', { class: 'search' }, els.search), els.adminLogin, els.manage, els.logout));
    els.navList = h('ul');
    els.nav = h('nav', { class: 'catnav', 'aria-label': 'Categories' }, els.navList);
    els.main = h('main');
    els.foot = h('footer', { class: 'foot' });
    els.editor = h('dialog', { id: 'editor', 'aria-label': 'Item editor' });
    app.appendChild(h('div', { class: 'wrap' }, masthead, els.nav, els.main, els.foot));
    app.appendChild(els.editor);
    app.appendChild(els.toast);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && document.body.classList.contains('filters-open')) document.body.classList.remove('filters-open');
    });
  }

  function renderNav() {
    clear(els.navList);
    var cur = '';
    if (route.name === 'cat') cur = 'c-' + route.id;
    else if (route.name === 'item') { var it = itemById(route.id); if (it) cur = 'c-' + it.cat; }
    else if (route.name === 'home') cur = 'home';
    var links = [{ t: 'home', n: 'Home' }].concat(state.categories.map(function (c) { return { t: 'c-' + c.id, n: c.name }; }));
    links.forEach(function (l) {
      els.navList.appendChild(h('li', null, h('a', { href: '#' + l.t, text: l.n, 'aria-current': cur === l.t ? 'page' : null })));
    });
  }

  function renderFoot() {
    clear(els.foot);
    els.foot.appendChild(h('span', null, '© ' + new Date().getFullYear() + ' Aakriti’s Wardrobe'));
  }

  /* ---------- routing ---------- */
  function parseRoute() {
    var t = (location.hash || '').replace(/^#/, '');
    if (t.indexOf('p-') === 0) return { name: 'item', id: t.slice(2), token: t };
    if (t.indexOf('c-') === 0) return { name: 'cat', id: t.slice(2), token: t };
    if (t === 'new' || t === 'search' || t === 'admin') return { name: t, token: t };
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
    if (!loaded) node = loadError ? pageMessage('Could not load the catalogue', loadError) : h('p', { class: 'boot', text: 'Loading…' });
    else if (route.name === 'item') node = pageItem(itemById(route.id));
    else if (route.name === 'cat') {
      var c = catById(route.id);
      node = c ? pageList({ name: 'cat', title: c.name, subcategories: c.subcategories || [], crumbs: [['Home', '#home'], [c.name]], base: function () { return state.items.filter(function (i) { return i.cat === c.id; }); }, emptyText: 'Nothing in ' + c.name + ' yet. Check back soon.' })
        : pageMessage('That category isn’t here', 'Pick one from the menu above.');
    } else if (route.name === 'new') node = pageList({ name: 'new', title: 'New arrivals', crumbs: [['Home', '#home'], ['New arrivals']], base: function () { return state.items; }, emptyText: 'New pieces are on their way.' });
    else if (route.name === 'search') node = pageList({ name: 'search', title: 'Search', crumbs: [['Home', '#home'], ['Search']], base: function () { return state.items; }, emptyText: 'Nothing matches that search.' });
    else if (route.name === 'admin') node = isAdmin ? pageAdmin() : pageLogin();
    else node = pageHome();
    els.main.appendChild(node);
    document.body.classList.toggle('on-home', route.name === 'home');
    els.adminLogin.hidden = isAdmin;
    els.manage.hidden = !isAdmin;
    els.manage.textContent = route.name === 'admin' ? 'View store' : 'Manage store';
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
    if (isNew(it)) m.appendChild(h('div', { class: 'tags' }, h('span', { class: 'tag new', text: 'New' })));
    return m;
  }
  function card(it) {
    var c = catById(it.cat);
    var art = h('article', { class: 'card' },
      h('a', { class: 'card-main', href: '#p-' + it.id },
        media(it),
        h('div', { class: 'card-info' },
          h('span', { class: 'cat', text: c ? c.name : 'Uncategorised' }),
          h('h3', { text: it.name }),
          h('div', { class: 'price' }, h('b', { text: rupee(it.price) })))));
    if (isAdmin) art.appendChild(h('button', { class: 'btn sm edit-pill', type: 'button', onclick: function () { openEditor(it); }, text: 'Edit' }));
    return art;
  }

  /* ---------- home ---------- */
  function pageHome() {
    var f = document.createDocumentFragment();
    var title = h('h1', { text: 'Aakriti’s Wardrobe' });
    var exploreHref = state.categories[0] ? '#c-' + state.categories[0].id : '#new';
    f.appendChild(h('section', { class: 'home-hero' },
      h('div', { class: 'hero-clothing', 'aria-hidden': 'true' },
        h('div', { class: 'clothing-sketch sketch-top' },
          svgEl('<svg viewBox="0 0 300 340"><defs><linearGradient id="blouse-fabric" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6c6d5"/><stop offset=".48" stop-color="#d985a2"/><stop offset="1" stop-color="#ad5275"/></linearGradient><linearGradient id="blouse-sleeve" x1="0" y1="0" x2="0.9" y2="1"><stop stop-color="#f8dce5"/><stop offset="1" stop-color="#d990aa"/></linearGradient></defs><path d="m107 53 19-19h48l19 19 42 16 43 24-29 67-38-20v163H89V140l-38 20-29-67 43-24 42-16z" fill="url(#blouse-fabric)" stroke="currentColor" stroke-opacity=".75" stroke-width="2.5" stroke-linejoin="round"/><path d="m107 53-42 16-30 55 30 20 27-23-3 119c21 9 41 13 58 13V57l-40-4zm86 0 42 16 30 55-30 20-27-23 3 119c-21 9-41 13-58 13V57l40-4z" fill="url(#blouse-sleeve)" fill-opacity=".75" stroke="currentColor" stroke-opacity=".52" stroke-width="1.7" stroke-linejoin="round"/><path d="m107 53 19-19 24 17 24-17 19 19-22 36-21-18-21 18-22-36z" fill="#f6dce4" fill-opacity=".85" stroke="currentColor" stroke-opacity=".72" stroke-width="2" stroke-linejoin="round"/><path d="m126 34 24 17 24-17m-24 17v236m-35-177-16 14m91-14 16 14m-80 78c20 8 39 8 59 0m-59 20c20 8 39 8 59 0m-59 20c20 8 39 8 59 0m-58 22c19 7 38 7 57 0" fill="none" stroke="#fff0f4" stroke-opacity=".76" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M150 110v5m0 23v5m0 23v5m0 23v5m0 23v5m0 23v5" stroke="#78334f" stroke-width="4" stroke-linecap="round"/><path d="M91 278c39 12 79 12 118 0" fill="none" stroke="#7d3c58" stroke-opacity=".55" stroke-width="2"/><path d="M49 97 34 105l17 37m201-45 15 8-17 37" fill="none" stroke="#fff0f4" stroke-opacity=".72" stroke-width="2" stroke-linecap="round"/></svg>')),
        h('div', { class: 'clothing-sketch sketch-bra' },
          svgEl('<svg viewBox="0 0 320 240"><defs><linearGradient id="bra-cup" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#f6d4df"/><stop offset=".55" stop-color="#df9ab2"/><stop offset="1" stop-color="#bd6e8b"/></linearGradient><linearGradient id="bra-band" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d78ba5"/><stop offset="1" stop-color="#a94e70"/></linearGradient></defs><path d="m92 47 19-22 31 7 18 40 18-40 31-7 19 22 24 12-18 35-27-13-6 39c-16 17-33 24-51 24s-35-7-51-24l-6-39-27 13-18-35 24-12z" fill="none" stroke="currentColor" stroke-opacity=".7" stroke-width="2.2" stroke-linejoin="round"/><path d="m98 53 33 8c15 4 24 19 27 42 2 17-3 34-14 47-8 9-19 13-31 11-23-4-41-22-48-49l-8-33 41-26z" fill="url(#bra-cup)" stroke="currentColor" stroke-opacity=".72" stroke-width="2.4" stroke-linejoin="round"/><path d="m222 53-33 8c-15 4-24 19-27 42-2 17 3 34 14 47 8 9 19 13 31 11 23-4 41-22 48-49l8-33-41-26z" fill="url(#bra-cup)" stroke="currentColor" stroke-opacity=".72" stroke-width="2.4" stroke-linejoin="round"/><path d="M106 59c5 25 9 51 15 78 2 9 5 16 10 23m83-101c-5 25-9 51-15 78-2 9-5 16-10 23M160 116v25" fill="none" stroke="#fff0f4" stroke-opacity=".8" stroke-width="2.1" stroke-linecap="round"/><path d="M68 137c22 19 49 29 92 29s70-10 92-29l12 29c-27 21-61 31-104 31s-77-10-104-31l12-29z" fill="url(#bra-band)" stroke="currentColor" stroke-opacity=".75" stroke-width="2.2" stroke-linejoin="round"/><path d="M80 151c22 18 48 26 80 26s58-8 80-26m-159 22c23 17 49 25 79 25s56-8 79-25" fill="none" stroke="#fff0f4" stroke-opacity=".8" stroke-width="1.7"/><path d="M87 159c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0 8-3 12 0m26 0c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0 8-3 12 0" fill="none" stroke="#fff0f4" stroke-opacity=".9" stroke-width="1.6" stroke-linecap="round"/><path d="m111 28 11 29m87-29-11 29m-83 4 8 8m-5-15 9 8m96-1-8 8m5-15-9 8" fill="none" stroke="#fff0f4" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/><path d="M155 165v14m10-14v14" stroke="#79374f" stroke-width="2" stroke-linecap="round"/></svg>'))),
      h('div', { class: 'home-intro' },
        h('p', { class: 'hero-eyebrow' }, h('span', { text: 'A' }), ' PERSONAL WARDROBE'),
        title,
        h('p', { class: 'lead' },
          h('span', { text: "Aakriti's curated collection of her finest feminine essentials," }),
          h('span', { text: 'and an exclusive catalogue of her personal and intimate wardrobe.' })),
        h('a', { class: 'btn primary hero-cta', href: exploreHref }, 'Browse the wardrobe', h('span', { 'aria-hidden': 'true', text: '↗' })))));
    return f;
  }

  /* ---------- list pages ---------- */
  function pageList(o) {
    var f = document.createDocumentFragment();
    f.appendChild(crumbs(o.crumbs));
    var subEl = h('p');
    var selectedSubcategory = '';
    var subcategoryFilter = o.subcategories && o.subcategories.length ? h('select', {
      class: 'subcat-filter',
      'aria-label': 'Filter by subcategory',
      onchange: function () { selectedSubcategory = subcategoryFilter.value; refresh(); }
    }, h('option', { value: '', text: 'All subcategories' }), o.subcategories.map(function (s) {
      return h('option', { value: s.id, text: s.name });
    })) : null;
    f.appendChild(h('div', { class: 'list-head' }, h('h2', { text: o.title }), subEl));

    var count = h('p', { class: 'count', 'aria-live': 'polite' });
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
        h('div', { class: 'toolbar' }, count, h('div', { class: 'tb-right' },
          subcategoryFilter, sort, filterMenu)),
        active, grid)));
    buildFilters(); refresh();
    curRefresh = refresh;
    return f;
  }

  /* ---------- item page ---------- */
  function recommend(it) {
    var same = state.items.filter(function (x) { return x.id !== it.id && x.cat === it.cat; })
      .sort(function (a, b) { return Math.abs(a.price - it.price) - Math.abs(b.price - it.price); });
    var rest = state.items.filter(function (x) { return x.id !== it.id && x.cat !== it.cat; }).sort(newest);
    return same.concat(rest).slice(0, 8);
  }

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
    var copyBtn = h('button', { class: 'btn', type: 'button', text: 'Copy link' });
    function showBox() {
      var inp = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Link to this piece' });
      clear(linkSlot); linkSlot.appendChild(inp); inp.focus(); inp.select();
    }
    copyBtn.addEventListener('click', function () {
      var done = function () { copyBtn.textContent = 'Link copied'; setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000); };
      try { navigator.clipboard.writeText(url).then(done, showBox); } catch (e) { showBox(); }
    });
    actions.appendChild(copyBtn);
    if (isAdmin) actions.appendChild(h('button', { class: 'btn', type: 'button', text: 'Edit item', onclick: function () { openEditor(it); } }));

    f.appendChild(h('section', { class: 'item' },
      h('div', { class: 'gal' }, main, it.images.length > 1 ? thumbs : null),
      h('div', { class: 'i-body' },
        c ? h('a', { class: 'cat-link', href: '#c-' + c.id, text: c.name }) : null,
        h('h1', { text: it.name }),
        h('div', { class: 'price' }, h('b', { text: rupee(it.price) })),
        actions, linkSlot)));
    show(0);

    var recs = recommend(it);
    if (recs.length) {
      f.appendChild(h('section', { class: 'recs', 'aria-label': 'Recommended pieces' },
        h('div', { class: 'sec-head', style: 'margin-top:0' }, h('h2', { text: 'You may also like' }), c ? h('a', { class: 'link', href: '#c-' + c.id, text: 'More ' + c.name }) : null),
        h('div', { class: 'grid four' }, recs.map(card))));
    }
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
      h('h2', { text: 'Admin login' }),
      h('div', { class: 'field' }, h('label', { for: 'adm-pw', text: 'Password' }), pw),
      msg, h('div', null, go));
    return form;
  }

  function pageAdmin() {
    var a = h('section', { class: 'admin', 'aria-label': 'Manage store' });
    a.appendChild(h('div', { class: 'admin-head' },
      h('h2', { text: 'Manage store' }),
      ui.tab === 'items' ? h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null); }, text: 'Add item' }) : null));
    var tabs = [['items', 'Items (' + state.items.length + ')'], ['cats', 'Categories'], ['settings', 'Store details']];
    a.appendChild(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
      return h('button', { type: 'button', role: 'tab', 'aria-current': ui.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { ui.tab = t[0]; render(true); } });
    })));
    if (ui.tab === 'items') adminItems(a);
    else if (ui.tab === 'cats') adminCats(a);
    else adminSettings(a);
    return a;
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
    var rows = h('div', { class: 'rows' });
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
    var box = h('div', { class: 'rows' });
    catDraft.forEach(function (c, i) {
      c.subcategories = c.subcategories || [];
      var inp = h('input', { type: 'text', value: c.name, 'aria-label': 'Category name', id: 'cat-' + i, oninput: function () { c.name = inp.value; } });
      var used = state.items.filter(function (it) { return it.cat === c.id; }).length;
      var childRows = h('div', { class: 'subcategory-rows' });
      c.subcategories.forEach(function (sub, j) {
        var subInput = h('input', { type: 'text', value: sub.name, 'aria-label': c.name + ' subcategory name', oninput: function () { sub.name = subInput.value; } });
        var subUsed = state.items.filter(function (it) { return it.subcat === sub.id; }).length;
        childRows.appendChild(h('div', { class: 'subcategory-row' },
          h('div', { class: 'field' }, subInput, subUsed ? h('span', { class: 'hint', text: subUsed + (subUsed === 1 ? ' item' : ' items') }) : null),
          h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () {
            if (subUsed) { msg.textContent = '“' + sub.name + '” still has items assigned. Reassign them first.'; return; }
            c.subcategories.splice(j, 1); render(true);
          } })));
      });
      var subInput = h('input', { type: 'text', placeholder: 'New subcategory', 'aria-label': 'New subcategory for ' + c.name });
      var addSub = h('button', { class: 'btn sm', type: 'button', text: 'Add subcategory', onclick: function () {
        var name = subInput.value.trim();
        if (!name) return;
        c.subcategories.push({ id: '', name: name }); render(true);
      } });
      subInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addSub.click(); } });
      box.appendChild(h('div', { class: 'category-admin-card' },
        h('div', { class: 'cat-row' },
        h('div', { class: 'field' }, inp, used ? h('span', { class: 'hint', text: used + (used === 1 ? ' item' : ' items') }) : null),
        h('div', { class: 'acts' },
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: function () { catDraft.splice(i - 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '↑' }),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move down', disabled: i === catDraft.length - 1, onclick: function () { catDraft.splice(i + 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '↓' }),
          h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () {
            if (used) { msg.textContent = '“' + c.name + '” has ' + used + ' item' + (used === 1 ? '' : 's') + '. Move them to another category first.'; return; }
            catDraft.splice(i, 1); render(true);
          } }))),
        h('div', { class: 'category-subcategories' },
          h('h3', { text: 'Subcategories' }),
          childRows,
          h('div', { class: 'subcategory-add' }, subInput, addSub))));
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
    a.appendChild(h('p', { class: 'hint', text: 'Categories appear in the menu order. Add subcategories to organize items within each category.' }));
    a.appendChild(box);
    a.appendChild(h('div', { class: 'panel' }, h('div', { class: 'field' }, h('label', { for: 'new-cat', text: 'Add a category' }), newIn), addBtn));
    a.appendChild(msg);
    a.appendChild(h('div', null, save));
  }

  function adminSettings(a) {
    var tag = h('input', { type: 'text', id: 'st-tag', value: state.settings.tagline || '', maxlength: 120 });
    var wa = h('input', { type: 'tel', id: 'st-wa', value: state.settings.whatsapp || '', placeholder: '919876543210', inputmode: 'numeric' });
    var msg = h('p', { class: 'err', role: 'alert' });
    var save = h('button', { class: 'btn primary', type: 'button', text: 'Save details', onclick: function () {
      save.disabled = true; save.textContent = 'Saving…'; msg.textContent = '';
      api('PUT', '/api/settings', { tagline: tag.value, whatsapp: wa.value }).then(function () { toast('Store details saved'); return reload(); })
        .catch(function (e) { save.disabled = false; save.textContent = 'Save details'; msg.textContent = e.message; });
    } });
    a.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('label', { for: 'st-tag', text: 'Headline on the home page' }), tag),
      h('div', { class: 'field' }, h('label', { for: 'st-wa', text: 'WhatsApp number for enquiries' }), wa,
        h('span', { class: 'hint', text: 'Include the country code, digits only. Leave empty to hide the Enquire button.' })),
      msg, h('div', null, save)));
  }

  /* ---------- item editor ---------- */
  function shrink(file) {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return Promise.reject(new Error('Use JPG, PNG or WebP photos.'));
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 1500 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read that photo.')); }, 'image/jpeg', 0.86); });
    }, function () { return Promise.reject(new Error('Could not read that photo.')); });
  }

  function openEditor(item, presetCat) {
    var d = els.editor;
    var isEdit = !!item;
    var firstCat = presetCat && catById(presetCat) ? presetCat : (state.categories[0] ? state.categories[0].id : '');
    var draft = item ? { id: item.id, name: item.name, cat: item.cat, subcat: item.subcat || '', price: item.price, original_link: item.original_link || '' } : { id: '', name: '', cat: firstCat, subcat: '', price: '', original_link: '' };
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
    var subcat = h('select', { id: 'f-subcat', onchange: function () { draft.subcat = subcat.value; } });
    function drawSubcategories() {
      clear(subcat);
      var category = catById(draft.cat);
      subcat.appendChild(h('option', { value: '', text: 'No subcategory' }));
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
      if (!(p > 0)) { err.textContent = 'Enter a price greater than zero.'; price.focus(); return; }
      if (draft.original_link && !/^https?:\/\//i.test(draft.original_link)) { err.textContent = 'Original link must start with http:// or https://.'; originalLink.focus(); return; }
      var fd = new FormData(), order = [], n = 0;
      fd.append('name', nm); fd.append('cat', draft.cat); fd.append('price', String(p));
      fd.append('subcat', draft.subcat || '');
      fd.append('original_link', draft.original_link || '');
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
        return reload().then(function () { if (!isEdit && res.id && route.name !== 'admin') location.hash = 'p-' + res.id; });
      }).catch(function (e) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save changes' : 'Add to catalogue'; err.textContent = e.message; });
    } });

    d.appendChild(h('button', { class: 'dlg-close', type: 'button', 'aria-label': 'Close', onclick: closeEditor, text: '×' }));
    d.appendChild(h('div', { class: 'ed' },
      h('h2', { text: isEdit ? 'Edit item' : 'Add item' }),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Photos' }), photos,
        h('span', { class: 'hint', text: 'The first photo is the cover. JPG, PNG or WebP. Large photos are resized for you.' })),
      h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Name' }), name),
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: 'f-cat', text: 'Category' }), cat),
        h('div', { class: 'field' }, h('label', { for: 'f-price', text: 'Price (₹)' }), price)),
      h('div', { class: 'field' }, h('label', { for: 'f-subcat', text: 'Subcategory (optional)' }), subcat),
      h('div', { class: 'field' }, h('label', { for: 'f-original-link', text: 'Original link' }), originalLink),
      err));
    d.appendChild(h('div', { class: 'ed-foot' },
        h('span', { class: 'hint', text: isEdit ? '' : 'Each item gets its own page and link.' }),
        h('div', { class: 'grp' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeEditor }), saveBtn)));
    drawPhotos();
    if (!d.open) d.showModal();
  }

  /* ---------- boot ---------- */
  build();
  window.addEventListener('hashchange', function () { render(false); });
  render(false);
  Promise.all([
    api('GET', '/api/me').then(function (m) { isAdmin = !!m.admin; }).catch(function () { isAdmin = false; }),
    api('GET', '/api/store').then(function (s) { state = s; loaded = true; }).catch(function (e) { loadError = e.message; })
  ]).then(function () { render(true); });
})();

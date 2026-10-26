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
    els.manage = h('button', { class: 'btn', type: 'button', hidden: true, onclick: function () { location.hash = route && route.name === 'admin' ? 'home' : 'admin'; } }, 'Manage store');
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
      h('div', { class: 'head-tools' }, h('div', { class: 'search' }, els.search), els.manage));
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
    els.foot.appendChild(h('nav', { 'aria-label': 'Footer categories' }, state.categories.map(function (c) { return h('a', { href: '#c-' + c.id, text: c.name }); })));
    els.foot.appendChild(h('span', null, '© ' + new Date().getFullYear() + ' Aakriti’s Wardrobe · ', h('a', { href: '#admin', text: 'Admin' })));
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
      node = c ? pageList({ name: 'cat', title: c.name, crumbs: [['Home', '#home'], [c.name]], base: function () { return state.items.filter(function (i) { return i.cat === c.id; }); }, emptyText: 'Nothing in ' + c.name + ' yet. Check back soon.' })
        : pageMessage('That category isn’t here', 'Pick one from the menu above.');
    } else if (route.name === 'new') node = pageList({ name: 'new', title: 'New arrivals', crumbs: [['Home', '#home'], ['New arrivals']], base: function () { return state.items; }, emptyText: 'New pieces are on their way.' });
    else if (route.name === 'search') node = pageList({ name: 'search', title: 'Search', crumbs: [['Home', '#home'], ['Search']], base: function () { return state.items; }, emptyText: 'Nothing matches that search.' });
    else if (route.name === 'admin') node = isAdmin ? pageAdmin() : pageLogin();
    else node = pageHome();
    els.main.appendChild(node);
    document.body.classList.toggle('on-home', route.name === 'home');
    els.manage.hidden = !isAdmin;
    els.manage.textContent = route.name === 'admin' ? 'View store' : 'Manage store';
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
    var pills = ['Lingerie', 'Dresses', 'Nightwear', 'Footwear', 'Activewear'].map(function (n) {
      for (var i = 0; i < state.categories.length; i++) if (state.categories[i].name === n) return state.categories[i];
      return null;
    }).filter(Boolean);
    if (pills.length < 3) pills = state.categories.slice(0, 5);
    var deco = h('div', { class: 'hero-deco', 'aria-label': 'Featured categories' },
      h('div', { class: 'arch' }, svgEl(HANGER), h('span', { class: 'mono', text: 'A' }), h('small', { text: 'Aakriti’s Wardrobe' })),
      pills.map(function (c, i) { return h('a', { class: 'dpill p' + (i + 1), href: '#c-' + c.id, text: c.name }); }));
    var head = state.settings.tagline || 'Women’s clothing, picked by Aakriti.';
    var words = head.split(' '), h2 = h('h2');
    if (words.length > 2) { h2.appendChild(document.createTextNode(words.slice(0, -2).join(' ') + ' ')); h2.appendChild(h('em', { text: words.slice(-2).join(' ') })); }
    else h2.textContent = head;
    f.appendChild(h('section', { class: 'hero' },
      h('div', null,
        h('p', { class: 'kicker', text: 'New season edit' }),
        h2,
        h('p', { class: 'lead', text: 'Lingerie to footwear, chosen with care. Browse every piece, then message Aakriti to order.' }),
        h('div', { class: 'ctas' },
          h('a', { class: 'btn primary', href: '#new', text: 'See new arrivals' }),
          state.categories[0] ? h('a', { class: 'btn', href: '#c-' + state.categories[0].id, text: 'Browse ' + state.categories[0].name }) : null)),
      deco));
    return f;
  }

  /* ---------- list pages ---------- */
  function pageList(o) {
    var f = document.createDocumentFragment();
    f.appendChild(crumbs(o.crumbs));
    var subEl = h('p');
    f.appendChild(h('div', { class: 'list-head' }, h('h2', { text: o.title }), subEl));

    var count = h('p', { class: 'count', 'aria-live': 'polite' });
    var active = h('div', { class: 'active' });
    var grid = h('div', { class: 'grid' });
    var badge = h('span', { class: 'badge-n', hidden: true });
    var applyBtn = h('button', { class: 'btn primary', type: 'button', onclick: function () { document.body.classList.remove('filters-open'); } });
    var aside = h('aside', { class: 'filters', 'aria-label': 'Price filter' });
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
      clear(aside);
      var minIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, id: 'pmin', placeholder: 'Min', 'aria-label': 'Minimum price', value: ui.min, oninput: function () { ui.min = minIn.value; refresh(); } });
      var maxIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, id: 'pmax', placeholder: 'Max', 'aria-label': 'Maximum price', value: ui.max, oninput: function () { ui.max = maxIn.value; refresh(); } });
      var prices = o.base().map(function (i) { return i.price; });
      var range = prices.length ? 'Pieces here range from ' + rupee(Math.min.apply(null, prices)) + ' to ' + rupee(Math.max.apply(null, prices)) + '.' : '';
      aside.appendChild(h('div', { class: 'f-head' }, h('h2', { text: 'Price' }),
        h('button', { class: 'link', type: 'button', text: 'Clear', onclick: function () { ui.min = ''; ui.max = ''; buildFilters(); refresh(); } }),
        h('button', { class: 'f-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { document.body.classList.remove('filters-open'); } })));
      aside.appendChild(h('div', { class: 'f-group' }, h('div', { class: 'f-body' },
        BRACKETS.map(function (b) {
          var on = String(ui.min) === String(b.min) && String(ui.max) === String(b.max);
          return h('button', { class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: b.label, onclick: function () {
            if (on) { ui.min = ''; ui.max = ''; } else { ui.min = b.min; ui.max = b.max; }
            buildFilters(); refresh();
          } });
        }),
        h('div', { class: 'price-row' }, minIn, h('span', { text: 'to' }), maxIn),
        range ? h('p', { class: 'hint', text: range }) : null)));
      aside.appendChild(h('div', { class: 'f-foot' }, applyBtn));
    }

    function refresh() {
      var list = visible();
      clear(grid);
      list.forEach(function (it) { grid.appendChild(card(it)); });
      var n = list.length + (list.length === 1 ? ' piece' : ' pieces');
      count.textContent = n;
      applyBtn.textContent = 'Show ' + n;
      if (o.name === 'search') subEl.textContent = ui.q.trim() ? 'Results for “' + ui.q.trim() + '”' : 'All pieces';
      var on = ui.min !== '' || ui.max !== '';
      badge.hidden = !on; badge.textContent = on ? '1' : '';
      clear(active);
      if (on) {
        var l = ui.min !== '' && ui.max !== '' ? rupee(ui.min) + ' – ' + rupee(ui.max) : ui.min !== '' ? rupee(ui.min) + ' and above' : 'Under ' + rupee(Number(ui.max) + 1);
        active.appendChild(h('button', { class: 'pill', type: 'button', 'aria-label': 'Remove price filter', onclick: function () { ui.min = ''; ui.max = ''; buildFilters(); refresh(); } }, l, h('span', { 'aria-hidden': 'true', text: '×' })));
      }
      if (!list.length) {
        grid.style.display = 'block';
        var anyBase = o.base().length > 0;
        grid.appendChild(h('div', { class: 'empty' },
          h('h2', { text: anyBase ? 'Nothing matches yet' : 'Nothing here yet' }),
          h('p', { text: anyBase ? 'Try another price range or search.' : o.emptyText }),
          anyBase ? h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { ui.min = ''; ui.max = ''; if (o.name === 'search') { ui.q = ''; els.search.value = ''; } buildFilters(); refresh(); } })
            : (isAdmin ? h('button', { class: 'btn primary', type: 'button', text: 'Add an item', onclick: function () { openEditor(null, route.name === 'cat' ? route.id : null); } }) : null)));
      } else grid.style.display = '';
    }

    f.appendChild(h('div', { class: 'shop' }, aside,
      h('section', { class: 'results', 'aria-label': 'Pieces' },
        h('div', { class: 'toolbar' }, count, h('div', { class: 'tb-right' },
          h('button', { class: 'btn only-narrow', type: 'button', onclick: function () { document.body.classList.add('filters-open'); } }, 'Price ', badge), sort)),
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
      h('div', { class: 'ctas', style: 'display:flex;gap:8px;flex-wrap:wrap' },
        ui.tab === 'items' ? h('button', { class: 'btn primary', type: 'button', onclick: function () { openEditor(null); }, text: 'Add item' }) : null,
        h('button', { class: 'btn', type: 'button', text: 'Log out', onclick: function () { api('POST', '/api/logout').then(function () { isAdmin = false; location.hash = 'home'; render(true); }); } }))));
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
      var inp = h('input', { type: 'text', value: c.name, 'aria-label': 'Category name', id: 'cat-' + i, oninput: function () { c.name = inp.value; } });
      var used = state.items.filter(function (it) { return it.cat === c.id; }).length;
      box.appendChild(h('div', { class: 'cat-row' },
        h('div', { class: 'field' }, inp, used ? h('span', { class: 'hint', text: used + (used === 1 ? ' item' : ' items') }) : null),
        h('div', { class: 'acts' },
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: function () { catDraft.splice(i - 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '↑' }),
          h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Move down', disabled: i === catDraft.length - 1, onclick: function () { catDraft.splice(i + 1, 0, catDraft.splice(i, 1)[0]); render(true); }, text: '↓' }),
          h('button', { class: 'btn sm danger', type: 'button', text: 'Remove', onclick: function () {
            if (used) { msg.textContent = '“' + c.name + '” has ' + used + ' item' + (used === 1 ? '' : 's') + '. Move them to another category first.'; return; }
            catDraft.splice(i, 1); render(true);
          } }))));
    });
    var newIn = h('input', { type: 'text', id: 'new-cat', placeholder: 'New category, for example Accessories', 'aria-label': 'New category name' });
    var addBtn = h('button', { class: 'btn', type: 'button', text: 'Add category', onclick: function () {
      var name = newIn.value.trim(); if (!name) return;
      var id = slug(name), n = 2, base = id;
      while (catDraft.some(function (c) { return c.id === id; })) id = base + '-' + (n++);
      catDraft.push({ id: id, name: name }); render(true);
    } });
    newIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addBtn.click(); } });
    var save = h('button', { class: 'btn primary', type: 'button', text: 'Save categories', onclick: function () {
      save.disabled = true; save.textContent = 'Saving…'; msg.textContent = '';
      api('PUT', '/api/categories', { categories: catDraft }).then(function () { catDraft = null; toast('Categories saved'); return reload(); })
        .catch(function (e) { save.disabled = false; save.textContent = 'Save categories'; msg.textContent = e.message; });
    } });
    a.appendChild(h('p', { class: 'hint', text: 'Each category has its own page and appears in the menu in this order.' }));
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
    var draft = item ? { id: item.id, name: item.name, cat: item.cat, price: item.price } : { id: '', name: '', cat: firstCat, price: '' };
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
    var cat = h('select', { id: 'f-cat', onchange: function () { draft.cat = cat.value; } },
      state.categories.map(function (c) { return h('option', { value: c.id, text: c.name, selected: c.id === draft.cat }); }));
    var price = h('input', { type: 'number', id: 'f-price', min: 1, inputmode: 'numeric', value: draft.price, oninput: function () { draft.price = price.value; } });

    saveBtn = h('button', { class: 'btn primary', type: 'button', text: isEdit ? 'Save changes' : 'Add to catalogue', onclick: function () {
      err.textContent = '';
      var nm = String(draft.name).trim(), p = Math.round(Number(draft.price));
      if (!nm) { err.textContent = 'Give the item a name.'; name.focus(); return; }
      if (!draft.cat || !catById(draft.cat)) { err.textContent = 'Choose a category.'; return; }
      if (!(p > 0)) { err.textContent = 'Enter a price greater than zero.'; price.focus(); return; }
      var fd = new FormData(), order = [], n = 0;
      fd.append('name', nm); fd.append('cat', draft.cat); fd.append('price', String(p));
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

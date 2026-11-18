'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webImport = require('./lib/web-import');
const { readWishlistFields } = require('./lib/wishlist');
const diary = require('./public/diary-utils');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE) === 'true' || process.env.NODE_ENV === 'production';
const SESSION_DAYS = 14;

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.'); process.exit(1); }
if (!ADMIN_PASSWORD || !SESSION_SECRET) { console.error('ADMIN_PASSWORD and SESSION_SECRET must be set in .env.'); process.exit(1); }

// Neon needs SSL (its connection string already ends in ?sslmode=require).
// Neon also pauses idle databases, so allow time for the first connection and
// drop idle connections before Neon does.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.PGSSL) === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 10000
});
pool.on('error', (e) => console.error('Database connection dropped:', e.message));

/* ---------- small helpers ---------- */
const sign = (text) => crypto.createHmac('sha256', SESSION_SECRET).update(text).digest('hex');
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const newId = () => 'i' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isAdmin(req) {
  const v = readCookie(req, 'aw_admin');
  if (!v) return false;
  const [exp, mac] = v.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(exp));
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in as admin.' });
  next();
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- uploads (kept in memory, then stored in Postgres) ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }
});

// Decide the real type from the file's first bytes, never from what the browser claims.
function sniffImage(buf) {
  return webImport.imageType(buf);
}

/* ---------- data access ---------- */
async function loadStore() {
  const [settings, cats, subcats, items, imgs] = await Promise.all([
    pool.query('SELECT key, value FROM settings'),
    pool.query('SELECT id, name FROM categories ORDER BY position, name'),
    pool.query('SELECT id, category_id, name FROM subcategories ORDER BY category_id, position, name'),
    pool.query('SELECT id, name, category_id, subcategory_id, price, original_link, is_sample, created_at FROM items ORDER BY created_at DESC, id'),
    pool.query('SELECT id, item_id FROM item_images ORDER BY item_id, position, id')
  ]);
  const s = {};
  settings.rows.forEach((r) => { s[r.key] = r.value; });
  const byItem = {};
  imgs.rows.forEach((r) => { (byItem[r.item_id] = byItem[r.item_id] || []).push(r.id); });
  const byCategory = {};
  subcats.rows.forEach((r) => {
    (byCategory[r.category_id] = byCategory[r.category_id] || []).push({ id: r.id, name: r.name });
  });
  return {
    settings: { tagline: s.tagline || '', whatsapp: s.whatsapp || '' },
    categories: cats.rows.map((r) => ({ ...r, subcategories: byCategory[r.id] || [] })),
    items: items.rows.map((r) => ({
      id: r.id, name: r.name, cat: r.category_id, subcat: r.subcategory_id || '', price: r.price, original_link: r.original_link || '', sample: r.is_sample,
      created: r.created_at.toISOString(), images: byItem[r.id] || []
    }))
  };
}

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
  await pool.query("ALTER TABLE items ADD COLUMN IF NOT EXISTS original_link text NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS subcategory_id text');
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_category_subcategory_fkey') THEN
        ALTER TABLE items ADD CONSTRAINT items_category_subcategory_fkey
          FOREIGN KEY (category_id, subcategory_id)
          REFERENCES subcategories (category_id, id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
      END IF;
    END
    $$;
  `);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM categories');
  if (rows[0].n === 0) {
    await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'seed.sql'), 'utf8'));
    console.log('Loaded starter categories and sample items.');
  }
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render terminates HTTPS in front of the app
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/api/store', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await loadStore());
}));

app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ admin: isAdmin(req) });
});

const attempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = now; }
  if (rec.n >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const ok = typeof req.body.password === 'string' && safeEqual(req.body.password, ADMIN_PASSWORD);
  if (!ok) { rec.n += 1; attempts.set(ip, rec); return res.status(401).json({ error: 'That password is not right.' }); }
  attempts.delete(ip);
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  res.cookie('aw_admin', exp + '.' + sign(exp), { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: SESSION_DAYS * 864e5, path: '/' });
  res.json({ admin: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('aw_admin', { path: '/' });
  res.json({ admin: false });
});

/* Webpage image import: authenticated, bounded, and restricted to public addresses. */
function importToken(url, source) {
  const payload = Buffer.from(JSON.stringify({ url, source, exp: Date.now() + 30 * 60 * 1000 })).toString('base64url');
  return payload + '.' + sign('web-import:' + payload);
}
function readImportToken(token) {
  if (typeof token !== 'string' || token.length > 16000) throw webImport.fail('This image preview has expired. Scan the page again.');
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !safeEqual(mac, sign('web-import:' + payload))) throw webImport.fail('This image preview is not valid. Scan the page again.');
  let value;
  try { value = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw webImport.fail('This image preview is not valid.'); }
  if (!Number.isFinite(value.exp) || value.exp < Date.now()) throw webImport.fail('This image preview has expired. Scan the page again.');
  return value;
}
let importScans = 0, importImages = 0;
app.post('/api/import/scan', requireAdmin, wrap(async (req, res) => {
  if (importScans >= 2) return res.status(429).json({ error: 'An import is already running. Please try again in a moment.' });
  importScans++;
  try {
    const page = await webImport.download(webImport.webURL(req.body.url).href);
    const result = webImport.extractPage(page.data.toString('utf8'), page.url);
    res.set('Cache-Control', 'no-store');
    res.json({ ...result, images: result.images.map((url, i) => ({ id: i, preview: '/api/import/image?token=' + encodeURIComponent(importToken(url, page.url)) })) });
  } finally { importScans--; }
}));
app.post('/api/import/html', requireAdmin, upload.single('page'), wrap(async (req, res) => {
  const source = webImport.webURL(req.body.url).href;
  if (!req.file || !/\.html?$/i.test(req.file.originalname)) throw webImport.fail('Choose a saved .html or .htm webpage.');
  if (req.file.size > 2 * 1024 * 1024) throw webImport.fail('The saved webpage is larger than 2 MB. Save it as HTML only.');
  const result = webImport.extractPage(req.file.buffer.toString('utf8'), source);
  res.set('Cache-Control', 'no-store');
  res.json({ ...result, images: result.images.map((url, i) => ({ id: i, preview: '/api/import/image?token=' + encodeURIComponent(importToken(url, source)) })) });
}));
app.get('/api/import/image', requireAdmin, wrap(async (req, res) => {
  const value = readImportToken(req.query.token);
  if (importImages >= 12) return res.status(429).json({ error: 'Too many image requests. Try again in a moment.' });
  importImages++;
  try {
    const file = await webImport.download(value.url, { image: true, referer: value.source });
    const type = webImport.imageType(file.data);
    if (!type) throw webImport.fail('This image is not a supported JPG, PNG, WebP, GIF or AVIF photo.');
    res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
    res.send(file.data);
  } finally { importImages--; }
}));

/* Diary status: private to the admin, with calendar dates in India time. */
app.get('/api/diary', requireAdmin, wrap(async (req, res) => {
  const today = diary.todayISO();
  const year = String(req.query.year || today.slice(0, 4));
  if (!/^\d{4}$/.test(year) || !diary.validYear(year, today)) return res.status(400).json({ error: 'Choose a year from 2023 through the current year.' });
  const result = await pool.query("SELECT to_char(entry_date, 'YYYY-MM-DD') AS date, status FROM diary_entries WHERE entry_date >= $1::date AND entry_date < $2::date ORDER BY entry_date", [year + '-01-01', (Number(year) + 1) + '-01-01']);
  const entries = Object.fromEntries(result.rows.map((entry) => [entry.date, entry.status]));
  res.set('Cache-Control', 'no-store');
  res.json({ year: Number(year), today, entries, stats: diary.stats(Number(year), entries, today) });
}));
app.put('/api/diary/:date', requireAdmin, wrap(async (req, res) => {
  const date = req.params.date;
  const status = req.body && req.body.status;
  const error = diary.validateUpdate(date, status, diary.todayISO());
  if (error) return res.status(400).json({ error });
  if (status === 'not_written') await pool.query('DELETE FROM diary_entries WHERE entry_date = $1::date', [date]);
  else await pool.query('INSERT INTO diary_entries (entry_date, status) VALUES ($1::date, $2) ON CONFLICT (entry_date) DO UPDATE SET status = EXCLUDED.status, updated_at = now()', [date, status]);
  res.json({ date, status });
}));

/* Public wishlist viewing; changes remain admin-only. */
app.get('/api/wishlist', wrap(async (req, res) => {
  const result = await pool.query('SELECT id, title, url, created_at FROM wishlist ORDER BY created_at DESC, id');
  res.set('Cache-Control', 'no-store');
  res.json({ entries: result.rows });
}));
app.post('/api/wishlist', requireAdmin, wrap(async (req, res) => {
  const fields = readWishlistFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const result = await pool.query('INSERT INTO wishlist (id, title, url) VALUES ($1, $2, $3) RETURNING id, title, url, created_at', [newId(), fields.title, fields.url]);
  res.status(201).json(result.rows[0]);
}));
app.put('/api/wishlist/:id', requireAdmin, wrap(async (req, res) => {
  const fields = readWishlistFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });
  const result = await pool.query('UPDATE wishlist SET title = $2, url = $3 WHERE id = $1 RETURNING id, title, url, created_at', [req.params.id, fields.title, fields.url]);
  if (!result.rowCount) return res.status(404).json({ error: 'This wishlist entry no longer exists.' });
  res.json(result.rows[0]);
}));
app.delete('/api/wishlist/:id', requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM wishlist WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

/* items */
function readItemFields(req) {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const cat = String(req.body.cat || '');
  const subcat = String(req.body.subcat || '');
  const price = Math.round(Number(req.body.price));
  const originalLink = String(req.body.original_link || '').trim();
  if (!name) return { error: 'Give the item a name.' };
  if (!(price > 0) || price > 10000000) return { error: 'Enter a price greater than zero.' };
  if (!cat) return { error: 'Choose a category.' };
  if (!subcat) return { error: 'Choose a subcategory.' };
  if (!/^[a-z0-9-]{1,120}$/.test(subcat)) return { error: 'Choose a valid subcategory.' };
  if (originalLink && !/^https?:\/\//i.test(originalLink)) return { error: 'Original link must start with http:// or https://.' };
  return { name, cat, subcat, price, originalLink };
}

function resolveOrder(req, existing) {
  let order;
  try { order = JSON.parse(req.body.order || '[]'); } catch (e) { return { error: 'Photo list is not valid.' }; }
  if (!Array.isArray(order) || order.length > 12) return { error: 'Too many photos.' };
  const files = req.files || [];
  const types = files.map((f) => sniffImage(f.buffer));
  if (types.some((t) => !t)) return { error: 'Only JPG, PNG, WebP, GIF or AVIF photos are allowed.' };
  const final = []; // { id } for kept photos, { index } for new ones
  const usedNew = new Set();
  const keptIds = new Set();
  for (const tok of order) {
    if (typeof tok !== 'string') return { error: 'Photo list is not valid.' };
    if (tok.startsWith('f:')) {
      const id = Number(tok.slice(2));
      if (!existing.includes(id)) return { error: 'Photo list is not valid.' };
      if (!keptIds.has(id)) { keptIds.add(id); final.push({ id }); }
    } else if (tok.startsWith('n:')) {
      const i = Number(tok.slice(2));
      if (!Number.isInteger(i) || !files[i] || usedNew.has(i)) return { error: 'Photo list is not valid.' };
      usedNew.add(i); final.push({ index: i });
    } else return { error: 'Photo list is not valid.' };
  }
  return { final, types, files };
}

async function writeImages(client, itemId, o, existing) {
  const keep = o.final.filter((x) => x.id).map((x) => x.id);
  await client.query('DELETE FROM item_images WHERE item_id = $1 AND NOT (id = ANY ($2::int[]))', [itemId, keep]);
  for (let i = 0; i < o.final.length; i++) {
    const x = o.final[i];
    if (x.id) await client.query('UPDATE item_images SET position = $2 WHERE id = $1 AND item_id = $3', [x.id, i, itemId]);
    else await client.query('INSERT INTO item_images (item_id, content_type, data, position) VALUES ($1, $2, $3, $4)', [itemId, o.types[x.index], o.files[x.index].buffer, i]);
  }
}

app.post('/api/items', requireAdmin, upload.array('images', 10), wrap(async (req, res) => {
  const f = readItemFields(req);
  const o = f.error ? f : resolveOrder(req, []);
  if (o.error) return res.status(400).json({ error: o.error });
  const client = await pool.connect();
  const id = newId();
  try {
    await client.query('BEGIN');
    const wishlistId = typeof req.body.wishlist_id === 'string' ? req.body.wishlist_id : '';
    if (wishlistId) {
      const wish = await client.query('SELECT id FROM wishlist WHERE id = $1 FOR UPDATE', [wishlistId]);
      if (!wish.rowCount) throw Object.assign(new Error('This wishlist entry has already been moved or removed.'), { status: 404 });
    }
    const c = await client.query('SELECT 1 FROM categories WHERE id = $1', [f.cat]);
    if (!c.rowCount) throw Object.assign(new Error('That category no longer exists.'), { status: 400 });
    if (f.subcat) {
      const sc = await client.query('SELECT 1 FROM subcategories WHERE id = $1 AND category_id = $2', [f.subcat, f.cat]);
      if (!sc.rowCount) throw Object.assign(new Error('That subcategory does not belong to the selected category.'), { status: 400 });
    }
    await client.query('INSERT INTO items (id, name, category_id, subcategory_id, price, original_link) VALUES ($1, $2, $3, $4, $5, $6)', [id, f.name, f.cat, f.subcat || null, f.price, f.originalLink]);
    await writeImages(client, id, o, []);
    if (wishlistId) await client.query('DELETE FROM wishlist WHERE id = $1', [wishlistId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  res.status(201).json({ id });
}));

app.put('/api/items/:id', requireAdmin, upload.array('images', 10), wrap(async (req, res) => {
  const id = req.params.id;
  const f = readItemFields(req);
  const cur = await pool.query('SELECT id FROM item_images WHERE item_id = $1', [id]);
  const existing = cur.rows.map((r) => r.id);
  const o = f.error ? f : resolveOrder(req, existing);
  if (o.error) return res.status(400).json({ error: o.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT 1 FROM categories WHERE id = $1', [f.cat]);
    if (!c.rowCount) throw Object.assign(new Error('That category no longer exists.'), { status: 400 });
    if (f.subcat) {
      const sc = await client.query('SELECT 1 FROM subcategories WHERE id = $1 AND category_id = $2', [f.subcat, f.cat]);
      if (!sc.rowCount) throw Object.assign(new Error('That subcategory does not belong to the selected category.'), { status: 400 });
    }
    const u = await client.query('UPDATE items SET name = $2, category_id = $3, subcategory_id = $4, price = $5, original_link = $6, is_sample = false WHERE id = $1', [id, f.name, f.cat, f.subcat || null, f.price, f.originalLink]);
    if (!u.rowCount) throw Object.assign(new Error('That item no longer exists.'), { status: 404 });
    await writeImages(client, id, o, existing);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  res.json({ id });
}));

app.delete('/api/items/:id', requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/items', requireAdmin, wrap(async (req, res) => {
  if (req.query.sample !== '1') return res.status(400).json({ error: 'Nothing to delete.' });
  await pool.query('DELETE FROM items WHERE is_sample');
  res.json({ ok: true });
}));

/* categories */
app.put('/api/categories', requireAdmin, wrap(async (req, res) => {
  const list = Array.isArray(req.body.categories) ? req.body.categories : null;
  if (!list || !list.length || list.length > 40) return res.status(400).json({ error: 'Add at least one category.' });
  const seen = new Set(), subSeen = new Set(), names = new Set(), clean = [];
  for (const c of list) {
    const name = String((c && c.name) || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Every category needs a name.' });
    if (names.has(name.toLowerCase())) return res.status(400).json({ error: 'Two categories are called "' + name + '".' });
    names.add(name.toLowerCase());
    let id = c.id && /^[a-z0-9-]{1,60}$/.test(c.id) ? c.id : slug(name);
    const base = id; let n = 2;
    while (seen.has(id)) id = base + '-' + (n++);
    seen.add(id);
    const children = Array.isArray(c.subcategories) ? c.subcategories : [];
    if (children.length > 40) return res.status(400).json({ error: 'A category can have at most 40 subcategories.' });
    const childNames = new Set(), subcategories = [];
    for (const child of children) {
      const childName = String((child && child.name) || '').trim().slice(0, 40);
      if (!childName) return res.status(400).json({ error: 'Every subcategory needs a name.' });
      if (childNames.has(childName.toLowerCase())) return res.status(400).json({ error: 'Two subcategories in "' + name + '" are called "' + childName + '".' });
      childNames.add(childName.toLowerCase());
      let childId = child.id && /^[a-z0-9-]{1,120}$/.test(child.id) ? child.id : id + '-' + slug(childName);
      const childBase = childId; let childSuffix = 2;
      while (subSeen.has(childId)) childId = childBase + '-' + (childSuffix++);
      subSeen.add(childId);
      subcategories.push({ id: childId, name: childName });
    }
    clean.push({ id, name, subcategories });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const used = await client.query('SELECT DISTINCT category_id FROM items WHERE category_id <> ALL ($1::text[])', [clean.map((c) => c.id)]);
    if (used.rowCount) throw Object.assign(new Error('A category you removed still has items. Move them first.'), { status: 400 });
    const subcategoryIds = clean.flatMap((c) => c.subcategories.map((s) => s.id));
    const usedSubcategories = await client.query(
      'SELECT DISTINCT subcategory_id FROM items WHERE subcategory_id IS NOT NULL AND subcategory_id <> ALL ($1::text[])',
      [subcategoryIds]
    );
    if (usedSubcategories.rowCount) throw Object.assign(new Error('A subcategory you removed still has items. Reassign those items first.'), { status: 400 });
    // rename via temporary positions to avoid unique-name clashes while reordering
    await client.query('UPDATE categories SET name = id || \'#\' || position');
    for (let i = 0; i < clean.length; i++) {
      await client.query('INSERT INTO categories (id, name, position) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position', [clean[i].id, clean[i].name, i]);
    }
    await client.query("UPDATE subcategories SET name = '__old__' || id");
    for (const category of clean) {
      for (let i = 0; i < category.subcategories.length; i++) {
        const subcategory = category.subcategories[i];
        await client.query(
          'INSERT INTO subcategories (id, category_id, name, position) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name, position = EXCLUDED.position',
          [subcategory.id, category.id, subcategory.name, i]
        );
      }
    }
    await client.query('DELETE FROM subcategories WHERE id <> ALL ($1::text[])', [subcategoryIds]);
    await client.query('DELETE FROM categories WHERE id <> ALL ($1::text[])', [clean.map((c) => c.id)]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  res.json({ ok: true });
}));

/* settings */
app.put('/api/settings', requireAdmin, wrap(async (req, res) => {
  const tagline = String(req.body.tagline || '').trim().slice(0, 120);
  const whatsapp = String(req.body.whatsapp || '').replace(/\D/g, '').slice(0, 20);
  if (whatsapp && whatsapp.length < 8) return res.status(400).json({ error: 'Enter the WhatsApp number with country code, digits only.' });
  await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['tagline', tagline, 'whatsapp', whatsapp]);
  res.json({ ok: true });
}));

/* static files */
app.get('/img/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).end();
  const r = await pool.query('SELECT content_type, data FROM item_images WHERE id = $1', [id]);
  if (!r.rowCount) return res.status(404).end();
  res.set('Content-Type', r.rows[0].content_type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(r.rows[0].data);
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, index: 'index.html' }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    const m = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is larger than 5 MB.' : 'Could not read the photos.';
    return res.status(400).json({ error: m });
  }
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

init().then(() => {
  app.listen(PORT, () => console.log('Aakriti\'s Wardrobe is running at http://localhost:' + PORT));
}).catch((e) => { console.error('Could not start:', e.message); process.exit(1); });

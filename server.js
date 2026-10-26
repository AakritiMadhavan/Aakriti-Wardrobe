'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/* ---------- data access ---------- */
async function loadStore() {
  const [settings, cats, items, imgs] = await Promise.all([
    pool.query('SELECT key, value FROM settings'),
    pool.query('SELECT id, name FROM categories ORDER BY position, name'),
    pool.query('SELECT id, name, category_id, price, is_sample, created_at FROM items ORDER BY created_at DESC, id'),
    pool.query('SELECT id, item_id FROM item_images ORDER BY item_id, position, id')
  ]);
  const s = {};
  settings.rows.forEach((r) => { s[r.key] = r.value; });
  const byItem = {};
  imgs.rows.forEach((r) => { (byItem[r.item_id] = byItem[r.item_id] || []).push(r.id); });
  return {
    settings: { tagline: s.tagline || '', whatsapp: s.whatsapp || '' },
    categories: cats.rows,
    items: items.rows.map((r) => ({
      id: r.id, name: r.name, cat: r.category_id, price: r.price, sample: r.is_sample,
      created: r.created_at.toISOString(), images: byItem[r.id] || []
    }))
  };
}


async function init() {
  await pool.query(
    fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  );

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM categories');

  if (rows[0].n === 0) {
    await pool.query(
      fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8')
    );
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

/* items */
function readItemFields(req) {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const cat = String(req.body.cat || '');
  const price = Math.round(Number(req.body.price));
  if (!name) return { error: 'Give the item a name.' };
  if (!(price > 0) || price > 10000000) return { error: 'Enter a price greater than zero.' };
  if (!cat) return { error: 'Choose a category.' };
  return { name, cat, price };
}

function resolveOrder(req, existing) {
  let order;
  try { order = JSON.parse(req.body.order || '[]'); } catch (e) { return { error: 'Photo list is not valid.' }; }
  if (!Array.isArray(order) || order.length > 12) return { error: 'Too many photos.' };
  const files = req.files || [];
  const types = files.map((f) => sniffImage(f.buffer));
  if (types.some((t) => !t)) return { error: 'Only JPG, PNG, WebP or GIF photos are allowed.' };
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
    const c = await client.query('SELECT 1 FROM categories WHERE id = $1', [f.cat]);
    if (!c.rowCount) throw Object.assign(new Error('That category no longer exists.'), { status: 400 });
    await client.query('INSERT INTO items (id, name, category_id, price) VALUES ($1, $2, $3, $4)', [id, f.name, f.cat, f.price]);
    await writeImages(client, id, o, []);
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
    const u = await client.query('UPDATE items SET name = $2, category_id = $3, price = $4, is_sample = false WHERE id = $1', [id, f.name, f.cat, f.price]);
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
  const seen = new Set(), names = new Set(), clean = [];
  for (const c of list) {
    const name = String((c && c.name) || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Every category needs a name.' });
    if (names.has(name.toLowerCase())) return res.status(400).json({ error: 'Two categories are called "' + name + '".' });
    names.add(name.toLowerCase());
    let id = c.id && /^[a-z0-9-]{1,60}$/.test(c.id) ? c.id : slug(name);
    const base = id; let n = 2;
    while (seen.has(id)) id = base + '-' + (n++);
    seen.add(id); clean.push({ id, name });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const used = await client.query('SELECT DISTINCT category_id FROM items WHERE category_id <> ALL ($1::text[])', [clean.map((c) => c.id)]);
    if (used.rowCount) throw Object.assign(new Error('A category you removed still has items. Move them first.'), { status: 400 });
    // rename via temporary positions to avoid unique-name clashes while reordering
    await client.query('UPDATE categories SET name = id || \'#\' || position');
    for (let i = 0; i < clean.length; i++) {
      await client.query('INSERT INTO categories (id, name, position) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position', [clean[i].id, clean[i].name, i]);
    }
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

app.use(express.static(__dirname, {
  maxAge: 0,
  index: 'index.html'
}));
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

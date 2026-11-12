'use strict';
function readWishlistFields(body = {}) {
  if (!body || typeof body !== 'object') return { error: 'Enter a title and webpage link.' };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const raw = typeof body.url === 'string' ? body.url.trim() : '';
  if (!title || title.length > 100) return { error: 'Enter a title of up to 100 characters.' };
  if (!raw || raw.length > 4096) return { error: 'Enter a valid webpage link.' };
  let url;
  try { url = new URL(raw); } catch { return { error: 'Use a complete link starting with https:// or http://.' }; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { error: 'Use an http:// or https:// webpage link without login details.' };
  return { title, url: url.href };
}
module.exports = { readWishlistFields };

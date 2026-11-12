'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const zlib = require('node:zlib');
const ipaddr = require('ipaddr.js');
const { load } = require('cheerio');

const fail = (message) => Object.assign(new Error(message), { status: 400 });

function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
function webURL(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw fail('Enter a valid webpage URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096) {
    throw fail('Use a public http:// or https:// URL on its standard port.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (net.isIP(hostname) && !publicAddress(hostname))) {
    throw fail('Only public websites can be imported.');
  }
  url.hash = '';
  return url;
}
async function addresses(hostname, lookup = dns.lookup.bind(dns)) {
  let timer;
  try {
    const found = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(fail('The website took too long to respond.')), 5000); })
    ]);
    if (!found.length || found.some((entry) => !publicAddress(entry.address))) throw fail('Only public websites can be imported.');
    return found;
  } finally { clearTimeout(timer); }
}

async function download(value, { image = false, referer = '', redirects = 0 } = {}) {
  const url = webURL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const found = await addresses(hostname);
  // Pin the vetted DNS result to this connection, including each redirect.
  const pinned = found[0];
  const result = await new Promise((resolve, reject) => {
    let done = false, timer, response, stream;
    const finish = (err, data) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (err) { response?.destroy(); stream?.destroy(); request.destroy(); reject(err); }
      else resolve(data);
    };
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false,
      lookup: (_host, opts, cb) => opts.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family),
      headers: { 'User-Agent': 'WardrobeImporter/1.0', Accept: image ? 'image/*' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', ...(referer ? { Referer: referer } : {}) }
    }, (res) => {
      response = res;
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        return finish(null, { location });
      }
      if (res.statusCode < 200 || res.statusCode >= 300) return finish(fail('This website could not be read (' + res.statusCode + '). Try another page or upload photos manually.'));
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!image && !['text/html', 'application/xhtml+xml'].includes(type)) return finish(fail('That link is not a webpage. Paste a product or catalogue page URL.'));
      const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase();
      const decoder = { gzip: zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress }[encoding];
      if (encoding !== 'identity' && !decoder) return finish(fail('This website uses an unsupported response format.'));
      stream = decoder ? res.pipe(decoder()) : res;
      const chunks = []; let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > (image ? 5 : 2) * 1024 * 1024) return finish(fail(image ? 'That image is larger than 5 MB.' : 'That webpage is too large to import.'));
        chunks.push(chunk);
      });
      stream.on('end', () => finish(null, { data: Buffer.concat(chunks), type, url: url.href }));
      stream.on('error', () => finish(fail('Could not read the website response.')));
      res.on('error', () => finish(fail('The website connection was interrupted.')));
    });
    timer = setTimeout(() => finish(fail('The website took too long to respond.')), 15000);
    request.on('error', () => finish(fail('Could not connect to this website. Try another link or upload photos manually.')));
  });
  if (Object.hasOwn(result, 'location')) {
    if (!result.location || redirects >= 4) throw fail('This website redirects too many times.');
    return download(webURL(result.location, url).href, { image, referer, redirects: redirects + 1 });
  }
  return result;
}

function extractPage(html, pageUrl) {
  const $ = load(html);
  let base = pageUrl;
  try { base = webURL($('base[href]').first().attr('href') || pageUrl, pageUrl).href; } catch { /* use page URL */ }
  const images = [], seen = new Set();
  function add(value) {
    if (typeof value !== 'string' || !value.trim() || images.length >= 120) return;
    try {
      const parsed = webURL(value.trim().replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/'), base);
      if (/(^|\.)nykaa\.com$/i.test(parsed.hostname)) { parsed.pathname = parsed.pathname.replace(/\/tr:[^/]+/g, ''); parsed.searchParams.delete('tr'); }
      const url = parsed.href;
      if (/\.(svg|ico)(?:[?#]|$)/i.test(url)) return;
      if (!seen.has(url)) { seen.add(url); images.push(url); }
    } catch { /* ignore inline, private and invalid image URLs */ }
  }
  function imageValue(value) {
    if (Array.isArray(value)) value.forEach(imageValue);
    else if (value && typeof value === 'object') {
      if (value.mediaType && value.mediaType !== 'image') return;
      imageValue(value.url || value.contentUrl || value.src || value.originalSrc || value.original || value.large || value.image_url || value.imageUrl);
    }
    else add(value);
  }
  let product = null;
  function structured(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(structured);
    const types = [].concat(value['@type'] || []);
    if (types.some((t) => String(t).split('/').pop() === 'Product')) {
      if (!product) product = value;
      imageValue(value.image);
    }
    if (value['@graph']) structured(value['@graph']);
    if (value.mainEntity) structured(value.mainEntity);
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { structured(JSON.parse($(el).text())); } catch { /* invalid metadata */ } });
  // Product galleries in hydration data (Nykaa, Next.js, Shopify-style pages).
  // Parse JSON only: remote scripts are never executed.
  function hydration(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 25 || images.length >= 120) return;
    if (Array.isArray(value)) { value.forEach((entry) => hydration(entry, depth + 1)); return; }
    const entries = Object.entries(value);
    for (const [key, child] of entries) {
      if (/^(?:productMedia|media_gallery|mediaGallery|gallery|galleryImages|imageGallery|images|imageUrls|productImages|assets)$/i.test(key)) imageValue(child);
    }
    for (const [key, child] of entries) {
      if (/^(?:menu|navigation|header|footer|recommendations|relatedProducts|widgets|banners|sizeOptions|ecom_policies|cash_on_delivery|return_and_exchanges|tag|tag_list)$/i.test(key)) continue;
      if (/^(?:image|image_url|imageUrl|featured_image|featuredImage|primaryImage|mainImage|thumbnail)$/i.test(key)) imageValue(child);
      if (child && typeof child === 'object') hydration(child, depth + 1);
    }
  }
  $('script[type="application/json"],script#__PRELOADED_STATE__,script#__NEXT_DATA__,script[data-product-json]').each((_, el) => {
    try {
      const value = JSON.parse($(el).text());
      const roots = [value?.details?.skuData?.product, value?.hybridPDP?.product, value?.props?.pageProps?.product, value?.product];
      roots.filter(Boolean).forEach((root) => hydration(root));
      if (!roots.some(Boolean)) hydration(value);
    } catch { /* unsupported or invalid embedded state */ }
  });
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').each((_, el) => add($(el).attr('content')));
  $('img,source').each((_, el) => {
    const tag = $(el), w = Number(tag.attr('width')), h = Number(tag.attr('height'));
    if ((w > 0 && w <= 16) || (h > 0 && h <= 16)) return;
    for (const key of ['data-srcset', 'srcset']) {
      const entries = (tag.attr(key) || '').split(',').map((v) => v.trim().split(/\s+/)).filter((v) => v[0]);
      entries.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
      if (entries.length) add(entries[0][0]);
    }
    for (const key of ['data-zoom-image', 'data-large-image', 'data-full', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'src']) add(tag.attr(key));
  });
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    for (const match of style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1]);
  });
  $('a[href]').each((_, el) => { const value = $(el).attr('href'); if (/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(value || '')) add(value); });
  $('link[rel="preload"][as="image"]').each((_, el) => add($(el).attr('href')));
  $('noscript').each((_, el) => {
    const nested = load($(el).text()); nested('img').each((_, image) => { add(nested(image).attr('src')); add(nested(image).attr('data-src')); });
  });
  const name = String(product?.name || $('meta[property="og:title"]').attr('content') || $('title').text() || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const offer = [].concat(product?.offers || [])[0];
  // Prices are only prefilled when explicitly denominated in INR.
  const currency = offer?.priceCurrency || $('meta[property="product:price:currency"]').attr('content');
  const rawPrice = offer?.price || $('meta[property="product:price:amount"]').attr('content');
  const price = currency === 'INR' && Number(rawPrice) > 0 && Number(rawPrice) <= 10000000 ? Math.round(Number(rawPrice)) : '';
  return { name, price, source: pageUrl, images };
}
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['GIF87a','GIF89a'].includes(buf.subarray(0,6).toString())) return 'image/gif';
  if (buf.subarray(0,4).toString() === 'RIFF' && buf.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
module.exports = { webURL, publicAddress, addresses, download, extractPage, imageType, fail };

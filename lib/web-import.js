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
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: image ? 'image/*' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', ...(referer ? { Referer: referer } : {}) }
    }, (res) => {
      response = res;
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        return finish(null, { location });
      }
      if ([401, 403].includes(res.statusCode)) return finish(fail('This site refused the automatic import (' + res.statusCode + '). Open the page in your browser and use Import a saved webpage below, or upload photos manually.'));
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

// Read a JSON value assigned to a known hydration variable without running scripts.
function assignedJSON(text) {
  const values = [];
  const pattern = /(?:window\.)?(?:__(?:PRELOADED_STATE|INITIAL_STATE|NEXT_DATA)__|__myx)\s*=\s*/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[0].length;
    if (!['{', '['].includes(text[start])) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) { try { values.push(JSON.parse(text.slice(start, i + 1))); } catch { /* not JSON */ } break; }
      }
    }
  }
  return values;
}

function extractPage(html, pageUrl) {
  const $ = load(html);
  let base = pageUrl;
  try { base = webURL($('base[href]').first().attr('href') || pageUrl, pageUrl).href; } catch { /* use page URL */ }
  const images = [], seen = new Set(), ajioImages = new Map();
  function add(value) {
    if (typeof value !== 'string' || !value.trim() || images.length >= 120) return;
    try {
      const parsed = webURL(value.trim().replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/'), base);
      if (/(^|\.)nykaa\.com$/i.test(parsed.hostname)) { parsed.pathname = parsed.pathname.replace(/\/tr:[^/]+/g, ''); parsed.searchParams.delete('tr'); }
      const url = parsed.href;
      if (/\.(svg|ico)(?:[?#]|$)/i.test(url)) return;
      if (/(^|\.)ajio\.com$/i.test(parsed.hostname)) {
        const match = parsed.pathname.match(/\/-(\d+)Wx(\d+)H-([^/]+)$/i);
        if (match) {
          const key = match[3], score = Number(match[1]) * Number(match[2]);
          const previous = ajioImages.get(key);
          if (previous) { if (score > previous.score) { images[previous.index] = url; previous.score = score; } return; }
          ajioImages.set(key, { index: images.length, score });
        }
      }
      if (!seen.has(url)) { seen.add(url); images.push(url); }
    } catch { /* ignore inline, private and invalid image URLs */ }
  }
  function imageValue(value) {
    if (Array.isArray(value)) {
      if (value.some((entry) => entry && entry.format === 'superZoomPdp' && Number.isInteger(entry.galleryIndex))) {
        const best = new Map();
        const scores = { superZoomPdp: 4, product: 3, mobileProductListingImage: 2, thumbnail: 1, cartIcon: 0 };
        for (const entry of value) {
          if (!entry || !entry.url || !Number.isInteger(entry.galleryIndex)) continue;
          const previous = best.get(entry.galleryIndex);
          if (!previous || (scores[entry.format] || 0) > (scores[previous.format] || 0)) best.set(entry.galleryIndex, entry);
        }
        [...best.values()].forEach(imageValue);
      } else value.forEach(imageValue);
    }
    else if (value && typeof value === 'object') {
      if (value.mediaType && value.mediaType !== 'image') return;
      imageValue(value.url || value.contentUrl || value.src || value.originalSrc || value.original || value.large || value.image_url || value.imageUrl);
    }
    else add(value);
  }
  let product = null, embeddedProduct = null, myntraGallery = null;
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
    if (value.hasVariant) structured(value.hasVariant);
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
  function readState(value) {
    if (/(^|\.)myntra\.com$/i.test(new URL(pageUrl).hostname) && value?.pdpData?.media?.albums) {
      const gallery = [];
      for (const album of value.pdpData.media.albums) {
        if (album.name !== 'default') continue;
        for (const image of album.images || []) {
          const src = image.secureSrc || image.src || image.imageURL;
          if (typeof src === 'string') gallery.push(src.replace('($height)', '1440').replace('($width)', '1080').replace('($qualityPercentage)', '100'));
        }
      }
      if (gallery.length) myntraGallery = gallery;
      return;
    }
    const detail = value?.product?.productDetails;
    if (detail && typeof detail === 'object') embeddedProduct = detail;
    const roots = [detail, value?.details?.skuData?.product, value?.hybridPDP?.product, value?.props?.pageProps?.product, value?.product];
    roots.filter(Boolean).forEach((root) => hydration(root));
    if (!roots.some(Boolean)) hydration(value);
  }
  $('script').each((_, el) => {
    const tag = $(el), text = tag.text();
    if (tag.attr('type') === 'application/json' || ['__PRELOADED_STATE__', '__NEXT_DATA__'].includes(tag.attr('id')) || tag.attr('data-product-json') !== undefined) {
      try { readState(JSON.parse(text)); } catch { /* invalid embedded JSON */ }
    } else assignedJSON(text).forEach(readState);
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
  const name = String(embeddedProduct?.name || product?.name || $('meta[property="og:title"]').attr('content') || $('title').text() || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const offer = [].concat(product?.offers || [])[0];
  // Prices are only prefilled when explicitly denominated in INR.
  const currency = embeddedProduct?.price?.currencyIso || offer?.priceCurrency || $('meta[property="product:price:currency"]').attr('content');
  const rawPrice = embeddedProduct?.price?.value || offer?.price || $('meta[property="product:price:amount"]').attr('content');
  const price = currency === 'INR' && Number(rawPrice) > 0 && Number(rawPrice) <= 10000000 ? Math.round(Number(rawPrice)) : '';
  if (myntraGallery) {
    images.length = 0; seen.clear();
    myntraGallery.forEach(add);
  }
  return { name, price, source: pageUrl, images };
}
function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.length >= 16 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const size = buf.readUInt32BE(0);
    if (size >= 16 && size <= buf.length && size % 4 === 0) {
      const brands = [buf.toString('ascii', 8, 12)];
      for (let offset = 16; offset < size; offset += 4) brands.push(buf.toString('ascii', offset, offset + 4));
      if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif';
    }
  }
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['GIF87a','GIF89a'].includes(buf.subarray(0,6).toString())) return 'image/gif';
  if (buf.subarray(0,4).toString() === 'RIFF' && buf.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
module.exports = { assignedJSON, webURL, publicAddress, addresses, download, extractPage, imageType, fail };

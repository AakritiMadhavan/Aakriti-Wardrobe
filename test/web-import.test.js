'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webURL, publicAddress, addresses, extractPage, imageType } = require('../lib/web-import');
test('rejects private, credentialed and non-web URLs', () => {
 assert.equal(webURL('/photo.jpg','https://example.com/item').href,'https://example.com/photo.jpg');
 for(const v of ['file:///etc/passwd','https://u:p@example.com','http://localhost','http://127.1','http://2130706433','http://10.0.0.1','http://169.254.169.254','http://[::1]','http://[::ffff:127.0.0.1]','http://192.168.1.1','https://example.com:8080']) assert.throws(()=>webURL(v),{status:400});
});
test('rejects mixed DNS results and reserved IPs',async()=>{
 for(const a of ['0.0.0.0','100.64.0.1','192.0.2.1','224.0.0.1','::','fc00::1','fe80::1','::ffff:10.0.0.1']) assert.equal(publicAddress(a),false,a);
 assert.equal(publicAddress('1.1.1.1'),true); assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(addresses('example.com',async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]),{status:400});
});
test('extracts metadata, lazy images and largest srcset without duplicates or private images',()=>{
 const r=extractPage(`<base href="https://cdn.example.com/catalog/"><title>Fallback</title><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Linen dress","image":["/cover.jpg",{"url":"detail.jpg"}],"offers":{"price":"2499","priceCurrency":"INR"}}]}</script><meta property="og:image" content="/cover.jpg"><img src="data:image/png;base64,xxx"><img width="1" src="pixel.png"><img data-src="lazy.jpg"><img src="http://127.0.0.1/private.jpg"><img srcset="small.jpg 400w, large.jpg 1200w"><script type="application/ld+json">broken</script>`,'https://shop.example.com/product');
 assert.equal(r.name,'Linen dress');assert.equal(r.price,2499);
 assert.deepEqual(r.images,['https://cdn.example.com/cover.jpg','https://cdn.example.com/catalog/detail.jpg','https://cdn.example.com/catalog/lazy.jpg','https://cdn.example.com/catalog/large.jpg']);
});
test('does not prefill foreign currency; limits images',()=>{
 const r=extractPage('<script type="application/ld+json">{"@type":"Product","offers":{"price":10,"priceCurrency":"USD"}}</script>'+Array.from({length:200},(_,i)=>`<img src="/${i}.jpg">`).join(''),'https://example.com');
 assert.equal(r.price,'');assert.equal(r.images.length,120);
});
test('validates image bytes instead of claimed file type',()=>{
 assert.equal(imageType(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])),'image/png');
 assert.equal(imageType(Buffer.from('<html>not an image</html>')),null);
 assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),null);
});

const http = require('node:http');
const dns = require('node:dns').promises;
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { download } = require('../lib/web-import');
function mockNetwork(t, responses, inspect) {
 t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
 t.mock.method(http,'get',(url,opts,callback)=>{
  if(inspect) inspect(url,opts);
  const request=new EventEmitter();request.destroy=()=>{};
  const fixture=responses.shift();
  process.nextTick(()=>{
   const response=Readable.from([fixture.body || Buffer.from('')]);
   response.statusCode=fixture.status || 200;
   response.headers=fixture.headers || {'content-type':'text/html'};
   callback(response);
  });
  return request;
 });
}
test('pins vetted DNS results and extracts a bounded HTML response',async(t)=>{
 mockNetwork(t,[{body:Buffer.from('<title>A dress</title>')}],(url,opts)=>{
  assert.equal(opts.agent,false);
  opts.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
 });
 const page=await download('http://example.com/product');assert.equal(page.data.toString(),'<title>A dress</title>');
});
test('rejects a redirect to an internal address',async(t)=>{
 mockNetwork(t,[{status:302,headers:{location:'http://169.254.169.254/latest'}}]);
 await assert.rejects(download('http://example.com'),{status:400});
});
test('follows relative redirects and resolves images against the final page',async(t)=>{
 mockNetwork(t,[{status:302,headers:{location:'/catalog/item'}},{body:Buffer.from('<img src="photo.jpg">')}]);
 const page=await download('http://example.com');
 assert.equal(page.url,'http://example.com/catalog/item');
 assert.equal(extractPage(page.data.toString(),page.url).images[0],'http://example.com/catalog/photo.jpg');
});
test('rejects oversized and non-HTML webpages',async(t)=>{
 mockNetwork(t,[{body:Buffer.alloc(2*1024*1024+1)},{headers:{'content-type':'application/pdf'}}]);
 await assert.rejects(download('http://example.com'),/too large/);
 await assert.rejects(download('http://example.com'),/not a webpage/);
});
test('reads all five product photos from Nykaa hydration data without menu images',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/nykaa-gallery.html'),'utf8');
 const result=extractPage(html,'https://www.nykaafashion.com/product');
 assert.equal(result.images.length,5);
 assert.ok(result.images.every(url=>url.includes('MysMKRT2675_')));
});
test('reads Next.js galleries, thumbnail galleries, inline backgrounds and noscript images',()=>{
 const r=extractPage(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"images":[{"src":"/one.jpg"},{"originalSrc":"/two.jpg"}]}}}}</script><img width="40" src="/thumb.jpg"><div style="background-image:url('/background.jpg')"></div><noscript><img src="/fallback.jpg"></noscript>`,'https://example.com');
 for(const name of ['one','two','thumb','background','fallback']) assert.ok(r.images.includes('https://example.com/'+name+'.jpg'),name);
});
test('AJIO assigned hydration JSON yields five high-resolution images and metadata',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/ajio-gallery.html'),'utf8');
 const r=extractPage(html,'https://www.ajio.com/fig-women-wide-leg-flat-front-pants/p/443068138_brown');
 assert.equal(r.images.length,5);assert.ok(r.images.every(u=>u.includes('1117Wx1400H')));assert.equal(r.price,899);assert.equal(r.name,'Women Wide-Leg Flat-Front Pants');
});
test('assigned state reader handles escaped quotes/braces without executing JavaScript',()=>{
 const {assignedJSON}=require('../lib/web-import');
 assert.deepEqual(assignedJSON('window.__PRELOADED_STATE__ = {"name":"a \\" } brace","nested":[1,2]}; throw new Error("must not run");'),[{name:'a " } brace',nested:[1,2]}]);
 assert.deepEqual(assignedJSON('window.__PRELOADED_STATE__ = alert("not JSON");'),[]);
});
test('AJIO thumbnails do not duplicate or replace high resolution gallery photos',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/ajio-gallery.html'),'utf8');
 const r=extractPage(html+'<img src="https://assets-jiocdn.ajio.com/medias/thumbnail/-78Wx98H-443068138-brown-MODEL.jpg">','https://www.ajio.com/product');
 assert.equal(r.images.length,5);assert.ok(r.images[0].includes('1117Wx1400H'));
});
test('blocked imports point to the recovery options',async(t)=>{
 mockNetwork(t,[{status:403}]);await assert.rejects(download('http://example.com'),/Other ways to add this piece/);
});

test('Myntra assigned gallery imports all seven photos without templates, videos or menu images',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/myntra-gallery.html'),'utf8');
 const r=extractPage(html,'https://www.myntra.com/tops/dressberry/product/30038040/buy');
 assert.equal(r.images.length,7);
 assert.ok(r.images.every(url=>url.startsWith('https://assets.myntassets.com/h_1440,q_100,w_1080/')));
 assert.equal(new Set(r.images).size,7);
 assert.equal(r.name,'DressBerry Floral Printed Gathered Square Neck Peplum Top');
 assert.equal(r.price,904);
});

test('AVIF detection checks major and compatible brands without accepting generic HEIF or truncated boxes',()=>{
 function box(major,compatible=[]) {
  const b=Buffer.alloc(16+compatible.length*4);b.writeUInt32BE(b.length);b.write('ftyp',4);b.write(major,8);
  compatible.forEach((brand,i)=>b.write(brand,16+i*4));return b;
 }
 assert.equal(imageType(box('avif')),'image/avif');
 assert.equal(imageType(box('avis')),'image/avif');
 assert.equal(imageType(box('mif1',['avif'])),'image/avif');
 assert.equal(imageType(box('mif1',['heic'])),null);
 const truncated=box('avif');truncated.writeUInt32BE(64);assert.equal(imageType(truncated),null);
 assert.equal(imageType(Buffer.from('not an avif file')),null);
});

test('Nykaa Jamoti gallery excludes review, delivery and brand images',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/nykaa-jamoti-gallery.html'),'utf8');
 const r=extractPage(html,'https://www.nykaafashion.com/product/p/17677054');
 assert.equal(r.images.length,7);
 assert.ok(r.images.every(url=>url.includes('9d63b09221700_')));
 assert.equal(r.name,'HOUSE OF JAMOTI Dark Lavender Anarkali Kurta with Skirt and Dupatta (Set of 3)');
});
test('Myntra browser header is scoped so Nykaa page and CDN retain the original request profile',async(t)=>{
 mockNetwork(t,[{}, {}, {}],(url,opts)=>{
  assert.equal(opts.headers['User-Agent'],url.hostname==='www.myntra.com'?'Mozilla/5.0':'WardrobeImporter/1.0');
 });
 await download('http://www.nykaafashion.com/product');
 await download('http://adn-static1.nykaa.com/photo.jpg',{image:true});
 await download('http://www.myntra.com/product');
});

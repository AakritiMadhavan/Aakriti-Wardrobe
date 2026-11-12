'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readWishlistFields } = require('../lib/wishlist');
test('wishlist needs only a title and webpage link',()=>{
 assert.deepEqual(readWishlistFields({title:'  Linen dress  ',url:' https://example.com/dress?colour=pink#photos '}),{title:'Linen dress',url:'https://example.com/dress?colour=pink#photos'});
});
test('rejects empty, overly long and non-string fields',()=>{
 for(const body of [undefined,null,{},'',{title:'',url:'https://example.com'},{title:'x'.repeat(101),url:'https://example.com'},{title:['Dress'],url:'https://example.com'},{title:'Dress',url:42},{title:'Dress',url:'https://example.com/'+ 'x'.repeat(4096)}]) assert.ok(readWishlistFields(body).error);
});
test('rejects executable URLs and embedded credentials',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,hello','file:///tmp/a','https://user:password@example.com','example.com/product','not a link']) assert.ok(readWishlistFields({title:'Dress',url}).error,url);
});

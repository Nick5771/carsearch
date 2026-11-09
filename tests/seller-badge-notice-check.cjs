const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('findai-app.html','utf8'),code=html.slice(html.indexOf('  let sellerBadgeOwner='),html.indexOf('  function messageFallbackNotifications'));
(async()=>{
 let account='one',read={},resolve,requests=0,renders=0;
 const ctx={Date,Math,Array,Number,String,Set,marketplaceSession:()=>account,readLocalNoticeState:()=>read,writeLocalNoticeState:x=>read=x,marketplaceFetch:()=>{requests++;return new Promise(r=>resolve=r)},appNotificationCache:[],renderHomeNotifications:()=>renders++};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
 const first=ctx.sellerBadgeNotifications()[0];ctx.appNotificationCache.push(first);
 assert.equal(first.completedSales,null,'do not invent zero sales before a successful response');
 assert(ctx.sellerBadgeMarkup(first,0).includes('stroke="#fff"'));assert(!ctx.sellerBadgeMarkup(first,0).includes('<progress'));
 assert.equal(ctx.sellerBadgeNotifications()[0].id,first.id);assert.equal(requests,1,'one in-flight request');
 resolve({orders:[{id:'a',relationship:'seller',status:'completed'},{id:'a',relationship:'seller',status:'completed'},{id:'b',relationship:'buyer',status:'completed'},{id:'c',relationship:'seller',status:'refunded'},{id:'d',relationship:'seller',status:'paid'}]});await new Promise(setImmediate);
 assert.equal(first.completedSales,1);assert.equal(renders,1);assert(ctx.sellerBadgeMarkup(first,0).includes('1 out of 10 completed sales'));
 read[first.id]=Date.now();assert(ctx.sellerBadgeNotifications()[0].read_at,'read state persists');
 account='two';const second=ctx.sellerBadgeNotifications()[0];assert.notEqual(first.id,second.id);assert.equal(second.completedSales,null);account='three';ctx.sellerBadgeNotifications();resolve({orders:[]});await new Promise(setImmediate);account='';assert.equal(ctx.sellerBadgeNotifications().length,0);
 account='preview-session';ctx.getAccountProfile=()=>({username:'nick1'});const preview=ctx.sellerBadgeNotifications()[0];assert.equal(preview.previewOffset,5);assert(ctx.sellerBadgeMarkup(preview,0).includes('5 out of 10'));assert(ctx.sellerBadgeMarkup(preview,0).includes('value="5"'));assert(!ctx.sellerBadgeMarkup(preview,0).includes('Preview progress'));
 resolve({orders:[{id:'real',relationship:'seller',status:'completed'}]});await new Promise(setImmediate);assert(ctx.sellerBadgeMarkup(ctx.sellerBadgeNotifications()[0],0).includes('6 out of 10'));
 account='not-nick1';ctx.getAccountProfile=()=>({username:'someoneelse'});assert.equal(ctx.sellerBadgeNotifications()[0].previewOffset,0);

 console.log('PASS: account-scoped single notice, red tick, real completed seller orders only, duplicate/refund exclusions and persistent read state');
})().catch(e=>{console.error(e);process.exitCode=1});

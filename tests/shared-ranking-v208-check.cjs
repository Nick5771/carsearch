const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');
const block=source.slice(source.indexOf('// v208: shared engagement'),source.indexOf('export default {'));
const sql=new DatabaseSync(':memory:');
const db={prepare(text){let args=[];return {bind(...a){args=a;return this},async run(){return sql.prepare(text).run(...args)},async all(){return {results:sql.prepare(text).all(...args)}}}},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const c={console,Date,Math,Number,String,Set,Map,Uint8Array,TextEncoder,crypto:require('crypto').webcrypto,Response,
 jsonResp:(x,status=200)=>new Response(JSON.stringify(x),{status}),rateLimited:async()=>false,requireUser:async()=>({email:'tester@example.test'}),tooManyResp:()=>new Response('',{status:429})};
vm.createContext(c);vm.runInContext(block,c);
async function route(path,body){const req=new Request('https://api.test'+path,{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(body)});return c.sharedRecommendationRoute(req,{DB:db},new URL(req.url));}
(async()=>{
 assert.equal(c.sharedListingScore({n:4,engaged:4,intent:4}),0,'small samples never promoted');
 const good=c.sharedListingScore({n:100,engaged:70,intent:25,skipped:10});const bad=c.sharedListingScore({n:100,engaged:10,intent:1,skipped:80});assert(good>0&&bad<0);assert(good<=12&&bad>=-6);
 const a=c.sharedListingScore({n:100,engaged:60,intent:20,skipped:10});const b=c.sharedListingScore({n:10000,engaged:100,intent:30,skipped:9000});assert(a>b,'rates beat raw counts');
 assert.equal(c.sharedCleanEvent({key:'x:y',dwellMs:100}),null,'unqualified time ignored');assert.equal(c.sharedCleanEvent({key:'x:y',dwellMs:999999,liked:25}).ms,30000);assert.equal(c.sharedCleanEvent({key:'x:y',dwellMs:3000,liked:25}).liked,0,'only boolean action accepted');
 const visitor='abcdefghijklmnop';
 let r=await route('/recommendations/engagement',{visitor,events:[{key:'ebay:42',dwellMs:3500,liked:true}]});assert.equal(r.status,200);
 await route('/recommendations/engagement',{visitor,events:[{key:'ebay:42',dwellMs:5000,liked:true},{key:'ebay:42',dwellMs:3500,liked:true}]});
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM recommendation_exposures').get().n,1,'repeat batches cannot create extra exposures');
 assert.equal(sql.prepare('SELECT dwell_ms,liked FROM recommendation_exposures').get().dwell_ms,5000);
 await route('/recommendations/engagement',{visitor,events:[{key:'ebay:42',unliked:true}]});assert.equal(sql.prepare('SELECT liked FROM recommendation_exposures').get().liked,0,'unlike removes shared like');
 r=await route('/recommendations/scores',{keys:['ebay:42']});assert.equal((await r.json()).scores['ebay:42'].boost,0);
 r=await route('/recommendations/engagement',{visitor:'bad',events:[]});assert.equal(r.status,400);
 r=await c.sharedRecommendationRoute(new Request('https://api.test/recommendations/scores',{method:'POST',body:'{}'}),{},new URL('https://api.test/recommendations/scores'));assert.equal(r.status,503);
 console.log('PASS: real SQLite schema/upserts, bounded confidence scores, rates over raw volume, deduplication, unlike reversal, validation and missing-DB fallback');
 sql.close();
})().catch(e=>{console.error(e);process.exitCode=1});

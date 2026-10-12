const fs=require('fs'),vm=require('vm'),assert=require('assert');const {DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');const block=source.slice(source.indexOf('// v227: event-level'),source.indexOf('export default {'));
const sql=new DatabaseSync(':memory:');const env={DB:{prepare(text){let values=[];return{bind(...args){values=args;return this},async run(){return sql.prepare(text).run(...values)}}},async batch(rows){sql.exec('BEGIN');try{const out=[];for(const row of rows)out.push(await row.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
const c=vm.createContext({Date,Math,Number,String,Array,Set,Uint8Array,TextEncoder,crypto:require('crypto').webcrypto,jsonResp:(body,status=200)=>new Response(JSON.stringify(body),{status}),rateLimited:async()=>false,tooManyResp:()=>new Response('',{status:429}),requireUser:async()=>({email:'account@example.test'}),sharedCleanKey:value=>{const x=String(value||'');return x.length>=3&&x.length<=500&&!/[\u0000-\u001f]/.test(x)?x:'';}});vm.runInContext(block,c);
const event=(id,type,extra={})=>({id:'abcdefghijklmnop_'+id,key:'ebay:123',family:'building_sets|lego:42115',event:type,type:'building_sets',topics:['brand:lego','lego:technic:vehicles'],surface:'home',policy:'shopping-interest-v227',...extra});
async function route(events,headers={}){return c.recommendationInterestEvents(new Request('https://api.test/recommendations/interest-events',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1',...headers},body:JSON.stringify({visitor:'abcdefghijklmnop',events})}),env);}
(async()=>{
 let r=await route([event(1,'exposure'),event(2,'attention',{ms:6000}),event(3,'like'),event(4,'purchase')]);assert.equal(r.status,200);assert.equal((await r.json()).accepted,3);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM recommendation_interest_events').get().n,3);assert.equal(sql.prepare("SELECT dwell_ms FROM recommendation_interest_events WHERE event='attention'").get().dwell_ms,6000);
 await route([event(1,'exposure'),event(3,'like')]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM recommendation_interest_events').get().n,3,'retry does not duplicate event history');
 r=await route([event(5,'attention',{ms:100}),event(6,'like',{policy:'wrong'}),event(7,'like',{topics:['<script>']})]);assert.equal((await r.json()).accepted,0);
 await route([event(1,'exposure')],{Authorization:'Bearer verified-session'});assert.equal(sql.prepare('SELECT COUNT(DISTINCT viewer_key) n FROM recommendation_interest_events').get().n,2,'verified account separated from guest');
 assert(!sql.prepare('SELECT viewer_key FROM recommendation_interest_events LIMIT 1').get().viewer_key.includes('account'));
 r=await c.recommendationInterestEvents(new Request('https://api.test',{method:'POST',body:'null'}),env);assert.equal(r.status,400);
 console.log('PASS: event-ledger schema, qualified attention, idempotent retries, topic/policy validation, purchase rejection, account/guest identity separation and malformed bodies');sql.close();
})().catch(e=>{console.error(e);sql.close();process.exitCode=1});

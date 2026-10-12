const fs=require('fs'),vm=require('vm'),assert=require('assert'),{DatabaseSync}=require('node:sqlite');
const worker=fs.readFileSync(__dirname+'/../findai-worker.js','utf8'),block=worker.slice(worker.indexOf('// v228: shopping profiles'),worker.indexOf('export default {'));
const sql=new DatabaseSync(':memory:');const env={DB:{prepare(text){let args=[];return {bind(...values){args=values;return this},async run(){return sql.prepare(text).run(...args)},async all(){return {results:sql.prepare(text).all(...args)}}}},async batch(rows){sql.exec('BEGIN');try{const result=[];for(const row of rows)result.push(await row.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
const ctx=vm.createContext({Date,Math,String,Number,Array,Set,Map,Object,Uint8Array,TextEncoder,URL,crypto:require('crypto').webcrypto,logErr:()=>{},jsonResp:(body,status=200)=>new Response(JSON.stringify(body),{status}),rateLimited:async()=>false,tooManyResp:()=>new Response('',{status:429}),requireUser:async r=>r.headers.get('Authorization')?{email:r.headers.get('Authorization')}:{fail:new Response('',{status:401})},sharedCleanKey:v=>typeof v==='string'&&v.length>=3&&v.length<=500&&!/[\u0000-\u001f]/.test(v)?v:''});vm.runInContext(block,ctx);
const now=Date.now(),op=(n,event='like',extra={})=>({family:'diecast:'+n,event,at:now+n,item:{title:'Hot Wheels Porsche '+n+' diecast model car 1:64',price:20+n,currency:'AUD',condition:'new'},details:{},...extra});
async function profile(method,events=[],account='account-A'){return ctx.recommendationShoppingProfile(new Request('https://api.test/recommendations/shopping-profile',{method,headers:account?{Authorization:account}:{},...(method==='POST'?{body:JSON.stringify({events})}:{})}),env);}
(async()=>{
 assert.equal((await profile('GET',[],null)).status,401);
 let r=await profile('POST',[op(1),op(2)]);let data=await r.json();assert.equal(data.accepted,2);assert(data.state.profile['type:diecast_vehicles']);
 await profile('POST',[op(1),op(2)]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM recommendation_shopping_evidence').get().n,2,'idempotent family/day/action ingestion');
 await profile('POST',[op(3)]);data=await (await profile('GET')).json();assert.equal(data.state.profile['type:diecast_vehicles'].products.length,3,'devices union their interests');
 data=await (await profile('GET',[],'account-B')).json();assert.equal(Object.keys(data.state.profile).length,0,'accounts isolated');
 data=await (await profile('POST',[op(1,'unlike',{at:now+100})])).json();assert(data.state.profile['type:diecast_vehicles'].positive<3);
 await profile('POST',[op(1,'like',{at:now+200})]);const restored=await (await profile('GET')).json();assert(restored.state.profile['type:diecast_vehicles'].positive>data.state.profile['type:diecast_vehicles'].positive);
 data=await (await profile('POST',[op(4,'purchase'),op(4,'like',{at:0}),op(4,'like',{item:{title:'unknown'}})])).json();assert.equal(data.accepted,0);
 const who=await ctx.shoppingViewer(new Request('https://api.test',{headers:{Authorization:'account-A'}}),env,'');const arm=ctx.shoppingArm(who.viewer);
 const trial=(n,event='impression',extra={})=>({id:'abcdefghijklmnop_trial_'+n,exposureId:'abcdefghijklmnop_ex_1',key:'ebay:123',family:'diecast:1',event,position:3,arm,surface:'home',ms:5000,policy:'shopping-v228',...extra});
 async function measure(events){return ctx.recommendationTrials(new Request('https://api.test/recommendations/trials',{method:'POST',headers:{Authorization:'account-A'},body:JSON.stringify({visitor:'abcdefghijklmnop',events})}),env);}
 data=await (await measure([trial(1),trial(2,'click'),trial(3,'purchase'),trial(4,'like',{arm:arm==='control'?'treatment':'control'})])).json();assert.equal(data.accepted,2);
 await measure([trial(1),trial(2,'click')]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM recommendation_trials').get().n,2);
 const first=await ctx.recommendationExperiment(new Request('https://api.test/recommendations/experiment?visitor=abcdefghijklmnop',{headers:{Authorization:'account-A'}}),env);assert.equal((await first.json()).arm,arm);
 await profile('DELETE');data=await (await profile('GET')).json();assert.equal(Object.keys(data.state.profile).length,0);
 assert(!sql.prepare('SELECT viewer_key FROM recommendation_trials LIMIT 1').get().viewer_key.includes('account'));
 console.log('PASS: verified-account access, idempotent multi-device union, unlike/re-like ordering, isolation, validation, profile deletion, stable server assignment and attributed trial validation');sql.close();
})().catch(e=>{console.error(e);sql.close();process.exitCode=1});

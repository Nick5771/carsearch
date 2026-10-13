// Read the existing public search API. Preserve evidence; never invent product offers.
const fs=require('fs'),path=require('path'),policy=require('../findai-treasure-pilot.js');
const output=process.argv.slice(2).find(x=>!x.startsWith('--'))||path.join(__dirname,'../data/treasure-pilot-supply-audit.json');
const origin=process.env.FINDAI_API_ORIGIN||'https://api.carsearchapi.workers.dev';
const retryExisting=process.argv.includes('--retry');
const results=retryExisting&&fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')).results:[];
async function audit(target,passive=true){
 const u=new URL('/api/search-fast',origin);u.search=new URLSearchParams({q:target.query,country:'US',limit:'24',passive:passive?'1':'0'}).toString();
 const started=Date.now();
 try{
  const response=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0','Origin':'https://findai.ai'},signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const body=await response.json(),items=Array.isArray(body.items)?body.items:[];
  const candidates=items.filter(x=>policy.match(target,x)).slice(0,6).map(x=>({itemId:x.itemId||x.id||null,title:x.title,source:x.source,url:x.url||x.itemWebUrl,image:x.image||x.images?.[0]||x.stockxImage,price:Number(x.price),currency:x.currency,condition:x.condition||null,providerObservedAt:x._ebayFetchedAt||null,availabilitySignal:x.available??x.inStock??null}));
  const incomplete=Object.values(body.sourceHealth||{}).some(x=>['timeout','failed','quota_deferred','refresh_pending'].includes(x.status));
  return {id:target.id,query:target.query,checkedAt:new Date().toISOString(),passive,elapsedMs:Date.now()-started,returned:items.length,candidateCount:candidates.length,status:candidates.length?'provider_candidates_found':incomplete?'supply_check_incomplete':'no_matching_candidates',authenticationVerified:false,checkoutStockVerified:false,shippingToUSVerified:false,candidates,sourceHealth:body.sourceHealth||null};
 }catch(error){return {id:target.id,query:target.query,checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,status:'request_failed',error:String(error.message),candidates:[]};}
}
(async()=>{
 const selected=retryExisting?policy.targets.filter(target=>!results.some(x=>x.id===target.id&&x.status==='provider_candidates_found')):policy.targets;
 for(let i=0;i<selected.length;i+=3){
  const batch=await Promise.all(selected.slice(i,i+3).map(target=>audit(target)));
  for(const row of batch){const old=results.findIndex(x=>x.id===row.id);if(old<0)results.push(row);else results[old]=row;}
  for(const x of batch)console.log(x.id,x.status,x.candidateCount||0);
  fs.writeFileSync(output,JSON.stringify({version:policy.version,market:'US',checkedAt:new Date().toISOString(),scope:'Provider observations and strict title/form checks; not seller authentication or checkout verification',results},null,2)+'\n');
 }
 for(let i=0;i<results.length;i++){
  if(results[i].status!=='supply_check_incomplete')continue;
  const initial=results[i],retry=await audit(policy.targets.find(x=>x.id===initial.id),false);
  results[i]={...retry,firstAttempt:{status:initial.status,returned:initial.returned,sourceHealth:initial.sourceHealth}};
  console.log('retry',retry.id,retry.status,retry.candidateCount||0);
  fs.writeFileSync(output,JSON.stringify({version:policy.version,market:'US',checkedAt:new Date().toISOString(),scope:'Provider observations and strict title/form checks; not seller authentication or checkout verification',results},null,2)+'\n');
 }
 console.log('Saved',output);
})().catch(error=>{console.error(error);process.exitCode=1});

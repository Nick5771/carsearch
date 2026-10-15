/* Device-local product rotation. This stores exposure history, never engagement counts. */
(function(root){
 'use strict';
 const hash=value=>{let h=2166136261;for(const c of String(value)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;};
 const key=item=>item?._treasureTargetId||root.FindAITreasureHunt?.identify?.(item)?.id||root.wishwaveDiscoverySurfaces?.key(item)||String(item?.itemId||item?.id||item?.url||'');
 const lego=item=>/\blego\b/i.test(String(item?._treasureCategory||'')+' '+String(item?._interestCategory||'')+' '+String(item?.title||'')+' '+String(item?.query||''));
 function create({storage,scope=()=> 'guest',now=()=>Date.now(),seed=()=>Math.random()}={}){
  let owner='',rows={},previous={},salt=seed();
  function load(){const who='ww_product_rotation_v271_'+hash(scope()||'guest');if(owner===who)return;owner=who;rows={};try{const saved=JSON.parse(storage?.getItem(who)||'{}');for(const[k,v]of Object.entries(saved))if(v.at>now()-14*86400000)rows[k]=v;}catch(_){}previous={...rows};salt=seed();}
  function save(){try{const entries=Object.entries(rows).sort((a,b)=>b[1].at-a[1].at).slice(0,1800);storage?.setItem(owner,JSON.stringify(Object.fromEntries(entries)));}catch(_){} }
  function rank(items){load();return [...items].sort((a,b)=>{
   const ka=key(a),kb=key(b),aAt=previous[ka]?.at||0,bAt=previous[kb]?.at||0;
   // Prefer products absent from recent visits before considering seller-level novelty.
   return Number(aAt>now()-86400000)-Number(bAt>now()-86400000)||aAt-bAt||hash(salt+ka)-hash(salt+kb)||hash(salt+String(a.itemId||a.url))-hash(salt+String(b.itemId||b.url));
  });}
  function remember(items,kind){load();for(const item of items||[]){const k=key(item);if(k)rows[k]={at:now(),kind};}save();}
  return {rank,served:items=>remember(items,'opening'),observe:item=>remember([item],'view'),newVisit(){load();previous={...rows};salt=seed();},allowed(item,history=[]){return !lego(item)||history.slice(-19).filter(lego).length<2;},key,lego};
 }
 const api={create,key,lego};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root.document){let storage;try{storage=root.localStorage;}catch(_){}root.wishwaveDiscoveryRotation=create({storage,scope:()=>root.wishwaveRecommendationAccount?.()||root.getAccountProfile?.()?.email||'guest'});}
})(globalThis);

/* Comparable current asking prices. No sold-price or authenticity claims. */
(function(root){
 'use strict';
 const noise=new Set(('a an and the for with of to in on from by new used preowned pre owned sealed unopened boxed box nib bnib mint excellent good condition authentic genuine official rare vintage complete tested working free shipping ship fast expedited express delivery adult unisex sale figure figures toy toys import imported japan japanese jp us usa uk mens men womens women size edition').split(' '));
 function tokens(value){return [...new Set(String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/s[.\s]*h[.\s]*figuarts/g,'shfiguarts').replace(/chibimoon/g,'chibi moon').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x&&!noise.has(x)&&x.length>1))];}
 function condition(item){const s=String(item?.condition||item?.conditionText||'').toLowerCase();if(/refurb/.test(s))return 'refurbished';if(/pre.?owned|used|very good|excellent|acceptable|fair/.test(s))return 'used';if(/new|sealed|unopened|unworn/.test(s))return 'new';return '';}
 function currency(item,fallback=''){return String(item?.currency||fallback||'').toUpperCase();}
 function context(query,item={}){
  const base=tokens(query),extras=tokens(item.title).filter(x=>!base.includes(x));
  return {query:[...base,...extras].join(' ').slice(0,180),required:[...new Set([...base,...extras])],currency:currency(item),condition:condition(item)};
 }
 const variants=new Set('chibi pluto mercury mars jupiter venus saturn uranus neptune mini super pro max plus lite xl deluxe limited remastered reissue anniversary'.split(' '));
 function matches(item,ctx){
  if(!ctx||!item||!Number.isFinite(Number(item.price))||Number(item.price)<=0)return false;
  if(item.available===false||item.soldOut||item.sold||item.outOfStock)return false;
  const title=String(item.title||'');if(/\b(replica|bootleg|recast|counterfeit|replacement|accessory|accessories|parts only|box only|empty box|manual only|digital download)\b/i.test(title))return false;
  if(/\b(bundle|lot of|set of|[2-9]\s*pack|pack of [2-9])\b/i.test(title)&&!ctx.required.some(x=>['bundle','lot','set'].includes(x)))return false;
  const words=new Set(tokens(title));if(ctx.required.length<2||!ctx.required.every(x=>words.has(x)))return false;
  if([...words].some(x=>variants.has(x)&&!ctx.required.includes(x)))return false;
  if(ctx.currency&&currency(item)!==ctx.currency)return false;
  if(ctx.condition&&condition(item)!==ctx.condition)return false;
  return true;
 }
 const numeric=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
 function quote(item,fallback=''){
  const price=numeric(item?.price),code=currency(item,fallback);let shipping=null;
  const detail=item?.shipping;
  const shipCurrency=String(detail?.currency||detail?.cost?.currency||item?.shippingCurrency||code).toUpperCase();
  if(item?.deliveryMode!=='pickup'&&shipCurrency===code){
   for(const value of [item?.shippingCost,item?.deliveryCost,detail?.cost?.value,detail?.cost,detail?.amount,detail?.value]){const n=numeric(value);if(n!==null){shipping=n;break;}}
   if(shipping===null&&(item?.freeShipping===true||detail?.free===true||/^free(?: shipping| delivery)?$/i.test(String(detail||item?.shippingText||'').trim())))shipping=0;
  }
  return {price,currency:code,shipping,known:shipping!==null&&price!==null,total:shipping!==null&&price!==null?price+shipping:null};
 }
 function order(items,code=''){
  return (items||[]).filter(x=>!code||currency(x)===code).map((item,index)=>({item,index,q:quote(item,code)})).sort((a,b)=>Number(b.q.known)-Number(a.q.known)||(a.q.known?a.q.total-b.q.total:(a.q.price??Infinity)-(b.q.price??Infinity))||a.index-b.index).map(x=>x.item);
 }
 function prepare(items,ctx,fallback=''){
  const code=ctx.currency||fallback,scoped={...ctx,currency:code},seen=new Set();
  return order((items||[]).filter(item=>{if(!matches(item,scoped))return false;const key=String(item.itemId||item.marketplaceListingId||item.url||'');if(key&&seen.has(key))return false;if(key)seen.add(key);return true;}),code);
 }
 function summary(items,code){const prices=items.map(x=>quote(x,code)).filter(x=>x.known&&x.currency===code).map(x=>x.total).sort((a,b)=>a-b),n=prices.length;return {currency:code,count:items.length,pricedCount:n,lowest:n?prices[0]:null,typical:n>=2?(n%2?prices[(n-1)/2]:(prices[n/2-1]+prices[n/2])/2):null};}
 function format(value,code){return value===null||!Number.isFinite(value)?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:code||'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);}
 const api={tokens,context,matches,quote,order,prepare,summary,format};root.WishWaveCompare=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);

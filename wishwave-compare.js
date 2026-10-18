/* Shared product identity matching. Asking prices are not authentication or sold prices. */
(function(root){
 'use strict';
 const noise=new Set(('a an and the for with of to in on from by new used preowned pre owned sealed unopened boxed box nib bnib mint near nm excellent good condition authentic genuine official rare vintage complete tested working free shipping ship fast expedited express delivery adult unisex sale figure figures toy toys import imported japan jp us usa uk mens men womens women size edition factory retail collectible collectibles').split(' '));
 function normal(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/s[.\s]*h[.\s]*figuarts/g,'shfiguarts').replace(/chibimoon/g,'chibi moon').replace(/game\s*boy/g,'game boy').replace(/\byu[\s-]*gi[\s-]*oh\b/g,'yugioh').replace(/\bnew\s+(?:nintendo\s+)?3ds\b/g,'nintendo new3ds').replace(/\bn64\b|\bnintendo\s+64\b/g,'nintendo64').replace(/\bps([1-5])\b|\bplaystation\s+([1-5])\b/g,(_,a,b)=>'playstation'+(a||b)).replace(/\bver(?:sion)?\.?\s*(\d+)\b/g,'version$1').replace(/\bgray\b/g,'grey').replace(/\bcolour\b/g,'color').replace(/[’']/g,'');}
 function tokens(value){return [...new Set(normal(value).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x&&!noise.has(x)))];}
 function condition(item){const s=String(item?.condition||item?.conditionText||'').toLowerCase();if(/refurb/.test(s))return 'refurbished';if(/pre.?owned|used|very good|excellent|acceptable|fair/.test(s))return 'used';if(/new|sealed|unopened|unworn/.test(s))return 'new';return '';}
 function currency(item,fallback=''){return String(item?.currency||fallback||'').toUpperCase();}
 const variants=new Set('chibi pluto mercury mars jupiter venus saturn uranus neptune mini super pro max plus lite xl deluxe limited remastered reissue anniversary original animation oled digital disc remake ips modded japanese korean chinese english first second third hg rg mg pg sd'.split(' '));
 const variantWord=(x,source)=>(variants.has(x)&&(x!=='digital'||/playstation|xbox/.test((source||[]).join(' '))))||/^version\d+$/.test(x);
 const colors=new Set('black white grey red blue green pink purple brown midnight silver gold cream atomic indigo coral yellow orange beige tan oatmeal orewood sail phantom summit light dark navy olive burgundy'.split(' '));
 const code=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const codeFields=item=>[item?.styleId,item?.sku,item?.modelNumber,item?.mpn].filter(x=>typeof x==='string'||typeof x==='number').map(String);
 function codes(value){return (String(value||'').match(/\b[a-z0-9]+(?:[-.][a-z0-9]+)*\b/gi)||[]).filter(x=>x.length>=3&&/[a-z]/i.test(x)&&/\d/.test(x)&&!/^\d+(?:gb|tb|mb|ml|mm|cm|hz|mah|w|v|k|pk|pcs)$/i.test(x)&&!/^version\d+$/i.test(x)&&!/^(?:nintendo\d+|playstation\d+|new3ds|3ds|2ds)$/i.test(x)&&!/^\d+(?:st|nd|rd|th)$/i.test(x)).map(code);}
 function hasCode(item,id){if(codeFields(item).some(x=>code(x)===id))return true;const pattern=[...id].join('[\\s._/-]*');return new RegExp('\\b'+pattern+'\\b','i').test(normal(item?.title||''));}
 function fraction(value){const m=String(value||'').match(/\b([a-z]{0,3}0*\d{1,3})\s*\/\s*([a-z]{0,3}0*\d{1,3})\b/i);return m?m.slice(1).map(x=>x.toLowerCase().replace(/(^|[a-z])0+(?=\d)/g,'$1')):null;}
 function grade(value){const m=String(value||'').match(/\b(psa|bgs|cgc|sgc)\s*(\d+(?:\.\d+)?)/i);return m?m[1].toLowerCase()+m[2]:/\b(?:graded|slabbed)\b/i.test(value||'')?'graded':'';}
 // Identify the item being sold, excluding accessories explicitly included with it.
 function componentKind(value){
  const head=normal(value).replace(/\b(?:mini\s*fig(?:ure)?s?|minifigs?)\s+included\b/g,'').split(/\b(?:with|includes?|including|plus)\b/)[0];
  if(/\b(?:stickers?|decals?)\b/.test(head))return 'sticker';
  if(/\b(?:mini\s*fig(?:ure)?s?|minifigs?)\b/.test(head))return 'minifigure';
  if(/\b(?:display\s+(?:stands?|cases?|plaques?|frames?)|wall mounts?|mounting brackets?)\b/.test(head))return 'display-accessory';
  if(/\b(?:light(?:ing)? kits?|led (?:light|kit)|light for)\b/.test(head))return 'lighting';
  return '';
 }
 function context(query,item={}){
  const title=String(item.title||query||''),source=tokens(title),input=tokens(query),base=input.filter(x=>!item.title||source.includes(x)),core=base.length>=2?base:source.slice(0,8);
  const brand=tokens(item.brand||'')[0]||core[0]||source[0]||'';
  let required=[...core],kind='name',identifier='',pair=null;
  if(/\blego\b/i.test(title+' '+query)){
   const number=title.match(/\b\d{5,6}\b/)||String(query).match(/\b\d{5,6}\b/)||title.match(/\b(?!19\d{2}\b|20\d{2}\b)\d{4}\b/);
   if(number){kind='lego';identifier=number[0];required=['lego',identifier];}
  }
  if(kind==='name'){
   pair=fraction(title);
   if(pair&&/pokemon|pok[eé]mon|yugioh|yu.gi.oh|card|tcg|vmax|charizard|pikachu|umbreon/i.test(title+' '+query)){kind='card';identifier=pair.join('/');required=core.filter(x=>!/^\d+$/.test(x)&&!['psa','bgs','cgc','sgc'].includes(x)).slice(0,6);}
   else{
    const explicit=codeFields(item).map(code).find(x=>x.length>=3&&/\d/.test(x)&&/[a-z]/.test(x));
    const found=explicit||codes(normal(title)).sort((a,b)=>b.length-a.length)[0];
    if(found){kind='code';identifier=found;required=[brand,found];}
   }
  }
  const critical=source.filter(x=>variantWord(x,source)||colors.has(x));
  if(kind==='name'||kind==='card')required=[...new Set([...required,...critical])];
  const main=kind==='lego'?'LEGO '+identifier:kind==='code'?[brand,identifier].join(' '):kind==='card'?[...new Set(required),identifier,grade(title).replace(/([a-z]+)(\d)/,'$1 $2')].filter(Boolean).join(' '):[...new Set(required)].join(' ');
  // A second retrieval can omit supporting words but acceptance keeps the same identity.
  const alternate=kind==='code'?core.filter(x=>code(x)!==identifier).join(' '):kind==='name'?required.filter(x=>!['color','animation','original'].includes(x)).join(' '):'';
  const queries=[...new Set([main,alternate].map(x=>x.trim().slice(0,160)).filter(x=>tokens(x).length>=2))].slice(0,2);
  return {query:queries[0]||main,queries,required,kind,identifier,pair,currency:currency(item),condition:condition(item),sourceGrade:grade(title),sourceWords:source,sourceTitle:title,critical,component:componentKind(title)};
 }
 function identityMatches(item,ctx){
  if(!ctx||!item||!Number.isFinite(Number(item.price))||Number(item.price)<=0)return false;
  if(item.available===false||item.soldOut||item.sold||item.outOfStock)return false;
  const title=String(item.title||''),words=new Set(tokens(title));
  if(componentKind(title)!==(ctx.component||''))return false;
  if(/\b(?:no|without|missing)\s+(?:(?:the|any|all|some|original)\s+)*(?:bricks|pieces|parts|minifigures?|mini\s*figs?|figures?)\b/i.test(title))return false;
  if(/\b(replica|bootleg|recast|counterfeit|proxy|replacement|accessory|accessories|parts only|for parts|case only|remote only|charger only|battery only|strap only|shell only|box only|empty box|manual only|instructions only|digital download|light(?:ing)? kit|led kit|compatible|incomplete|minifigure only|figure only|bag only|bags only)\b/i.test(title))return false;
  const extras=/\b(?:wall mount|display plaque|photo frame|display frame|mounting bracket|protectors?|protective cover|storage case|carrying case|card sleeves?|top ?loaders?|art print|poster|photograph)\b/i;
  if(extras.test(title)&&!extras.test((ctx.sourceWords||[]).join(' ')))return false;
  const accessory=/\b(?:case|charger|battery|strap|remote|cable|screen protector|lens cap|earpads?|insoles?|shell|housing|bracelet|manuals?|instructions?|sticker sheet)\b/i;
  if(accessory.test(title)&&!accessory.test((ctx.sourceWords||[]).join(' '))&&!/\b(?:with|includes?|including|w\/)\s+(?:(?:original|new|a|the|and)\s+)*(?:case|charger|battery|strap|remote|cable|screen protector|lens cap|earpads?|insoles?|shell|housing|bracelet|manuals?|instructions?|sticker sheet)\b/i.test(title))return false;
  if(/\b(bundle|lot of|set of|[2-9]\s*pack|pack of [2-9])\b/i.test(title)&&!ctx.required.some(x=>['bundle','lot','set'].includes(x)))return false;
  if(ctx.kind==='lego'){
   if(!(words.has('lego')||tokens(item.brand).includes('lego'))||!words.has(ctx.identifier))return false;
   if(/\b(?:generic bricks|non[ -]?lego|alt(?:ernative)? of|moc|custom build)\b/i.test(title))return false;
   if(!ctx.component&&/\b(?:bricks?|wheels?|tiles?|plates?|heads?|torsos?|helmets?|weapons?)\s+(?:only|for)|\b(?:spare|loose|individual)\s+(?:parts?|pieces?|bricks?)\b/i.test(title))return false;
   if(/\b(?:no|without|missing) (?:bricks|pieces|parts)|\b(?:instructions|manual|stickers|packaging)\s*(?:only|alone)\b/i.test(title))return false;
   if(/\b(?:instructions?|manuals?|sticker sheet)\b/i.test(title)&&!/\b(?:includes?|with|including)\s+(?:original\s+)?(?:instructions?|manuals?)\b/i.test(title))return false;
   if(/^(?:acrylic\s+)?display (?:case|stand)|\b(?:case|stand|box) for (?:the )?lego\b/i.test(title))return false;
   const sets=String(title).match(/\b\d{5,6}\b/g)||[];if(sets.some(x=>x!==ctx.identifier))return false;
  }else if(ctx.kind==='code'){
   if(!hasCode(item,ctx.identifier)||!(words.has(ctx.required[0])||tokens(item.brand).includes(ctx.required[0]))||!(ctx.critical||[]).every(x=>words.has(x)))return false;
   if(!ctx.allowVariants&&[...words].some(x=>variantWord(x,ctx.sourceWords)&&!ctx.sourceWords?.includes(x)))return false;
  }else{
   if(ctx.required.length<2||!ctx.required.every(x=>words.has(x)))return false;
   if(ctx.kind==='card'){
    const p=fraction(title);if(!p||p.join('/')!==ctx.identifier)return false;
    const g=grade(title);if(g!==ctx.sourceGrade)return false;
   }
   if(!ctx.allowVariants&&[...words].some(x=>variantWord(x,ctx.sourceWords)&&!ctx.sourceWords?.includes(x)))return false;
  }
  if(ctx.currency&&currency(item)!==ctx.currency)return false;
  return true;
 }
 // Model families let retrieval broaden without adding alternatives to exact-price stats.
 function shoeModel(value){
  const text=normal(value).split(/\b(?:size|sz)\b/)[0],m=text.match(/\b(nike|adidas|asics|new balance|jordan|puma|reebok|saucony|hoka|brooks|mizuno)\s+([a-z][a-z -]{1,45}?)\s*(\d{1,4})(?:\s+(v\d+|low|high|mid))?\b/);
  return m?tokens(m[0]).filter(x=>!['air','zoom','originals'].includes(x)):null;
 }
 function queryForItem(item={}){
  const title=String(item.title||'').trim();
  if(!title)return String(item.productName||item.model||item.productQuery||item.searchQ||item.query||item._interestQuery||'').trim();
  const model=shoeModel(title);
  if(model){const palette=tokens(title).filter(x=>colors.has(x));return [...model,...palette,...codeFields(item)].join(' ');}
  return tokens(title.split(/\b(?:size|sz)\s*[:\d]/i)[0]).slice(0,12).join(' ');
 }
 function fallbackPlan(ctx){
  const model=shoeModel(ctx.sourceTitle),palette=(ctx.sourceWords||[]).filter(x=>colors.has(x));
  const relaxed={...ctx,critical:(ctx.critical||[]).filter(x=>!colors.has(x)),required:ctx.required.filter(x=>!colors.has(x))};
  if(model){relaxed.kind='name';relaxed.identifier='';relaxed.required=model;}
  const plans=[];
  if((palette.length||model)&&relaxed.required.length>=2){
   const query=relaxed.kind==='code'?[relaxed.required[0],relaxed.identifier].join(' '):relaxed.required.join(' ');
   plans.push({tier:'variant',query,context:relaxed,label:'Same model · other colours or details'});
  }
  // Only offer a broader family when a meaningful family can be named. Never
  // turn a bare brand or a card/set identifier into an unrelated product search.
  let family=model?.filter(x=>!/^\d+$/.test(x)&&!/^v\d+$/.test(x));
  if(!family&&ctx.kind==='code')family=tokens(ctx.sourceTitle).filter(x=>!codes(ctx.sourceTitle).includes(code(x))&&!colors.has(x)&&!/^\d+$/.test(x));
  if(!family&&['name','lego','card'].includes(ctx.kind))family=(ctx.kind==='lego'?ctx.sourceWords:ctx.required).filter(x=>!colors.has(x)&&!variantWord(x,ctx.sourceWords)&&!/^\d+$/.test(x)&&!['animation','color','psa','bgs','cgc','sgc'].includes(x));
  if(family&&family.length>=2&&family.some(x=>x!==family[0]&&!['camera','shoe','shoes','sneaker','sneakers'].includes(x))){
   const similar={...ctx,kind:'name',identifier:'',required:family.slice(0,5),critical:[],allowVariants:true};
   plans.push({tier:'similar',query:similar.required.join(' '),context:similar,label:'Similar items'});
  }
  return plans;
 }
 function alternativeTier(item,ctx){
  if(identityMatches(item,ctx))return '';
  if(shoeModel(ctx.sourceTitle)&&/\b(?:socks?|laces?|t[ -]?shirts?|hoodies?|posters?|keychains?)\b/i.test(item.title||''))return '';
  for(const plan of ctx.fallbacks||[]){
   if(!ctx.enabledTiers?.includes(plan.tier))continue;
   if(identityMatches(item,plan.context))return plan.tier;
  }
  return '';
 }
 function groups(items,ctx){
  const seen=new Set(),out={same:[],other:[],variant:[],similar:[]};
  for(const item of items||[]){
   const key=String(item.itemId||item.marketplaceListingId||item.url||'');if(key&&seen.has(key))continue;if(key)seen.add(key);
   const exact=classify(item,ctx),tier=exact==='same'?'same':exact==='other-condition'?'other':alternativeTier(item,ctx);
   if(tier)out[tier].push(item);
  }
  for(const key of Object.keys(out))out[key]=order(out[key],ctx.currency);
  return out;
 }
 function classify(item,ctx){if(!identityMatches(item,ctx))return 'reject';return ctx.condition&&condition(item)!==ctx.condition?'other-condition':'same';}
 function matches(item,ctx){return classify(item,ctx)==='same';}
 function related(items,ctx){const seen=new Set();return order((items||[]).filter(item=>{if(classify(item,ctx)!=='other-condition')return false;const key=String(item.itemId||item.marketplaceListingId||item.url||'');if(key&&seen.has(key))return false;if(key)seen.add(key);return true;}),ctx.currency);}
 const numeric=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
 function quote(item,fallback=''){
  const price=numeric(item?.price),code=currency(item,fallback);let shipping=null;
  const detail=item?.shipping;
  const shipCurrency=String(detail?.currency||detail?.cost?.currency||item?.shippingCurrency||code).toUpperCase();
  if(item?.shippingIncludedInPrice===true)return {price,currency:code,shipping:0,known:price!==null,total:price};
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
 const api={tokens,queryForItem,fallbackPlan,alternativeTier,groups,context,matches,identityMatches,classify,quote,order,prepare,related,summary,format};root.WishWaveCompare=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);

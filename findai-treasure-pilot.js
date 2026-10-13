/* Shared browser/Worker policy. A match is a sourcing candidate, not authentication. */
(function(root){
 'use strict';
 const targets=[
  {id:'FF322',category:'lego',query:'LEGO Star Wars UCS Venator 75367 complete set',terms:[['lego'],['75367']],reject:['minifigure only','figure only','bag only','bags only','incomplete']},
  {id:'FF326',category:'lego',query:'LEGO Technic McLaren P1 42172 complete set',terms:[['lego'],['42172']],reject:['minifigure only','bag only','bags only','incomplete']},
  {id:'FF330',category:'lego',query:'LEGO Lord of the Rings Rivendell 10316 complete set',terms:[['lego'],['10316']],reject:['minifigure only','figure only','bag only','bags only','incomplete']},
  {id:'FF104',category:'cameras',query:'Canon PowerShot SD1000 working digital camera',terms:[['canon'],['sd1000']],reject:['case only','battery only','charger only']},
  {id:'FF107',category:'cameras',query:'Sony Cyber shot DSC T7 working digital camera',terms:[['sony'],['dsc t7','dsct7']],reject:['case only','battery only','charger only']},
  {id:'FF113',category:'cameras',query:'Polaroid SX 70 Alpha 1 working camera',terms:[['polaroid'],['sx 70'],['alpha']],reject:['case only','film only']},
  {id:'FF101',category:'portable_audio',query:'Sony Discman D EJ011 working CD player',terms:[['sony'],['d ej011','dej011']],reject:['case only','headphones only','remote only']},
  {id:'FF102',category:'portable_audio',query:'Sony MiniDisc Walkman MZ N505 working player',terms:[['sony'],['mz n505','mzn505']],reject:['case only','disc only','remote only']},
  {id:'FF137',category:'watches',query:'Casio CA 53W calculator watch',terms:[['casio'],['ca 53w','ca53w']],reject:['strap','band','bracelet','battery only']},
  {id:'FF140',category:'watches',query:'Casio G Shock DW 6900 watch',terms:[['casio'],['dw 6900','dw6900']],reject:['strap','band only','bracelet only','bezel only','battery only']},
  {id:'FF001',category:'vintage_jackets',query:'Vintage Carhartt Detroit jacket J01 brown',terms:[['carhartt'],['detroit'],['jacket'],['j01'],['brown']],reject:['wip','j130','j14']},
  {id:'FF033',category:'vintage_jackets',query:'Vintage Tommy Hilfiger Sailing Gear jacket',terms:[['tommy hilfiger'],['sailing'],['jacket']],reject:['kids','youth']},
  {id:'FF156',category:'bags',query:'Coach Ergo 9033',terms:[['coach'],['ergo'],['9033']],reject:['strap only','wallet']},
  {id:'FF173',category:'bags',query:'Fendi Zucca Baguette bag',terms:[['fendi'],['zucca'],['baguette']],reject:['strap only','wallet','charm']},
  {id:'FF046',category:'sunglasses',query:'Vintage Oakley Eye Jacket black sunglasses',terms:[['oakley'],['eye jacket'],['black']],reject:['redux','lenses only','lens only','replacement','frames only','silver frame','vintage style','brain dead']},
  {id:'FF073',category:'jerseys',query:'Vintage Champion Shaquille O Neal Orlando Magic 32 jersey blue',terms:[['champion'],['magic'],['32'],['jersey']],reject:['youth','kids','mitchell','reebok','lakers']},
  {id:'FF080',category:'jerseys',query:'Nike Barcelona Ronaldinho 2005 2006 home jersey',terms:[['nike'],['barcelona'],['ronaldinho'],['jersey','shirt'],['home']],reject:['away','retro remake','reissue','youth','kids','2007','2008']},
  {id:'FF118',category:'retro_gaming',query:'Nintendo Game Boy Color Atomic Purple original console',terms:[['nintendo'],['game boy color','gameboy color'],['atomic purple']],reject:['shell','housing','ips','modded','screen only']},
  {id:'FF124',category:'retro_gaming',query:'Nintendo 64 Jungle Green console controller',terms:[['nintendo 64','n64'],['jungle green'],['console']],reject:['shell','housing','controller only']},
  {id:'FF133',category:'retro_gaming',query:'Sony PlayStation Vita PCH 1000 OLED black console',terms:[['sony','playstation','ps'],['vita'],['1000','1001','oled']],reject:['screen only','shell','housing','2000','2001']},
  {id:'FF213',category:'cards',query:'Pokemon Umbreon VMAX 215 203 English near mint',terms:[['umbreon'],['vmax'],['215'],['203','evolving skies']],reject:['japanese','korean','chinese','proxy','metal','graded','psa','bgs','cgc','lp','mp','hp','played','damaged']},
  {id:'FF224',category:'cards',query:'Pokemon Magikarp Paldea Evolved 203 193 English near mint',terms:[['magikarp'],['203'],['193','paldea evolved']],reject:['japanese','korean','chinese','proxy','metal','graded','psa','bgs','cgc','lp','mp','hp','played','damaged']},
  {id:'FF296',category:'character_collectibles',query:'Vintage Furby 1998 brown grey working',terms:[['furby'],['1998'],['brown','grey','gray']],reject:['2012','2023','furby baby','boom']},
  {id:'FF314',category:'character_collectibles',query:'Bratz Yasmin first edition 2001 original doll',terms:[['bratz'],['yasmin'],['2001']],reject:['20th','anniversary','reproduction','reissue','outfit only','clothes only','missing shoes','no shoes','missing outfit','missing accessories','incomplete','nude','naked']},
  {id:'FF409',category:'character_collectibles',query:'POP MART Labubu Exciting Macaron sealed single box',terms:[['labubu'],['macaron','macarons'],['pop mart']],reject:['whole set','set of 6','case of 6','six boxes','empty box','opened','unboxed']},
  {id:'FF411',category:'character_collectibles',query:'Sonny Angel Hippers Harvest sealed blind box',terms:[['sonny angel'],['hippers'],['harvest']],reject:['opened','unboxed','looking back','animal series']},
  {id:'FF366',category:'sneakers',query:'Air Jordan 1 Lost and Found Chicago adult',terms:[['jordan'],['1'],['lost found','lost and found']],reject:['gs','youth','kids','toddler','infant']},
  {id:'FF370',category:'sneakers',query:'Nike SB Air Jordan 4 Pine Green adult',terms:[['jordan'],['4'],['sb'],['pine green']],reject:['gs','youth','kids','toddler','infant','2025']},
  {id:'FF377',category:'sneakers',query:'ASICS Gel Kayano 14 White Midnight adult',terms:[['asics'],['kayano'],['14'],['white'],['midnight']],reject:['kids','youth','toddler']},
  {id:'FF421',category:'beauty',query:'rhode Peptide Lip Treatment Unscented 10ml sealed',terms:[['rhode'],['peptide'],['lip treatment'],['unscented']],reject:['used','empty','tint','pocket blush','sample']},
  {id:'FF425',category:'beauty',query:'Rare Beauty Soft Pinch Liquid Blush Hope full size new',terms:[['rare beauty'],['soft pinch'],['blush'],['hope']],reject:['used','empty','mini','sample','travel']},
  {id:'FF455',category:'fragrance',query:'Glossier You Eau de Parfum 50ml new sealed',terms:[['glossier'],['you'],['50ml','50 ml','1.7 oz','1.7oz']],reject:['used','empty','sample','decant','refill','tester','gift set','duo','2pc','bundle','fleur','doux','reve','soie']},
  {id:'FF459',category:'fragrance',query:'Valentino Donna Born in Roma Eau de Parfum 50ml new sealed',terms:[['valentino'],['donna'],['born in roma'],['50ml','50 ml','1.7 oz','1.7oz']],reject:['used','empty','sample','decant','tester','intense','green stravaganza','yellow dream','coral fantasy','extrait','uomo','gift set','bundle']}
 ];
 function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
 function includes(text,term){const a=norm(text),b=norm(term);if((' '+a+' ').includes(' '+b+' '))return true;if(!/\d/.test(b))return false;const tokens=a.split(' '),compact=b.replace(/ /g,'');return tokens.some((_,i)=>[1,2,3,4].some(n=>tokens.slice(i,i+n).join('')===compact));}
 const packaging=/\b(?:box\s*only|empty\s*box|packaging\s*only|instructions?\s*only|manual\s*only|parts?\s*only|for\s*parts|not\s*working|non[ -]?working|broken|untested|replica|reproduction|custom|compatible\s*with|display\s*case|acrylic\s*case|light(?:ing)?\s*kit|led\s*(?:light\s*)?kit|display\s*stand|stand\s*only|3d\s*printed|keychain|poster|digital\s*download)\b/i;
 function match(target,item){
  if(!target||!item)return false;
  const title=String(item.title||'');
  if(target.category==='cards'&&(/\bgraded\b/i.test(String(item.condition||''))||/\b(?:slabbed|sgc|ace|tag)\s*(?:graded|[0-9])/i.test(title)))return false;
  if(target.category==='fragrance'&&/\b(?:set|duo|bundle|[2-9]\s*pc)\b/i.test(title))return false;
  if(target.category==='sneakers'&&/\b(?:td|ps|gs)\b|\b\d+(?:\.\d+)?[cy]\b/i.test(title))return false;
  if(['beauty','fragrance'].includes(target.category)&&/used|pre.?owned|open.?box/i.test(String(item.condition||'')))return false;
  if(packaging.test(title)||target.reject.some(x=>includes(title,x)))return false;
  if(target.terms.some(group=>group.includes('lego'))&&/pieces?\s*(?:&|and)\s*parts/i.test(String(item.categoryName||'')))return false;
  if(!target.terms.every(group=>group.some(x=>includes(title,x))))return false;
  const price=Number(item.price);if(!Number.isFinite(price)||price<=0||String(item.currency||'').toUpperCase()!=='USD')return false;
  if(item.sold||item.soldOut||item.available===false||item.inStock===false||item.outOfStock||item.quantity===0)return false;
  if(/sold.?out|out.?of.?stock|unavailable/i.test(String(item.estimatedAvailabilityStatus||'')))return false;
  const observed=Number(item._ebayFetchedAt);if(observed>0&&Date.now()-observed>6*3600000)return false;
  const source=String(item.source||'').toLowerCase();if(['aliexpress','ali','wishwave','findai'].includes(source))return false;
  try{const u=new URL(item.url||item.itemWebUrl);if(u.protocol!=='https:'||u.username||u.password)return false;}catch(_){return false;}
  const image=item.image||item.images?.[0]||item.stockxImage;if(typeof image!=='string'||!/^https:\/\//.test(image))return false;
  return true;
 }
 function forQuery(q){const n=norm(q);return targets.find(x=>norm(x.query)===n)||null;}
 function annotate(target,item){
  if(!match(target,item))return item;
  const forms={sneakers:'sneakers',vintage_jackets:'apparel',jerseys:'apparel',retro_gaming:'gaming',cards:'trading_cards',fragrance:'fragrance'};
  return {...item,...(forms[target.category]&&!item.productType?{productType:forms[target.category]}:{}),...(target.category==='sneakers'&&!item.brand?{brand:target.id==='FF377'?'asics':'nike'}:{}),_treasureTargetId:target.id,_treasureCategory:target.category};
 }
 // IDs with provider candidates in the dated supply audit, not authenticated offers.
 const observedIds=new Set(["FF001", "FF033", "FF156", "FF173", "FF046", "FF073", "FF080", "FF118", "FF124", "FF133", "FF213", "FF224", "FF296", "FF314", "FF409", "FF411", "FF366", "FF370", "FF377", "FF421", "FF425", "FF455", "FF459", "FF322", "FF330", "FF104", "FF107", "FF113", "FF101", "FF137", "FF140"]);
 const previewTargets=Object.freeze(targets.filter(x=>observedIds.has(x.id)));
 const groups=Object.freeze([...new Set(previewTargets.map(x=>x.category))].map(category=>({category,targets:previewTargets.filter(x=>x.category===category)})));
 function identify(item){const hinted=targets.find(x=>x.id===item?._treasureTargetId)||forQuery(item?._interestQuery);return hinted&&observedIds.has(hinted.id)&&match(hinted,item)?hinted:previewTargets.find(x=>match(x,item))||null;}
 function varied(items,history=[],max=36){
  const prior=history.map(item=>{const target=identify(item);return target?{...item,_treasureTargetId:target.id,_treasureCategory:target.category}:item;});
  const remaining=items.flatMap(item=>{const target=identify(item);return target?[annotate(target,item)]:[];}),output=[],deferred=[];
  while(remaining.length&&output.length<max){
   const recent=prior.concat(output),last=recent.at(-1),window=recent.slice(-20),ten=recent.slice(-9);
   const candidates=remaining.map((item,index)=>({item,index})).filter(({item})=>(!window.some(x=>x._treasureTargetId===item._treasureTargetId)&&ten.filter(x=>x._treasureCategory===item._treasureCategory).length<2));
   if(!candidates.length)break;
   const lastCategory=last?._treasureCategory,other=candidates.filter(x=>!lastCategory||x.item._treasureCategory!==lastCategory);
   const selected=(other.length?other:candidates)[0];output.push(remaining.splice(selected.index,1)[0]);
  }
  deferred.push(...remaining);return {items:output,deferred};
 }
 const api=Object.freeze({version:'treasure-pilot-v240.3',targets:Object.freeze(targets),previewTargets,groups,match,annotate,forQuery,identify,varied});
 root.FindAITreasureHunt=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
 // Retire only stale pilot feed caches; saved products and account preferences persist.
 if(root.document)try{
  const params=new URLSearchParams(root.location.search),country=params.get('country')||params.get('region')||root.localStorage.getItem('findai_region');
  if(params.get('treasure-test')==='1'&&String(country).toUpperCase()==='US'&&root.localStorage.getItem('fa_treasure_preview_version')!==api.version){
   root.localStorage.removeItem('fa_personalised_feed_cache_v14_balanced_pages');root.localStorage.removeItem('fa_personalised_lane_state_v4_balanced_pages');root.localStorage.setItem('fa_treasure_preview_version',api.version);
  }
 }catch(_){}
})(globalThis);

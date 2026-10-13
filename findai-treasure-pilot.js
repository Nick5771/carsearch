/* Shared browser/Worker policy. A match is a sourcing candidate, not authentication. */
(function(root){
 'use strict';
 const targets=[
  {id:'FF005',category:'vintage_decor',query:'Garfield telephone 1201',terms:[['garfield'],['phone','telephone'],['1201']],reject:['replacement','cord only','handset only','1205','1209']},
  {id:'FF007',category:'retro_audio',query:'Panasonic Panapet R-70 orange radio',terms:[['panasonic','panapet'],['r70'],['orange']],reject:['parts','repair','battery cover']},
  {id:'FF009',category:'nostalgic_decor',query:'Nickelodeon Time Blaster N2000 clock',terms:[['nickelodeon'],['time blaster','n2000'],['clock']],reject:['parts','repair']},
  {id:'FF092',category:'portable_audio',query:'Sony Sports Walkman WM-FS191',terms:[['sony'],['wmfs191']],reject:['parts','repair','manual']},
  {id:'FF098',category:'retro_gaming',query:'Nintendo Game Watch Donkey Kong DK-52',terms:[['nintendo'],['donkey kong'],['dk52']],reject:['parts','repair','battery cover','lcd only']},
  {id:'FF157',category:'nostalgic_toys',query:'Polly Pocket Partytime Surprise 1989 Bluebird complete',terms:[['polly pocket'],['partytime','party time'],['1989','bluebird'],['complete']],reject:['keepsake','reproduction','compact only','no doll','no dolls','no figures','almost complete','near complete']},
  {id:'FF188',category:'retro_building',query:'LEGO Bionicle Tahu 8534 complete',terms:[['lego','bionicle'],['tahu'],['8534'],['complete']],reject:['incomplete','mask only','canister only','missing','replacement','set of','lot of']},
  {id:'FF359',category:'lego_camera',query:'LEGO Polaroid 21345',terms:[['lego'],['21345']],reject:['incomplete','missing']},
  {id:'FF399',category:'lego_radio',query:'LEGO Retro Radio 10334',terms:[['lego'],['10334']],reject:['incomplete','missing']},
  {id:'FF405',category:'lego_gaming',query:'LEGO Game Boy 72046',terms:[['lego'],['72046']],reject:['incomplete','missing']},
  {id:'FF464',category:'character_accessories',query:'Loungefly Pokemon Gengar Cosplay Glow Mini Backpack',terms:[['loungefly'],['gengar'],['backpack'],['glow','pmbk0329']],reject:['pin','wallet','keychain']},
  {id:'FF164',category:'music_nostalgia',query:'HitClips Britney Spears Oops I Did It Again',terms:[['hitclips','hit clips'],['britney'],['oops']],reject:['cd','vinyl','cassette','album']}
 ];
 function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
 function includes(text,term){const a=norm(text),b=norm(term);if((' '+a+' ').includes(' '+b+' '))return true;if(!/\d/.test(b))return false;const tokens=a.split(' '),compact=b.replace(/ /g,'');return tokens.some((_,i)=>[1,2,3,4].some(n=>tokens.slice(i,i+n).join('')===compact));}
 const packaging=/\b(?:box\s*only|empty\s*box|packaging\s*only|instructions?\s*only|manual\s*only|parts?\s*only|for\s*parts|not\s*working|non[ -]?working|broken|untested|replica|reproduction|custom|compatible\s*with|display\s*case|acrylic\s*case|light(?:ing)?\s*kit|led\s*(?:light\s*)?kit|display\s*stand|stand\s*only|3d\s*printed|keychain|poster|digital\s*download)\b/i;
 function match(target,item){
  if(!target||!item)return false;
  const title=String(item.title||'');
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
 // IDs with provider candidates in the dated supply audit, not authenticated offers.
 const observedIds=new Set(['FF007','FF009','FF098','FF157','FF188','FF359','FF399','FF405','FF164']);
 const previewTargets=Object.freeze(targets.filter(x=>observedIds.has(x.id)));
 const api=Object.freeze({version:'treasure-pilot-v238',targets:Object.freeze(targets),previewTargets,match,forQuery});
 root.FindAITreasureHunt=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);

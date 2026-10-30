/* Explicit recommendation choices take precedence over inferred taste. */
(function(root){
 'use strict';
 const normal=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const clean=s=>String(s||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().replace(/\s+/g,' ').slice(0,64);
 const blank=()=>({version:1,entries:[],variety:'balanced',resetAt:0,observations:[],feed:{location:'worldwide',min:'',max:''}});
 const valid=value=>{const s=blank();if(!value||typeof value!=='object')return s;s.feed=feedFilters(value.feed);s.variety=['focused','balanced','adventurous'].includes(value.variety)?value.variety:'balanced';s.resetAt=Math.max(0,Number(value.resetAt)||0);const seen=new Set();s.entries=(Array.isArray(value.entries)?value.entries:[]).filter(e=>e&&clean(e.topic)&&['more','less','neutral','hidden'].includes(e.preference)).map(e=>({topic:clean(e.topic),preference:e.preference})).filter(e=>{const key=normal(e.topic);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,48);s.observations=(Array.isArray(value.observations)?value.observations:[]).filter(e=>e&&clean(e.topic)&&Number(e.at)>s.resetAt).map(e=>({topic:clean(e.topic),at:Number(e.at),strength:Math.min(5,Math.max(1,Number(e.strength)||1))})).slice(-120);return s;};
 // Same conservative fallback rates as the shopping worker, used only for
 // estimating AUD bounds on already cached cards. Live retrieval uses server FX.
 const feedRates={USD:1,EUR:.92,JPY:157,GBP:.79,CNY:7.2,AUD:1.51,CAD:1.37,CHF:.88,HKD:7.8,SGD:1.34};
 function feedFilters(value={}){const bound=v=>v!==''&&v!=null&&Number.isFinite(Number(v))&&Number(v)>=0?String(v):'';const out={location:value?.location==='AU'?'AU':'worldwide',min:bound(value?.min),max:bound(value?.max)};if(out.min!==''&&out.max!==''&&Number(out.min)>Number(out.max)){out.min='';out.max='';}return out;}
 function feedAllowed(state,item){const f=feedFilters(state.feed);if(f.location==='AU'){const country=String(item?.itemLocationCountry||item?.itemLocation?.country||item?.location?.country||item?.sellerCountry||item?.country||'').trim().toUpperCase();if(!['AU','AUS','AUSTRALIA'].includes(country))return false;}if(f.min===''&&f.max==='')return true;const rate=feedRates[String(item?.currency||'').toUpperCase()],raw=item?.price,price=raw!=null&&raw!==''&&rate?Number(raw)/rate*feedRates.AUD:NaN;return Number.isFinite(price)&&(f.min===''||price>=Number(f.min))&&(f.max===''||price<=Number(f.max));}
 const categories={'beanie babies':/\bbeanie bab(?:y|ies)\b/,'bratz dolls':/\bbratz\b/,'pokemon cards':/\bpokemon\b.*\b(card|cards|booster|psa|tcg)\b/,fragrances:/\b(fragrance|fragrances|perfume|cologne|eau de)\b/,'vintage cameras':/\b(vintage|retro|film|analog|analogue|polaroid)\b.*\bcamera\b|\bcamera\b.*\b(vintage|retro|film|analog|analogue)\b/,'diecast cars':/\b(diecast|die cast|hot wheels|matchbox)\b/,'retro nintendo':/\b(game boy|gameboy|snes|nes|n64|nintendo 64|gamecube|nintendo ds)\b/,'lego botanicals':/\blego\b.*\b(botanical|botanicals|orchid|bonsai|bouquet|flowers)\b/,'lego star wars':/\blego\b.*\b(star wars|executor|millennium falcon|death star|destroyer)\b/,gaming:/\b(nintendo|playstation|xbox|game boy|gameboy|resident evil|zelda|pokemon|sega|gaming|video game|ps[1-5]|snes)\b/,sneakers:/\b(jordan|sneaker|yeezy|dunk|air max|vomero|cortez)\b/,'trading cards':/\b(pokemon|yugioh|yu gi oh|trading card|panini|magic the gathering|psa|bgs)\b/,fashion:/\b(carhartt|clothing|jacket|shirt|dress|hoodie|lululemon|skims|jeans|fashion)\b/,watches:/\b(watch|rolex|seiko|omega|casio|tudor)\b/,toys:/\b(lego|toy|doll|bratz|figure|plush|jellycat|hot wheels|gundam)\b/,comics:/\b(comic|marvel|dc comics|batman|spider man|manga)\b/,music:/\b(vinyl|record|guitar|turntable|cassette|album|music)\b/,cameras:/\b(camera|polaroid|nikon|canon|fujifilm|leica|lens)\b/};
 function match(topic,item){const q=normal(topic),text=normal(typeof item==='string'?item:[item?.title,item?.brand,item?.category,item?._interestQuery].filter(Boolean).join(' '));if(!q)return false;if((' '+text+' ').includes(' '+q+' '))return true;return !!categories[q]?.test(text);}
 const allow=(state,item)=>!state.entries.some(e=>e.preference==='hidden'&&match(e.topic,item));
 function preferenceScore(state,item){let out=0;for(const e of state.entries)if(match(e.topic,item))out+=e.preference==='more'?32:e.preference==='less'?-60:e.preference==='neutral'?-8:0;return out;}
 function topics(state,inferred=[]){const map=new Map();for(const row of inferred){const topic=clean(row.topic||row.query),key=normal(topic);if(!topic||!allow(state,topic))continue;const override=state.entries.find(e=>normal(e.topic)===key);if(override&&['neutral','hidden'].includes(override.preference))continue;const old=map.get(key);if(!old||Number(row.score)>old.score)map.set(key,{topic,score:Number(row.score)||1,preference:override?.preference||'auto',source:'activity'});}for(const e of state.entries)if(['more','less'].includes(e.preference)){const key=normal(e.topic);map.set(key,{...map.get(key),...e,score:map.get(key)?.score||1,source:map.has(key)?'activity':'chosen'});}return [...map.values()].sort((a,b)=>(b.preference==='more')-(a.preference==='more')||b.score-a.score).slice(0,24);}
 function plan(state,base,inferred,limit=16){
  limit=Math.max(1,Number(limit)||16);const controlled=q=>state.entries.some(e=>['less','neutral','hidden'].includes(e.preference)&&match(e.topic,q));
  const chosen=topics(state,inferred).filter(t=>t.preference!=='less').map(t=>({id:'choice:'+normal(t.topic),cluster:'choice:'+normal(t.topic),query:t.topic,discoveryQuery:t.topic,score:t.preference==='more'?50:Math.min(30,12+t.score),featured:false,_wwExplicitTopic:true}));
  const personal=[...chosen,...(!state.resetAt?base.filter(l=>!l.featured):[])].filter(l=>!controlled(l.query));const explore=base.filter(l=>l.featured&&allow(state,l.query)&&!controlled(l.query));
  if(!personal.length)return (explore.length?explore:base.filter(l=>allow(state,l.query)&&!controlled(l.query))).slice(0,limit);
  const seen=new Set(),out=[];let p=0,e=0;const ratio=state.variety==='focused'?[2,1]:state.variety==='adventurous'?[1,2]:[1,1];
  while(out.length<limit&&(p<personal.length||e<explore.length)){for(const [list,count] of [[personal,ratio[0]],[explore,ratio[1]]])for(let n=0;n<count;n++){const l=list===personal?list[p++]:list[e++];if(!l)continue;const key=normal(l.query);if(seen.has(key))continue;seen.add(key);out.push(l);if(out.length===limit)return out;}}
  return out;
 }
 // Only inferred listing titles are grouped; explicitly added interests retain their wording.
 function topicLabel(value){const t=clean(value),q=normal(value);
  if(/\blego\b.*\barchitecture\b/.test(q))return 'LEGO Architecture';
  if(/\b(playstation vita|ps vita)\b/.test(q))return 'PlayStation Vita';
  if(/\bapple watch\b/.test(q))return 'Apple Watch';
  if(/\blego\b/.test(q)&&/\b(star wars|executor|millennium falcon|death star|destroyer)\b/.test(q))return 'LEGO Star Wars';
  if(/\blego\b/.test(q)&&/\b(botanical|botanicals|orchid|bonsai|bouquet)\b/.test(q))return 'LEGO Botanicals';
  if(/\b(game boy|gameboy|snes|nintendo 64|nes console|retro nintendo)\b/.test(q))return 'Retro Nintendo';
  const labels=[[/\bbeanie bab(?:y|ies)\b/,'Beanie Babies'],[/\byeezy\b/,'Yeezy'],[/\bair jordan\b/,'Air Jordan'],[/\bhot wheels\b/,'Hot Wheels'],[/\bbratz\b/,'Bratz dolls'],[/\bjellycat\b/,'Jellycat'],[/\bresident evil\b/,'Resident Evil'],[/\blego\b.*\bharry potter\b/,'LEGO Harry Potter'],[/\blego\b.*\bspongebob\b/,'LEGO SpongeBob'],[/\blego\b.*\btechnic\b/,'LEGO Technic'],[/\blego\b.*\bideas\b/,'LEGO Ideas'],[/\bairpods\b.*\bpro\b/,'AirPods Pro'],[/\bnike\b.*\bdunk\b/,'Nike Dunk'],[/\bpokemon\b.*\b(card|cards|booster|psa|tcg)\b/,'Pokémon cards']];
  for(const [pattern,label] of labels)if(pattern.test(q))return label;
  // Strip sales copy and set numbers from unrecognised listing titles, without inventing a new topic.
  return clean(t.replace(/\b(sealed|complete set|free shipping|pre owned|with box)\b/gi,'').replace(/\b\d{4,}\b/g,'').replace(/\s+/g,' '))||t;
 }
 const Core={feedFilters,feedAllowed,normal,clean,blank,valid,match,allow,preferenceScore,topics,plan,topicLabel};if(typeof module==='object'&&module.exports)module.exports=Core;
 if(!root.document)return;
 const owner=()=>String(root.wishwaveRecommendationAccount?.()||root.getAccountProfile?.()?.email||'guest').trim().toLowerCase();
 const key=()=> 'ww_discovery_choices_v1:'+encodeURIComponent(owner());let cacheRaw=null,cacheOwner='',state=blank();
 function read(){const who=owner();let raw='';try{raw=localStorage.getItem(key())||'';}catch(_){}if(raw!==cacheRaw||who!==cacheOwner){cacheRaw=raw;cacheOwner=who;try{state=valid(JSON.parse(raw));}catch(_){state=blank();}}return state;}
 function persist(next){try{const raw=JSON.stringify(valid(next));localStorage.setItem(key(),raw);cacheRaw=raw;cacheOwner=owner();state=valid(next);return true;}catch(_){return false;}}
 function inferred(){
  if(root.findaiAppPreferences?.().personalized===false)return [];
  const s=read(),now=Date.now(),rows=[];
  // After a reset, only newly observed actions on this device contribute.
  if(!s.resetAt){
   for(const e of root.getInterestProfile?.()||[])if(Number(e.weight)>0&&now-Number(e.lastAt||0)<45*86400000)rows.push({topic:e.query,score:Number(e.weight)});
   for(const e of root.wishwaveDeliberateInterests?.()||[])if(e.positive>=2&&e.positive>e.negative&&e.query)rows.push({topic:e.query,score:e.positive*3});
   try{for(const e of JSON.parse(sessionStorage.getItem('ww_shopping_intents_v228')||'[]'))if(now-e.at<86400000)rows.push({topic:e.query,score:3});}catch(_){}
  }
  const totals=new Map();for(const e of s.observations)if(now-e.at<45*86400000){const k=normal(e.topic),row=totals.get(k)||{topic:e.topic,score:0};row.score+=e.strength*Math.pow(.5,(now-e.at)/(21*86400000));totals.set(k,row);}rows.push(...totals.values());return rows.map(r=>({...r,topic:topicLabel(r.topic)}));
 }
 function observe(topic,strength=1){if(root.findaiAppPreferences?.().personalized===false)return;topic=clean(topic);if(topic.length<2)return;const s=read(),now=Date.now();if(s.observations.some(e=>normal(e.topic)===normal(topic)&&now-e.at<15000))return;persist({...s,observations:[...s.observations,{topic,at:now,strength}].slice(-120)});}
 const record=root.recordInterest;if(record)root.recordInterest=function(query,event){if(['search','scan','click','like','track','tracker','compare','share','comment'].includes(event))observe(query,['like','track','tracker'].includes(event)?3:1);return record.apply(this,arguments);};
 const product=root.wishwaveObserveProduct;if(product)root.wishwaveObserveProduct=function(item,event,details){if(['like','track','compare','share','comment'].includes(event)||(event==='attention'&&Number(details?.ms)>=5000)){const tags=root.WishWaveInterestCore?.classify(item)?.tags||[],tag=tags.filter(t=>t.query).sort((a,b)=>b.depth-a.depth)[0];if(tag)observe(tag.query,event==='attention'?1:3);}return product.apply(this,arguments);};
 const scored=root.scoredInterests;
 if(scored)root.scoredInterests=function(limit=16){const s=read(),learned=inferred();let base=scored.apply(this,arguments);if(s.resetAt)base=[...base.filter(l=>l.featured),...(root.featuredColdStart?.(1,'discovery-reset')||[])];if(!s.entries.length&&!s.resetAt&&s.variety==='balanced'&&!learned.length)return base;return plan(s,base,learned,limit).map(l=>({...l,category:l.category||root.interestCategory?.(l.query)||'other'}));};
 const variants=root.interestQueryVariants;if(variants)root.interestQueryVariants=function(lane){return lane._wwExplicitTopic?[lane.query]:variants.apply(this,arguments);};
 const usesQuery=query=>topics(read(),inferred()).some(t=>t.preference!=='less'&&match(t.topic,query));
 root.wishwaveDiscoveryUsesTopic=(item,query)=>allow(read(),item)&&topics(read(),inferred()).some(t=>t.preference!=='less'&&(!query||match(t.topic,query))&&match(t.topic,item));
 const retrieve=root.wishwaveFetchRecommendationResults;
 if(retrieve&&root.fetchProductResults)root.wishwaveFetchRecommendationResults=function(query,options){const f=read().feed;if(f.location!=='worldwide'||f.min!==''||f.max!=='')return root.fetchProductResults(query,{...options,passive:false,searchFilters:{...f,sort:'best',currency:'AUD'}});return usesQuery(query)?root.fetchProductResults(query,{...options,passive:false}):retrieve.apply(this,arguments);};
 const shoppingPreferences=root.wishwaveShoppingPreferences;if(shoppingPreferences)root.wishwaveShoppingPreferences=function(){return read().resetAt?{}:shoppingPreferences.apply(this,arguments);};
 const blendedPriority=root.wishwaveBlendedPriority;if(blendedPriority)root.wishwaveBlendedPriority=function(item){const s=read(),adjustment=preferenceScore(s,item),base=s.resetAt?0:blendedPriority.apply(this,arguments);return base==null&&!adjustment?base:(Number.isFinite(base)?base:0)+adjustment;};
 const interestPlan=root.wishwaveInterestPlan;if(interestPlan)root.wishwaveInterestPlan=function(){const s=read();return s.resetAt||s.entries.length?[]:interestPlan.apply(this,arguments);};
 const candidate=root.wishwaveRecommendationCandidate;if(candidate)root.wishwaveRecommendationCandidate=function(item,query){return allow(read(),item)&&candidate.apply(this,arguments);};
 const score=root.personalisedItemScore;if(score)root.personalisedItemScore=function(item){const s=read();let base=s.resetAt?0:score.apply(this,arguments);if(s.entries.some(e=>['neutral','less'].includes(e.preference)&&match(e.topic,item)))base=Math.min(0,base);return base+preferenceScore(s,item);};
 const focus=root.wishwaveInterestFocus;if(focus)root.wishwaveInterestFocus=function(){const s=read();return s.resetAt||s.entries.length?null:focus.apply(this,arguments);};
 const starter=root.wishwaveStarterItems;if(starter)root.wishwaveStarterItems=function(surface){const s=read();if(surface==='home'&&topics(s,inferred()).some(t=>t.preference!=='less'))return Promise.resolve([]);return starter.apply(this,arguments);};
 const sequence=root.sequencePersonalisedBatch;if(sequence)root.sequencePersonalisedBatch=function(items,history,max){const s=read();return sequence.call(this,(items||[]).filter(i=>allow(s,i)).sort((a,b)=>preferenceScore(s,b)-preferenceScore(s,a)),history,max);};
 root.wishwaveDiscoveryItemAllowed=item=>allow(read(),item)&&feedAllowed(read(),item);
 root.wishwaveDiscoveryFeedFilters=()=>({...read().feed});
 root.wishwaveDiscoveryChoices=()=>({state:valid(read()),topics:topics(read(),inferred())});
 function changed(){document.dispatchEvent(new CustomEvent('wishwave-discovery-choices-change'));}
 function refresh(){if(read().entries.length||read().resetAt){try{sessionStorage.removeItem('ww_shopping_intents_v228');localStorage.removeItem('findai_priority_search_v130');}catch(_){}}changed();if(document.getElementById('discover')?.dataset.homeFeed==='for-you'||!document.getElementById('discover')?.dataset.homeFeed){root.wishwaveSetHomeFeed?.('for-you',true);}}
 const suggestions=['Trading Cards','Gaming','Fashion','Sneakers','Watches','Toys','Comics','Music','Sports','Cameras','Tech','Jewellery','Bags','Art','Books','Home','Antiques','Resident Evil','Pokémon','Retro Nintendo','LEGO Star Wars','Vintage cameras','Vinyl records'];
 const dialog=document.createElement('dialog');dialog.id='wwDiscoveryPreferences';dialog.setAttribute('aria-labelledby','wwDiscoveryTitle');
 dialog.innerHTML=`<div class="ww-discovery-handle"></div><header><div><h2 id="wwDiscoveryTitle" tabindex="-1">Your discovery</h2></div><button type="button" data-close aria-label="Close Your discovery">×</button></header>
 <p class="ww-discovery-summary" data-summary></p>
 <section class="ww-discovery-feed"><h3>Feed preferences</h3><p class="ww-discovery-hint">Applies to your For You feed.</p><div class="ww-discovery-location" role="group" aria-label="Item location"><button type="button" data-location="worldwide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>Worldwide</button><button type="button" data-location="AU"><span aria-hidden="true">🇦🇺</span>Australia only</button></div><p class="ww-discovery-price-title">Price range · AUD</p><div class="ww-discovery-price"><label><span>A$</span><input data-feed-min type="number" min="0" step="0.01" inputmode="decimal" placeholder="Min" aria-label="Minimum feed price in AUD"></label><label><span>A$</span><input data-feed-max type="number" min="0" step="0.01" inputmode="decimal" placeholder="Max" aria-label="Maximum feed price in AUD"></label></div><p class="ww-discovery-hint">Leave blank for any price. AUD estimates, shipping excluded.</p><p data-feed-error role="alert"></p></section>
 <section class="ww-discovery-group"><h3>More of this</h3><p class="ww-discovery-hint">Tap a topic to adjust it.</p><div class="ww-discovery-chips" data-more></div></section>
 <section class="ww-discovery-group"><h3>Less of this</h3><div class="ww-discovery-chips" data-less></div></section>
 <section class="ww-discovery-editor" data-editor hidden><h3 data-editor-title></h3><div data-actions></div></section>
 <section class="ww-discovery-add" data-add-form hidden><label for="wwDiscoveryTopic">Add an interest</label><div><input id="wwDiscoveryTopic" maxlength="64" placeholder="Brand, franchise or collectible" list="wwDiscoverySuggestions" autocomplete="off"><button type="button" data-add>Add</button><button type="button" data-cancel-add aria-label="Cancel adding interest">×</button></div><datalist id="wwDiscoverySuggestions"></datalist><p data-add-feedback role="status"></p></section>
 <section class="ww-discovery-group"><h3>Try something new</h3><div class="ww-discovery-chips" data-suggested></div></section>
 <details class="ww-discovery-advanced"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 6h4m4 0h12M2 18h12m4 0h4"/><rect x="6" y="2" width="4" height="8" rx="2"/><rect x="14" y="14" width="4" height="8" rx="2"/></svg><span>More controls</span></summary>
 <details data-managed><summary>Hidden &amp; removed interests</summary><div data-managed-list></div></details>
 <fieldset class="ww-discovery-variety"><legend>Room for new discoveries</legend><div></div></fieldset>
 <details class="ww-discovery-shopping"><summary>Shopping filters</summary><p>Price, condition and listing type.</p><button type="button" data-shopping>Open shopping filters</button></details>
 <button type="button" class="ww-discovery-reset" data-reset>Reset recommendations</button><div data-confirm hidden><p>Start fresh on this device? Your saves, follows and listings stay.</p><button type="button" data-cancel-reset>Cancel</button><button type="button" data-confirm-reset>Start fresh</button></div></details>
 <p class="ww-discovery-autosave">Changes save automatically</p><p data-save-error role="alert"></p><div class="ww-discovery-status" role="status" hidden><span data-status></span><button type="button" data-undo>Undo</button></div>`;
 document.body.append(dialog);for(const topic of suggestions){const o=document.createElement('option');o.value=topic;dialog.querySelector('datalist').append(o);}
 let draft=null,focusBefore=null,draftOwner='',dirty=false,undoState=null,addPreference='more',expanded={more:false,less:false};const el=s=>dialog.querySelector(s);
 function button(text,action,label){const b=document.createElement('button');b.type='button';b.textContent=text;if(label)b.setAttribute('aria-label',label);b.onclick=action;return b;}
 function commit(next,message='Preferences updated'){
  if(owner()!==draftOwner){dialog.close();return false;}
  const previous=valid(read());next={...next,observations:previous.observations};
  if(!persist(next)){el('[data-save-error]').textContent='Could not save your choices. Please try again.';return false;}
  undoState=previous;draft=valid(read());dirty=true;el('[data-save-error]').textContent='';el('[data-status]').textContent=message;el('.ww-discovery-status').hidden=false;changed();paintTopics();return true;
 }
 function choose(topic,preference){const k=normal(topic),next=valid(read());
  // Replace old full-title choices belonging to this grouped topic as well.
  next.entries=next.entries.filter(e=>normal(e.topic)!==k&&normal(topicLabel(e.topic))!==k);
  if(next.entries.length>=48){el('[data-save-error]').textContent='Remove an interest before adding another.';return false;}
  next.entries.push({topic:clean(topic),preference});return commit(next,preference==='neutral'?'Interest removed':'Preferences updated');
 }
 function editor(row,trigger){el('[data-add-form]').hidden=true;el('[data-editor]').hidden=false;el('[data-editor-title]').textContent=row.topic;const area=el('[data-actions]');area.replaceChildren();
  for(const [value,text] of [['more','More of this'],['less','Less of this'],['hidden','Hide from feed'],['neutral','Remove interest']])area.append(button(text,()=>{if(choose(row.topic,value)){el('[data-editor]').hidden=true;el('[data-more] button')?.focus();}},text+' '+row.topic));
  area.append(button('Cancel',()=>{el('[data-editor]').hidden=true;trigger.focus();}));area.querySelector('button').focus();
 }
 function addForm(preference){addPreference=preference;el('[data-editor]').hidden=true;el('[data-add-form]').hidden=false;el('[data-add-form] label').textContent=preference==='less'?'See less of an interest':'Add an interest';el('[data-add-feedback]').textContent='';el('#wwDiscoveryTopic').value='';el('#wwDiscoveryTopic').focus();}
 function paintTopics(){
  for(const b of dialog.querySelectorAll('[data-location]'))b.setAttribute('aria-pressed',String(b.dataset.location===draft.feed.location));
  const grouped=new Map();for(const row of topics(draft,inferred())){const topic=topicLabel(row.topic),k=normal(topic),old=grouped.get(k);if(!old||row.preference!=='auto')grouped.set(k,{...row,topic});}
  const rows=[...grouped.values()];for(const pref of ['more','less']){
   const list=el('[data-'+pref+']'),group=rows.filter(r=>pref==='less'?r.preference==='less':r.preference!=='less');list.replaceChildren();
   for(const row of (expanded[pref]?group:group.slice(0,4))){
    const chip=document.createElement('div');chip.className='ww-discovery-chip ww-discovery-topic-chip';
    const adjust=button(row.topic,()=>editor(row,adjust),'Adjust '+row.topic);adjust.className='ww-discovery-topic-label';adjust.title=row.topic;
    const remove=button('×',()=>{if(choose(row.topic,'hidden'))el('[data-'+pref+'] button')?.focus();},'Hide '+row.topic+' from feed');remove.className='ww-discovery-dismiss';
    chip.append(adjust,remove);list.append(chip);
   }
   const add=button('+  Add interest',()=>addForm(pref),'Add '+pref+' interest');add.className='ww-discovery-chip ww-discovery-outline';list.append(add);
   if(group.length>4){const toggle=button(expanded[pref]?'Show less':'Show '+(group.length-4)+' more',()=>{expanded[pref]=!expanded[pref];paintTopics();el('[data-'+pref+'] [data-expand]')?.focus();});toggle.className='ww-discovery-expand';toggle.dataset.expand=pref;toggle.setAttribute('aria-expanded',String(expanded[pref]));list.append(toggle);}
  }
  const recent=rows.filter(t=>t.source==='activity'&&t.preference!=='less').slice(0,3).map(t=>t.topic);const summary=el('[data-summary]');summary.replaceChildren();if(recent.length){summary.append('Recently exploring ');recent.forEach((topic,index)=>{if(index)summary.append(index===recent.length-1?' and ':', ');const name=document.createElement('span');name.className='ww-discovery-interest-accent';name.textContent=topic;summary.append(name);});summary.append('.');}else summary.textContent='Add your interests to shape what you discover.';
  const area=el('[data-suggested]');area.replaceChildren();const picks=['Resident Evil','Vintage cameras','Vinyl records','Trading Cards','Diecast cars','Comics','Watches'].filter(t=>!rows.some(r=>match(t,r.topic)||match(r.topic,t))&&!draft.entries.some(e=>normal(topicLabel(e.topic))===normal(t))).slice(0,2);for(const topic of picks){const b=button('+  '+topic,()=>choose(topic,'more'),'Explore '+topic);b.className='ww-discovery-chip ww-discovery-outline';area.append(b);}
  const managed=draft.entries.filter(e=>['hidden','neutral'].includes(e.preference));el('[data-managed]').hidden=!managed.length;const managedArea=el('[data-managed-list]');managedArea.replaceChildren();for(const row of managed){const line=document.createElement('div');line.className='ww-discovery-managed-row';const text=document.createElement('span');text.textContent=topicLabel(row.topic)+' · '+(row.preference==='hidden'?'Hidden':'Removed');line.append(text,button('Restore',()=>choose(topicLabel(row.topic),'more'),'Restore '+topicLabel(row.topic)));managedArea.append(line);}
  const variety=el('.ww-discovery-variety>div');variety.replaceChildren();for(const [value,text] of [['focused','Familiar'],['balanced','Balanced'],['adventurous','Explore more']]){const b=button(text,()=>commit({...valid(read()),variety:value}));b.setAttribute('aria-pressed',String(draft.variety===value));variety.append(b);}
 }
 function open(){draft=valid(read());draftOwner=owner();dirty=false;undoState=null;expanded={more:false,less:false};focusBefore=document.activeElement;el('[data-save-error]').textContent='';el('.ww-discovery-status').hidden=true;el('[data-confirm]').hidden=true;el('[data-reset]').hidden=false;el('[data-editor]').hidden=true;el('[data-add-form]').hidden=true;for(const d of dialog.querySelectorAll('details'))d.open=false;el('[data-feed-min]').value=draft.feed.min;el('[data-feed-max]').value=draft.feed.max;el('[data-feed-error]').textContent='';paintTopics();document.querySelector('#discover .ww-home-filter')?.setAttribute('aria-expanded','true');if(!dialog.open)dialog.showModal();el('#wwDiscoveryTitle').focus();}
 function saveFeed(){
  const min=el('[data-feed-min]').value,max=el('[data-feed-max]').value;
  const inputs=[el('[data-feed-min]'),el('[data-feed-max]')];
  if(inputs.some(i=>i.validity.badInput)||(min!==''&&(!Number.isFinite(Number(min))||Number(min)<0))||(max!==''&&(!Number.isFinite(Number(max))||Number(max)<0))||(min!==''&&max!==''&&Number(min)>Number(max))){el('[data-feed-error]').textContent='Enter a valid range. Maximum must be at least the minimum.';return;}
  el('[data-feed-error]').textContent='';const next=valid(read());next.feed={...next.feed,min,max};commit(next);
 }
 for(const b of dialog.querySelectorAll('[data-location]'))b.onclick=()=>{const next=valid(read());next.feed.location=b.dataset.location;commit(next);};
 for(const input of dialog.querySelectorAll('[data-feed-min],[data-feed-max]'))input.addEventListener('change',saveFeed);
 el('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{document.querySelector('#discover .ww-home-filter')?.setAttribute('aria-expanded',String(!!document.getElementById('wwHomeFilters')?.open));if(dirty&&owner()===draftOwner){dirty=false;refresh();}focusBefore?.focus();});
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 function add(){const topic=clean(el('#wwDiscoveryTopic').value);if(topic.length<2){el('[data-add-feedback]').textContent='Enter at least two characters.';return;}if(choose(topic,addPreference)){el('[data-add-form]').hidden=true;el('[data-'+addPreference+'] button')?.focus();}}
 el('[data-add]').onclick=add;el('[data-cancel-add]').onclick=()=>{el('[data-add-form]').hidden=true;el('[data-'+addPreference+'] button')?.focus();};el('#wwDiscoveryTopic').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add();}});
 el('[data-undo]').onclick=()=>{if(undoState){const previous=undoState;if(commit({...previous,observations:read().observations},'Change undone')){undoState=null;el('.ww-discovery-status').hidden=true;el('[data-feed-min]').value=draft.feed.min;el('[data-feed-max]').value=draft.feed.max;el('[data-more] button')?.focus();}}};
 el('[data-shopping]').onclick=()=>{dialog.close();root.wishwaveOpenHomeFilters?.();};
 el('[data-reset]').onclick=()=>{el('[data-confirm]').hidden=false;el('[data-reset]').hidden=true;el('[data-confirm-reset]').focus();};
 el('[data-cancel-reset]').onclick=()=>{el('[data-confirm]').hidden=true;el('[data-reset]').hidden=false;el('[data-reset]').focus();};
 el('[data-confirm-reset]').onclick=()=>{
  if(owner()!==draftOwner){dialog.close();return;}const next={...blank(),resetAt:Date.now()};if(!persist(next)){el('[data-save-error]').textContent='Could not reset. Please try again.';return;}
  for(const k of ['fa_interest_profile_v1','fa_interest_history_v1','fa_behavior_profile_v125','fa_dwell_history_v125','findai_priority_search_v130','ww_shopping_sync_v228','ww_product_preferences_v226','ww_exposure_window_v226'])try{localStorage.removeItem(k);}catch(_){}
  for(const k of ['ww_topic_session_v227','ww_shopping_intents_v228','ww_mission_v229','fa_session_taste_v125'])try{sessionStorage.removeItem(k);}catch(_){}
  // Notify existing learning caches without modifying auth, saved items or follows.
  try{localStorage.setItem('ww_topic_evidence_v227',JSON.stringify({profile:{},journal:{},shoppingImported:true}));window.dispatchEvent(new StorageEvent('storage',{key:'ww_topic_evidence_v227'}));}catch(_){}
  dirty=true;dialog.close();
 };
 root.wishwaveOpenDiscoveryPreferences=open;
 document.addEventListener('wishwave-recommendation-account-change',()=>{cacheRaw=null;if(dialog.open)dialog.close();changed();});
 root.addEventListener('storage',event=>{if(event.key?.startsWith('ww_discovery_choices_v1:')){cacheRaw=null;changed();}});
})(typeof window==='undefined'?globalThis:window);

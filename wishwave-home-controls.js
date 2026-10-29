/* Home controls: original capsule-handle icon; filters never reorder listing IDs. */
(function(){
 'use strict';
 const home=document.getElementById('discover'),feed=document.getElementById('personalFeed');
 if(!home||!feed)return;
 const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6.5h4m4 0h12M2 17.5h12m4 0h4"/><rect x="6" y="2.5" width="4" height="8" rx="2"/><rect x="14" y="13.5" width="4" height="8" rx="2"/></svg>';
 const tabs=home.querySelector('.wishwave-home-feed-tabs');
 const control=document.createElement('button');control.type='button';control.className='ww-home-filter';control.setAttribute('aria-label','Filter your feed');control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-expanded','false');control.innerHTML=icon;tabs.after(control);
 // Search owns its own ID; unread message updates must never change this button.
 const search=home.querySelector('#homeMessageButton');
 if(search){search.id='homeSearchButton';search.setAttribute('aria-label','Search WishWave');search.onclick=()=>{go('search');};search.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg>';}
 const defaults=()=>({min:'',max:'',condition:'any',type:'all'});
 let filters=defaults(),previousFocus=null;
 const active=()=>filters.min!==''||filters.max!==''||filters.condition!=='any'||filters.type!=='all';
 function matches(item){
  if(!item)return false;
  const price=item.price==null?NaN:Number(item.price);
  if(filters.min!==''&&(!Number.isFinite(price)||price<Number(filters.min)))return false;
  if(filters.max!==''&&(!Number.isFinite(price)||price>Number(filters.max)))return false;
  const condition=String(typeof conditionText==='function'?conditionText(item):item.condition||'').toLowerCase();
  if(filters.condition==='new'&&(!/\bnew\b/.test(condition)||/pre.?owned|used|refurbished|like new/.test(condition)))return false;
  if(filters.condition==='used'&&!/pre.?owned|used|refurbished/.test(condition))return false;
  if(filters.type!=='all'){
   // Affiliate listings do not always disclose their sale format. Do not guess.
   const type=String(item.listingType||item.buyingOptions?.includes('AUCTION')&&'auction'||item.buyingOptions?.includes('FIXED_PRICE')&&'fixed'||'');
   if(filters.type==='auction'&&type!=='auction')return false;
   if(filters.type==='fixed'&&!['fixed','fixed-price','buy-now'].includes(type))return false;
  }
  return true;
 }
 function apply(){
  const on=active();control.classList.toggle('has-filters',on);
  control.setAttribute('aria-label',on?'Filter your feed, filters active':'Filter your feed');
  let shown=0,total=0;
  for(const card of feed.querySelectorAll('.reel-card')){
   const item=currentFeedItems[Number(card.dataset.index)],hide=on&&!matches(item);
   card.classList.toggle('ww-home-filtered',hide);total++;if(!hide)shown++;
  }
  let notice=feed.querySelector('.ww-home-filter-empty');
  if(on&&total&&!shown){
   if(!notice){notice=document.createElement('div');notice.className='ww-home-filter-empty feed-status';notice.setAttribute('role','status');notice.innerHTML='<div><b>No matching listings in this feed</b><p>Try a wider price range or reset your filters.</p><button type="button" class="retry-btn">Reset filters</button></div>';notice.querySelector('button').onclick=reset;feed.append(notice);}
  }else notice?.remove();
 }
 function reset(){filters=defaults();apply();feed.scrollTop=0;}
 const sheet=document.createElement('dialog');sheet.id='wwHomeFilters';sheet.setAttribute('aria-labelledby','wwHomeFiltersTitle');
 sheet.innerHTML='<form method="dialog"><div class="ww-filter-handle"></div><header><h2 id="wwHomeFiltersTitle">Filter your feed</h2><button type="button" data-close aria-label="Close filters">×</button></header><p class="ww-filter-intro">Refine listings in your current feed.</p><fieldset><legend>Price range</legend><p class="ww-filter-note">Uses each listing’s displayed price.</p><div class="ww-filter-price"><label>Minimum<input name="min" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Any"></label><span>–</span><label>Maximum<input name="max" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Any"></label></div></fieldset><fieldset><legend>Condition</legend><div class="ww-filter-choices">'+[['any','Any'],['new','New'],['used','Pre-owned']].map(([v,t])=>'<label><input type="radio" name="condition" value="'+v+'"><span>'+t+'</span></label>').join('')+'</div></fieldset><fieldset><legend>Listing type</legend><div class="ww-filter-choices">'+[['all','All'],['fixed','Buy Now'],['auction','Auction']].map(([v,t])=>'<label><input type="radio" name="type" value="'+v+'"><span>'+t+'</span></label>').join('')+'</div><p class="ww-filter-note">Specific types include listings with a known sale format.</p></fieldset><p class="ww-filter-error" role="alert"></p><footer><button type="button" data-reset>Reset</button><button type="submit">Apply filters</button></footer></form>';
 document.body.append(sheet);
 const form=sheet.querySelector('form'),error=sheet.querySelector('.ww-filter-error');
 function fill(){form.elements.min.value=filters.min;form.elements.max.value=filters.max;form.elements.condition.value=filters.condition;form.elements.type.value=filters.type;error.textContent='';}
 function open(){previousFocus=document.activeElement;fill();control.setAttribute('aria-expanded','true');sheet.showModal();sheet.querySelector('[data-close]').focus();}
 control.onclick=open;
 sheet.querySelector('[data-close]').onclick=()=>sheet.close();
 sheet.querySelector('[data-reset]').onclick=()=>{reset();fill();};
 sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)sheet.close();}});
 sheet.addEventListener('close',()=>{control.setAttribute('aria-expanded','false');previousFocus?.focus();});
 form.addEventListener('submit',event=>{
  event.preventDefault();const min=form.elements.min.value,max=form.elements.max.value;
  if((min!==''&&(!Number.isFinite(Number(min))||Number(min)<0))||(max!==''&&(!Number.isFinite(Number(max))||Number(max)<0))){error.textContent='Enter a valid positive price.';return;}
  if(min!==''&&max!==''&&Number(min)>Number(max)){error.textContent='Maximum must be at least the minimum.';form.elements.max.focus();return;}
  filters={min,max,condition:form.elements.condition.value,type:form.elements.type.value};apply();feed.scrollTop=0;sheet.close();
 });
 // Keep identity/index intact when more cards arrive or a different feed is painted.
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('.reel-card')||n.querySelector('.reel-card')))))apply();}).observe(feed,{childList:true,subtree:false});
 window.wishwaveOpenHomeFilters=open;
})();

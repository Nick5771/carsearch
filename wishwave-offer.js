/* Dedicated offer editor, backed by existing conversation and offer APIs. */
(function(){
 'use strict';
 const root=document.createElement('section');root.id='wwOffer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Make an offer');(document.querySelector('.app')||document.body).append(root);
 let state=null,quoteTimer=0,quoteVersion=0;
 const esc=value=>escapeHTML(String(value??''));
 const icons={back:'<path d="m15 18-6-6 6-6"/>',truck:'<path d="M2 5h12v12H2zM14 9h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'};
 const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 const money=(minor,s=state)=>appMpMoney(minor/100,s.currency);
 const session=()=>String(getAccountProfile()?.email||'')+'|'+marketplaceSession();
 const current=s=>state===s&&s.session===session()&&root.classList.contains('show');
 function error(message){root.querySelector('#appMpMessageOfferError').textContent=message||'';}
 function amountMinor(){const text=root.querySelector('#appMpMessageOfferAmount').value.trim();return /^\d+(?:\.\d{1,2})?$/.test(text)?Math.round(Number(text)*100):NaN;}
 function valid(s,amount){return Number.isSafeInteger(amount)&&amount>0&&amount<s.priceMinor;}
 function controls(){if(!state)return;root.querySelector('#appMpMessageOfferSubmit').disabled=!!state.busy||!state.loaded||!state.quote||!valid(state,amountMinor());}
 function summary(){const s=state;if(!s)return;const amount=amountMinor(),q=s.quote;root.querySelector('[data-offer-subtotal]').textContent=valid(s,amount)?money(amount):'—';root.querySelector('[data-offer-fee]').textContent=q?money(q.buyerFeeMinor):'—';root.querySelector('[data-offer-total]').textContent=q?money(q.buyerTotalMinor):'—';root.querySelector('[data-offer-total-label]').textContent=s.shippingMinor===null?'Estimated total, excluding delivery':'Total if accepted';controls();}
 async function updateQuote(s){
  const amount=amountMinor(),version=++quoteVersion;s.quote=null;summary();if(!s.loaded||!valid(s,amount))return;
  try{const data=await marketplaceFetch('/marketplace/quote',{method:'POST',body:JSON.stringify({itemMinor:amount,shippingMinor:s.shippingMinor??0,currency:s.currency})});if(!current(s)||version!==quoteVersion||amount!==amountMinor())return;
   const q=data.quote;if(!q||![q.buyerFeeMinor,q.buyerTotalMinor].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Could not calculate the buyer fee');s.quote=q;error('');summary();
  }catch(e){if(current(s)&&version===quoteVersion){error(e.message||'Could not calculate the total. Edit the amount to retry.');controls();}}
 }
 function input(){const s=state;if(!s)return;clearTimeout(quoteTimer);quoteVersion++;s.quote=null;error('');summary();quoteTimer=setTimeout(()=>{if(current(s))updateQuote(s);},180);}
 function render(s){
  const title=s.counter?'Send a counter offer':'Make an offer';root.setAttribute('aria-label',title);
  root.innerHTML='<header class="wwo-head"><button type="button" class="wwo-back" onclick="appMpCloseMessageOffer()" aria-label="Back">'+icon('back')+'</button><h1>'+title+'</h1><span></span></header><form><div class="wwo-scroll"><section class="wwo-item">'+(s.image?'<img src="'+escapeAttr(s.image)+'" alt="'+escapeAttr(s.title)+'">':'')+'<div class="wwo-copy"><h2>'+esc(s.title)+'</h2><div class="wwo-muted">Asking price</div><div class="wwo-price">'+esc(money(s.priceMinor,s))+'</div></div></section>'+
   '<label class="wwo-amount-label" for="appMpMessageOfferAmount">Your offer</label><div class="wwo-amount"><span class="wwo-currency">'+esc(s.currency==='AUD'?'A$':s.currency==='USD'?'US$':s.currency==='GBP'?'£':s.currency==='EUR'?'€':s.currency+' ')+'</span><input id="appMpMessageOfferAmount" type="text" inputmode="decimal" autocomplete="off" required maxlength="14" placeholder="0" aria-describedby="wwoAmountHint" value="'+escapeAttr(s.initial)+'"></div><div id="wwoAmountHint" class="wwo-muted">Enter an amount below '+esc(money(s.priceMinor,s))+'</div>'+
   '<label class="wwo-note-label" for="appMpMessageOfferNote">Message (optional)</label><div class="wwo-note-wrap"><textarea id="appMpMessageOfferNote" maxlength="500" placeholder="Add a note to the seller…"></textarea><span class="wwo-count">0/500</span></div>'+
   '<div class="wwo-shipping">'+icon('truck')+'<span data-offer-shipping>Loading delivery…</span></div><div class="wwo-total-row"><span>Your offer</span><strong data-offer-subtotal>—</strong></div><div class="wwo-total-row"><span>Buyer fee</span><strong data-offer-fee>—</strong></div><div class="wwo-total-row wwo-total"><span data-offer-total-label>Total if accepted</span><strong data-offer-total>—</strong></div><p class="wwo-info">'+icon('info')+'<span>If accepted, the item is reserved for 24 hours while you complete payment.</span></p><div id="appMpMessageOfferError" role="alert"></div></div><footer class="wwo-footer"><button class="wwo-submit" id="appMpMessageOfferSubmit" disabled>'+(s.counter?'Send counter':'Send offer')+'</button><p>Your offer will appear in Messages.</p></footer></form>';
  root.querySelector('form').onsubmit=submit;root.querySelector('#appMpMessageOfferAmount').oninput=input;root.querySelector('#appMpMessageOfferNote').oninput=event=>{root.querySelector('.wwo-count').textContent=event.target.value.length+'/500';};
 }
 const closeBefore=window.appMpCloseMessageOffer;
 window.appMpCloseMessageOffer=function(){clearTimeout(quoteTimer);quoteVersion++;root.querySelector(':focus')?.blur();state=null;root.classList.remove('show');root.innerHTML='';root.style.height='';return closeBefore?.apply(this,arguments);};
 window.appMpOpenMessageOffer=async function(mode,offerId,initial){
  if(!appMpRequireLogin())return;const c=appMpCurrentConversation||{},counter=mode==='counter';if(c.viewerRole!=='buyer'&&!counter)return;
  const listingId=String(c.listingId||appMpId(appMpListing)||'');if(!listingId)return;
  const token=window.__wishwaveWillOpenView?.('wwOffer');window.appMpCloseMessageOffer();
  const s={session:session(),listingId,counter,offerId:String(offerId||''),title:String(c.listingTitle||appMpListing?.title||'WishWave listing'),image:String(c.listingImage||appMpListing?.images?.[0]||appMpListing?.image||''),currency:String(c.currency||appMpListing?.currency||'AUD'),priceMinor:Math.round(Number(c.listingPrice||appMpListing?.price||0)*100),initial:initial?Number(initial).toFixed(2):'',loaded:false,busy:false,shippingMinor:null,quote:null};state=s;render(s);root.classList.add('show');window.__wishwaveDidOpenView?.(token);resize();
  try{
   const data=await marketplaceFetch('/marketplace/listings/'+encodeURIComponent(listingId),{method:'GET'});if(!current(s))return;const listing=data.listing;if(!listing||data.viewer?.isSeller&&!counter||!counter&&(listing.status||'active')!=='active'||listing.offersEnabled===false)throw Error('This listing is not accepting offers');
   s.priceMinor=Math.round(Number(listing.price)*100);s.currency=String(listing.currency||s.currency);s.listing=listing;
   root.querySelector('.wwo-price').textContent=money(s.priceMinor,s);root.querySelector('#wwoAmountHint').textContent='Enter an amount below '+money(s.priceMinor,s);
   const config=await marketplaceFetch('/marketplace/config',{method:'GET'});if(!current(s))return;
   if(listing.deliveryMode==='pickup'){s.shippingMinor=0;root.querySelector('[data-offer-shipping]').textContent='Local pickup';}
   else if(listing.shippingMode==='calculated'){root.querySelector('[data-offer-shipping]').textContent='Delivery calculated at checkout';}
   else{const delivery=await marketplaceFetch('/marketplace/shipping/quote',{method:'POST',body:JSON.stringify({listingId,destinationCountry:config.marketplace?.detectedCountry||listing.country||'US',destinationPostalCode:''})});if(!current(s))return;const minor=delivery.rates?.[0]?.amountMinor;if(!Number.isSafeInteger(minor)||minor<0)throw Error('Could not calculate delivery');s.shippingMinor=minor;const label=root.querySelector('[data-offer-shipping]');label.textContent=minor===0?'Free shipping':'Shipping '+money(minor,s);label.classList.toggle('wwo-free',minor===0);}
   if(!current(s))return;s.loaded=true;await updateQuote(s);
  }catch(e){if(current(s)){error(e.message||'Could not load offer details');root.querySelector('[data-offer-shipping]').textContent='Delivery unavailable';controls();}}
 };
 async function submit(event){
  event.preventDefault();const s=state;if(!s||!current(s)||s.busy)return;
  const amount=amountMinor();if(!valid(s,amount)){error('Enter a valid amount below the asking price.');return;}if(!s.loaded||!s.quote){error('Wait for the total to finish loading.');return;}
  s.busy=true;controls();error('');const note=root.querySelector('#appMpMessageOfferNote').value;
  try{
   if(s.counter){await marketplaceFetch('/marketplace/offers/'+encodeURIComponent(s.offerId),{method:'PATCH',body:JSON.stringify({action:'counter',amount:amount/100,message:note})});}
   else{if(String(appMpCurrentConversation?.listingId||appMpId(appMpListing))!==s.listingId)throw Error('The conversation changed. Reopen the offer.');const id=await appMpEnsureConversation();if(!current(s))return;await marketplaceFetch('/marketplace/offers',{method:'POST',body:JSON.stringify({listingId:s.listingId,amount:amount/100,message:note})});if(current(s))appMpConversation=id;}
   if(!current(s))return;window.appMpCloseMessageOffer();await appMpLoadMessages();
  }catch(e){if(current(s)){s.busy=false;error(e.message||'Offer could not be sent');controls();}}
 }
 function resize(){const checkout=document.getElementById('wwCheckout'),target=state?root:checkout?.classList.contains('show')?checkout:null;if(!target)return;const app=document.querySelector('.app').getBoundingClientRect(),v=window.visualViewport;const visible=v?Math.min(app.height,v.height+v.offsetTop-app.top):app.height;target.style.height=visible>0&&app.height-visible>120?visible+'px':'';}
 document.addEventListener('focusin',()=>requestAnimationFrame(resize));window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
 const closeCheckout=window.wishwaveCloseCheckout;window.wishwaveCloseCheckout=function(){const checkout=document.getElementById('wwCheckout');if(checkout)checkout.style.height='';return closeCheckout.apply(this,arguments);};
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state){event.preventDefault();window.appMpCloseMessageOffer();}});
 document.addEventListener('wishwave-recommendation-account-change',()=>{if(state)window.appMpCloseMessageOffer();});
})();

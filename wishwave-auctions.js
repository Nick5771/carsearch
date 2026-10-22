/* Native listing entry points remain intact; auction actions stay on the listing. */
(function(){
'use strict';
let timer=null,version=0,busy=false,requestId='',pending=null,lastRevision=-1;
const isAuction=item=>item?.listingType==='auction';
const money=(minor,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor/100);
const esc=escapeHTML;
const originalBuy=window.appMpBuy;
async function stateFor(item){return (await marketplaceFetch('/marketplace/auctions/'+encodeURIComponent(appMpId(item)),{method:'GET'})).auction;}
function remaining(a){const ms=a.endsAt-(Date.now()+(a.serverTime-Date.now()));if(a.state!=='active'||ms<=0)return 'Auction ended';const mins=Math.ceil(ms/60000);return mins>=1440?Math.floor(mins/1440)+'d '+Math.floor(mins%1440/60)+'h remaining':mins>=60?Math.floor(mins/60)+'h '+mins%60+'m remaining':mins+'m remaining';}
async function paintAuction(){
 const item=appMpListing;if(!isAuction(item)||!document.getElementById('appMpProduct')?.classList.contains('show'))return;
 const token=version,session=marketplaceSession(),id=appMpId(item),host=document.getElementById('wwAuctionDetail');if(!host)return;
 if(!marketplaceSession()){host.innerHTML='<p>Sign in to view bidding details.</p><button class="app-mp-action primary" onclick="openLogin()">Sign in to bid</button>';return;}
 try{const a=await stateFor(item);if(version!==token||marketplaceSession()!==session||appMpId(appMpListing)!==id||a.revision<lastRevision)return;lastRevision=a.revision;
 const price=document.querySelector('#appMpProductContent .app-mp-price');if(price)price.textContent=money(a.currentPriceMinor,item.currency);
 appMpListing.price=a.currentPriceMinor/100;appMpListing.status=a.state==='active'?'active':a.state==='paid'?'sold':a.state==='awaiting_payment'?'reserved':'ended';
 host.innerHTML=(a.testMode?'<p class="ww-auction-test">Test auction · No real payment</p>':'')+'<div class="ww-auction-price"><span>'+esc(a.bidCount?'Current bid':'Starting bid')+'</span><strong>'+esc(money(a.currentPriceMinor,item.currency))+'</strong></div><p>'+esc(a.bidCount+' bid'+(a.bidCount===1?'':'s')+' · '+remaining(a))+'</p>'+(a.state==='active'?'<small>Ends '+esc(new Date(a.endsAt).toLocaleString())+'</small>':'')+(a.myMaximumMinor?'<p>Your private maximum: '+esc(money(a.myMaximumMinor,item.currency))+' · '+(a.isLeading?'You’re leading':'You’ve been outbid')+'</p>':'')+(a.isSeller?'<p>'+esc(a.state==='active'?'Your auction':a.state==='awaiting_payment'?'Winner’s payment pending':a.state.replace(/_/g,' '))+'</p>':a.canPay?'<p>You won. Pay by '+esc(new Date(a.paymentDueAt).toLocaleString())+'.</p><button class="app-mp-action primary" onclick="wishwaveAuctionPay()">Pay winning bid</button>':a.state==='active'?'<button class="app-mp-action primary" onclick="wishwaveAuctionBid()">'+(a.isLeading?'Increase maximum':'Place bid')+'</button>':'<p>'+esc(a.state==='unsold'?'Ended without bids':a.state==='unpaid'?'Payment deadline passed':a.state==='paid'?'Sold':'Auction ended')+'</p>');
 }catch(e){if(version===token)host.innerHTML='<p>'+esc(e.message||'Could not load auction')+'</p><button class="app-mp-action tertiary" onclick="wishwaveRefreshAuction()">Retry</button>';}
}
window.wishwaveRefreshAuction=paintAuction;
// Fixed-price WishWave-native listings use the existing messages/offer composer.
// External marketplace cards and native auctions keep their established actions.
const ctaStyle=document.createElement('style');
ctaStyle.id='wishwave-native-cta-v355';
ctaStyle.textContent=
  '#appMpProductContent .wishwave-detail-actions.ww-native-offer-buy{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 44px!important;gap:8px!important;align-items:stretch!important;position:sticky;bottom:0;z-index:5;padding:12px 0 calc(12px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(16,17,19,.97),#101113);border-top:1px solid rgba(255,255,255,.08);}' +
  '#appMpProductContent .ww-native-offer-buy :is(.ww-native-make-offer,.primary){height:49px!important;min-height:49px!important;margin:0!important;padding:0 9px!important;display:flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important;font-size:14px!important;font-weight:680!important;line-height:1.2!important;border-radius:14px!important;}' +
  '#appMpProductContent .ww-native-offer-buy .ww-native-make-offer{order:0;background:#27282c!important;color:#fff!important;border:1px solid rgba(255,255,255,.13)!important;}' +
  '#appMpProductContent .ww-native-offer-buy .primary{order:1;background:#f5f5f6!important;color:#111214!important;border:1px solid #f5f5f6!important;}' +
  '#appMpProductContent .ww-native-offer-buy .wishwave-detail-save{order:2;display:flex!important;align-items:center!important;justify-content:center!important;width:44px!important;min-width:44px!important;height:49px!important;min-height:49px!important;padding:0!important;margin:0!important;border-radius:14px!important;background:#242528!important;color:#fff!important;border:1px solid rgba(255,255,255,.13)!important;}' +
  '#appMpProductContent .ww-native-offer-buy .wishwave-detail-save svg{width:23px!important;height:23px!important;stroke-width:2.45!important;stroke-linecap:round!important;stroke-linejoin:round!important;}' +
  '#appMpProductContent .ww-native-offer-buy .wishwave-detail-save span{display:none!important;}' +
  '@media(max-width:360px){#appMpProductContent .wishwave-detail-actions.ww-native-offer-buy{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px!important;gap:6px!important;}#appMpProductContent .ww-native-offer-buy .wishwave-detail-save{width:40px!important;min-width:40px!important;}}';
document.head.appendChild(ctaStyle);
function polishNativeBuyActions(){
 const item=appMpListing,root=document.getElementById('appMpProductContent');
 if(!item||isAuction(item)||!root)return;
 const actions=root.querySelector('.wishwave-detail-actions');
 const buy=actions?.querySelector('.primary');
 const save=actions?.querySelector('.wishwave-detail-save');
 const isSeller=!!appMpContext?.viewer?.isSeller||!!window.wishwaveIsOwnMarketplaceListing?.(item);
 if(!actions||!buy||!save||isSeller||String(item.status||'active')!=='active'||Number(item.price)<=0.01)return;
 const offer=document.createElement('button');
 offer.type='button';offer.className='app-mp-action ww-native-make-offer';offer.textContent='Make offer';
 offer.setAttribute('aria-label','Make an offer on this listing');
 offer.addEventListener('click',()=>{if(typeof window.openAppMarketplaceOfferInMessages==='function')window.openAppMarketplaceOfferInMessages();});
 actions.insertBefore(offer,buy);
 actions.classList.add('ww-native-offer-buy');
 save.setAttribute('aria-label','Save listing');
}
const render=window.renderAppMarketplaceListing;
window.renderAppMarketplaceListing=function(){const result=render.apply(this,arguments);if(!isAuction(appMpListing)){polishNativeBuyActions();return result;}
 const root=document.getElementById('appMpProductContent');root.querySelector('.wishwave-detail-actions .primary')?.remove();
 root.querySelectorAll('[onclick*="Offer"],[onclick*="offer"]').forEach(b=>b.remove());
 const host=document.createElement('section');host.id='wwAuctionDetail';host.className='ww-auction-detail';host.setAttribute('aria-label','Auction bidding');host.innerHTML='<p>Loading auction…</p>';
 const actions=root.querySelector('.wishwave-detail-actions');if(actions)actions.before(host);else root.append(host);
 clearInterval(timer);version++;lastRevision=-1;paintAuction();timer=setInterval(()=>{if(!document.hidden)paintAuction();},3000);return result;
};
window.wishwaveAuctionBid=async function(){
 if(!appMpListing||!appMpRequireLogin()||busy)return;const item=appMpListing,token=version;
 try{const a=await stateFor(item);if(token!==version||!marketplaceSession())return;if(a.isSeller||a.state!=='active'){toast('This auction is not open for your bid');return;}
 const minimum=a.isLeading&&a.myMaximumMinor?a.myMaximumMinor+1:a.minimumBidMinor;
 pending={id:appMpId(item),currency:item.currency,shipping:Math.round(Number(item.shippingCost||0)*100),minimum,maximum:minimum};requestId=crypto.randomUUID();
 openAppMpSheet('Place a bid','<form id="wwAuctionBidForm" onsubmit="return wishwaveAuctionReview(event)"><label>Your maximum bid ('+esc(item.currency)+')<input id="wwAuctionMaximum" type="number" inputmode="decimal" min="'+(minimum/100).toFixed(2)+'" step="0.01" value="'+(minimum/100).toFixed(2)+'" required></label><p>Your maximum stays private. We bid only enough to keep you ahead, up to your limit. Equal maximums favour the earlier bid.</p><p>Shipping: '+esc(money(pending.shipping,item.currency))+'. Buyer fees are shown before you confirm.</p><button class="app-mp-action primary">Review bid</button></form>');
 }catch(e){toast(e.message||'Could not load bidding');}
};
window.wishwaveAuctionReview=function(event){event.preventDefault();if(!pending||busy)return false;
 const value=document.getElementById('wwAuctionMaximum')?.value||'';if(!/^\d+(?:\.\d{1,2})?$/.test(value)){toast('Enter a price with up to two decimal places');return false;}
 const max=Math.round(Number(value)*100);if(!Number.isSafeInteger(max)||max<pending.minimum||max>1000000000){toast('Enter a valid maximum bid');return false;}
 const current=pending;current.maximum=max;busy=true;event.submitter&&(event.submitter.disabled=true);
 marketplaceFetch('/marketplace/quote',{method:'POST',body:JSON.stringify({itemMinor:max,shippingMinor:current.shipping,currency:current.currency})}).then(data=>{
 if(pending!==current||appMpId(appMpListing)!==current.id)return;const q=data.quote;if(!q||!Number.isSafeInteger(q.buyerTotalMinor))throw new Error('Could not load fees');
 openAppMpSheet('Confirm your maximum','<div class="ww-auction-review"><strong>'+esc(money(max,current.currency))+'</strong><p>Maximum item bid</p><p>Shipping '+esc(money(q.shippingMinor,current.currency))+' · Buyer fee up to '+esc(money(q.buyerFeeMinor,current.currency))+'</p><p>Maximum total '+esc(money(q.buyerTotalMinor,current.currency))+'. The final price may be lower.</p><p>If you win, you agree to purchase this item and pay within 4 days. Your bid cannot be withdrawn in the app.</p><button class="app-mp-action primary" onclick="wishwaveAuctionConfirm()">Confirm maximum bid</button></div>');
 }).catch(e=>toast(e.message||'Could not review bid')).finally(()=>{busy=false;});return false;
};
window.wishwaveAuctionConfirm=async function(){
 if(!pending||busy||appMpId(appMpListing)!==pending.id)return;const current=pending;busy=true;document.querySelector('.ww-auction-review button')?.setAttribute('disabled','');
 try{const data=await marketplaceFetch('/marketplace/auctions/'+encodeURIComponent(current.id)+'/bids',{method:'POST',headers:{'Idempotency-Key':requestId},body:JSON.stringify({maximumMinor:current.maximum,requestId,confirmed:true})});if(pending!==current)return;pending=null;closeAppMpSheet();toast(data.auction.isLeading?'You’re the highest bidder':'Bid received. Another bidder’s maximum is higher.');await paintAuction();}
 catch(e){toast(e.message||'Bid could not be confirmed. You can retry safely.');document.querySelector('.ww-auction-review button')?.removeAttribute('disabled');}finally{busy=false;}
};
window.wishwaveAuctionPay=async function(){if(!appMpListing||busy)return;try{const a=await stateFor(appMpListing);if(!a.canPay){toast('Payment is available only to the winner before the deadline');return;}appMpListing={...appMpListing,price:a.currentPriceMinor/100,status:'reserved',_auctionWinnerVerified:true};return originalBuy();}catch(e){toast(e.message||'Could not load payment');}};
window.appMpBuy=function(){if(isAuction(appMpListing))return window.wishwaveAuctionBid();return originalBuy.apply(this,arguments);};
const openCheckout=window.wishwaveCheckoutOpenItem;window.wishwaveCheckoutOpenItem=function(item){if(isAuction(item))return openAppMarketplaceListing(item);return openCheckout.apply(this,arguments);};
const signout=window.signOutAccount;if(typeof signout==='function')window.signOutAccount=function(){version++;pending=null;busy=false;lastRevision=-1;document.getElementById('wwAuctionDetail')?.replaceChildren();closeAppMpSheet();return signout.apply(this,arguments);};
const close=window.closeAppMarketplaceListing;window.closeAppMarketplaceListing=function(){version++;pending=null;busy=false;clearInterval(timer);timer=null;return close.apply(this,arguments);};
})();

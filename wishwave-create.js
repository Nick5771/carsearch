/* Create choices and a focused listing composer. Auction publishing uses the same validated media pipeline with an explicit auction type. */
(function(){
'use strict';
const root=document.getElementById('createListingScreen'),form=document.getElementById('createListingForm');
if(!root||!form)return;
const el=id=>document.getElementById(id),submit=el('createListingSubmit');
let type='sell',drafts={},draftOwner='';
root.classList.add('ww-create-form-a');
const ids=['listingItemName','listingItemDescription','listingPrice','listingCondition','listingCategory','listingDeliveryMode','listingShippingFee','listingPickupArea','listingAuctionDuration','listingQuantity','listingAllowOffers'];
const choices=document.createElement('div');choices.id='wwCreateChoices';choices.hidden=true;root.querySelector('.marketplace-header').after(choices);
window.wishwaveCreatePromote=function(){window.openWishWaveDashboard();document.querySelector('#wwDashboard [data-wwd-action="promotions"]')?.click();};
const save=document.createElement('button');save.type='button';save.className='ww-save-draft';save.textContent='Save draft';root.querySelector('.marketplace-header-spacer').replaceWith(save);
root.querySelector('.marketplace-header button').setAttribute('onclick','closeCreateListing()');
const details=root.querySelector('.wishwave-listing-details');
const category=document.createElement('label');category.className='marketplace-field ww-category';category.innerHTML='<span>Category</span><select id="listingCategory"><option value="">Choose category</option>'+['Gaming','Trading cards','Clothing','Shoes','Accessories','Collectibles','Electronics','Home','Art','Books and music','Other'].map(x=>'<option>'+x+'</option>').join('')+'</select>';
category.querySelector('select').required=true;details.appendChild(category);
const condition=root.querySelector('.wishwave-condition-row');condition.classList.add('ww-condition');
const select=document.createElement('select');select.id='wwConditionSelect';select.setAttribute('aria-label','Condition');select.innerHTML=['New','Like new','Used','New (Other)'].map(x=>'<option>'+x+'</option>').join('');condition.appendChild(select);select.onchange=()=>window.selectListingCondition(select.value);
root.querySelector('#listingItemDescription').placeholder='Describe the item, its condition and what’s included.';
const format=document.createElement('fieldset');format.className='ww-sale-format';format.innerHTML='<legend>Sale format</legend><div><button type="button" data-create-type="sell" aria-pressed="true">Fixed price</button><button type="button" data-create-type="auction" aria-pressed="false">Auction</button></div>';details.appendChild(format);format.onclick=event=>{const button=event.target.closest('[data-create-type]');if(button)window.wishwaveChooseCreateType(button.dataset.createType);};
const duration=document.createElement('label');duration.className='marketplace-field ww-auction-duration';duration.innerHTML='<span>Duration</span><select id="listingAuctionDuration"><option value="3">3 days</option><option value="5">5 days</option><option value="7">7 days</option></select>';details.appendChild(duration);
const deliverySection=root.querySelector('.wishwave-listing-delivery');deliverySection.classList.add('ww-compact-delivery');details.appendChild(deliverySection);
const deliveryLabel=document.createElement('label');deliveryLabel.className='ww-delivery-select';deliveryLabel.innerHTML='<span>Delivery</span><select id="wwDeliverySelect"><option value="">Choose options</option><option value="shipping">Shipping</option><option value="pickup">Pickup</option><option value="both">Shipping or pickup</option></select>';deliverySection.prepend(deliveryLabel);el('wwDeliverySelect').onchange=event=>window.wishwaveSelectDelivery(event.target.value);
const notice=document.createElement('p');notice.className='ww-auction-notice';notice.textContent='Bids are automatic up to each buyer’s private maximum. Starting price is your minimum. Published auctions cannot be edited.';details.after(notice);
const more=document.createElement('details');more.className='ww-more-details';more.innerHTML='<summary>More details<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></summary><div class="ww-more-panel"><label><span>Quantity</span><input id="listingQuantity" type="number" min="1" max="99" step="1" inputmode="numeric" value="1" required></label><label><span>Accept offers</span><input id="listingAllowOffers" type="checkbox" checked></label></div>';form.appendChild(more);form.addEventListener('invalid',event=>{if(more.contains(event.target))more.open=true;},true);more.addEventListener('toggle',()=>root.classList.toggle('ww-more-open',more.open));
const reset=window.resetCreateListingForm;window.resetCreateListingForm=function(){const out=reset.apply(this,arguments);el('listingAllowOffers').checked=window.findaiV137Prefs?.().sellerAllowOffers!==false;more.open=false;root.classList.remove('ww-more-open');return out;};
const hint=document.createElement('p');hint.className='ww-create-review';hint.textContent='Review everything before you publish.';submit.before(hint);
// A readable custom value and chevron sit above a native 16px select, preserving iPhone picker behavior without focus zoom.
root.querySelectorAll('select').forEach(control=>{const wrapper=document.createElement('span');wrapper.className='ww-select-control';const copy=document.createElement('span');copy.className='ww-select-value';copy.setAttribute('aria-hidden','true');control.before(wrapper);wrapper.append(control,copy);});
const key=()=>{const p=getAccountProfile();return 'wishwave-create-drafts-v308:'+String(p?.email||p?.username||p?.id||'guest');};
function remember(){drafts[type]={fields:Object.fromEntries(ids.map(id=>[id,el(id)?.type==='checkbox'?el(id).checked:el(id)?.value||''])),images:pendingListingImages.slice()};}
function persist(){remember();try{localStorage.setItem(key(),JSON.stringify(drafts));toast('Draft saved on this device');return true;}catch(_){toast('Draft could not be saved. Keep this page open or use fewer photos.');return false;}}
function sync(){
 root.dataset.createType=type;
 root.querySelector('.marketplace-header h2').textContent=root.classList.contains('preview-mode')?'Preview listing':'Create listing';
 save.textContent='Drafts';
 format.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.createType===type)));
 el('listingAuctionDuration').disabled=type!=='auction';el('listingAuctionDuration').required=type==='auction';
 select.value=el('listingCondition').value;el('wwDeliverySelect').value=el('listingDeliveryMode').value;root.classList.toggle('ww-expanded-delivery',!!el('listingDeliveryMode').value);root.querySelectorAll('.ww-select-control').forEach(wrapper=>{const control=wrapper.querySelector('select');wrapper.querySelector('.ww-select-value').textContent=control.options[control.selectedIndex]?.textContent||'';});
 root.querySelector('.wishwave-listing-price>span').textContent=(type==='auction'?'Starting bid':'Price')+' ('+(window.findaiV137Prefs?.().currency||'AUD')+')';
 if(!submit.dataset.publishing)submit.textContent=root.classList.contains('preview-mode')?(type==='auction'?'Publish auction':'Publish listing'):'Preview listing';
 if(type==='auction'&&!submit.dataset.publishing)submit.disabled=false;
}
function stage(value){root.dataset.createStage=value;window.wishwaveSetCreateMode('edit');root.querySelector('.marketplace-scroll').scrollTop=0;sync();}
window.wishwaveChooseCreateType=function(next,restoreDraft=false){
 if(!['sell','auction'].includes(next))return;
 if(root.dataset.createStage==='form'&&!restoreDraft)remember();
 type=next;
 if(restoreDraft){const draft=drafts[type];window.resetCreateListingForm();if(draft){for(const [id,value]of Object.entries(draft.fields||{}))if(el(id)){if(el(id).type==='checkbox')el(id).checked=Boolean(value);else el(id).value=value;}pendingListingImages=Array.isArray(draft.images)?draft.images.slice():[];window.selectListingCondition(el('listingCondition').value);window.renderListingImagePreviews();window.wishwaveSyncCreateDelivery();}}
 stage('form');
 if(type==='auction')marketplaceFetch('/marketplace/config',{method:'GET'}).then(data=>{if(type==='auction'&&data.marketplace?.auctionsEnabled===false)notice.textContent='Connect seller payments before publishing an auction. You can save a draft now.';}).catch(()=>{});
};
const draftDialog=document.createElement('dialog');draftDialog.id='wwCreateDrafts';draftDialog.setAttribute('aria-labelledby','wwCreateDraftsTitle');root.appendChild(draftDialog);
save.onclick=()=>{draftDialog.replaceChildren();const head=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.id='wwCreateDraftsTitle';title.textContent='Drafts';close.type='button';close.textContent='×';close.setAttribute('aria-label','Close drafts');close.onclick=()=>draftDialog.close();head.append(title,close);draftDialog.append(head);
 const store=document.createElement('button');store.type='button';store.textContent='Save current draft';store.onclick=()=>{if(persist())draftDialog.close();};draftDialog.append(store);
 for(const kind of Object.keys(drafts).filter(x=>['sell','auction'].includes(x))){const button=document.createElement('button');button.type='button';button.textContent=(kind==='auction'?'Auction: ':'Listing: ')+(drafts[kind].fields?.listingItemName||'Untitled draft');button.onclick=()=>{draftDialog.close();window.wishwaveChooseCreateType(kind,true);};draftDialog.appendChild(button);}draftDialog.showModal();};
const open=window.openCreateListing;window.openCreateListing=function(){const changed=draftOwner!==key();if(changed){draftOwner=key();drafts={};type='sell';delete root.dataset.draftReady;try{drafts=JSON.parse(localStorage.getItem(key())||'{}')||{};}catch(_){}}
 const out=open.apply(this,arguments);if(root.classList.contains('show'))stage('form');return out;};
const close=window.closeCreateListing;window.closeCreateListing=function(options={}){if(root.classList.contains('show')&&!options.published&&!options.navigation&&root.classList.contains('preview-mode')){window.wishwaveSetCreateMode('edit');sync();return;}
 if(root.classList.contains('show')&&!options.published)remember();if(options.published){delete drafts[type];try{localStorage.setItem(key(),JSON.stringify(drafts));}catch(_){}}draftDialog.close();return close.apply(this,arguments);};
const mode=window.wishwaveSetCreateMode;window.wishwaveSetCreateMode=function(){const out=mode.apply(this,arguments);sync();return out;};
const photos=window.wishwaveSyncCreatePreview;window.wishwaveSyncCreatePreview=function(){const out=photos.apply(this,arguments);const empty=root.querySelector('.wishwave-draft-empty');if(empty){empty.innerHTML='<span class="ww-upload-art"><img src="assets/wishwave-collection-v256.png" alt=""><span class="ww-upload-plus" aria-hidden="true">+</span></span><b>Add photos</b><small>Bring your listing to life.</small>';}
root.classList.toggle('ww-has-photos',pendingListingImages.length>0);sync();return out;};
const publish=window.submitCreateListing;window.submitCreateListing=function(event){return publish.apply(this,arguments);};
// Preview is a separate step. Only its Publish button reaches the existing validated publisher.
submit.addEventListener('click',event=>{if(type==='auction'&&(el('listingDeliveryMode').value!=='shipping'||el('listingShippingMode')?.value==='calculated')){event.preventDefault();event.stopImmediatePropagation();toast('Auctions require shipping with a fixed or free delivery price');return;}if(!root.classList.contains('preview-mode')){event.preventDefault();event.stopImmediatePropagation();if(!form.reportValidity())return;if(!pendingListingImages.length){toast('Add at least one photo');return;}if(!window.wishwaveListingDeliveryPayload()){toast('Choose delivery and add its details');return;}window.wishwaveSetCreateMode('preview');}},true);
const delivery=window.wishwaveSyncCreateDelivery;window.wishwaveSyncCreateDelivery=function(){const out=delivery.apply(this,arguments);sync();return out;};
form.addEventListener('change',()=>{window.wishwaveSyncCreatePreview();window.wishwaveSyncCreateDelivery();});
// Main form swipes between tabs; only full preview uses the child-page Back path.
const child=window.__wishwaveChildSurface;window.__wishwaveChildSurface=function(target){const surface=child?.(target);if(surface?.root===root&&!root.classList.contains('preview-mode'))return null;return surface;};
// Replace legacy empty slots with three consistently sized upload targets.
const renderPhotos=window.renderListingImagePreviews;window.renderListingImagePreviews=function(){const out=renderPhotos.apply(this,arguments);const grid=el('listingImageGrid');if(!pendingListingImages.length&&grid){grid.querySelectorAll('.wishwave-listing-photo-slot').forEach(node=>node.remove());for(let i=0;i<3;i++){const slot=document.createElement('button');slot.type='button';slot.className='ww-create-empty-photo';slot.setAttribute('aria-label','Add listing photo');slot.textContent='+';slot.onclick=()=>el('listingImageInput').click();grid.appendChild(slot);}}return out;};
window.renderListingImagePreviews();
stage('form');window.wishwaveSyncCreatePreview();
})();

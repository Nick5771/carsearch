const assert=require('assert'),fs=require('fs'),vm=require('vm'),zlib=require('zlib');
const {screenshotPhotoBounds:bounds}=require('../wishwave-photo-hygiene.js');
const photos=require('./fixtures/phone-viewer-photos.json');
for(const photo of photos){
 const rgba=zlib.inflateSync(Buffer.from(photo.rgbaZlib,'base64'));
 const result=bounds(rgba,photo.width,photo.height);
 assert(result,'both actual seller screenshots must be identified');
 assert(result.top>=38&&result.top<=41);assert(result.bottom>=168&&result.bottom<=171);
 // A clean crop must not be classified a second time.
 const crop=rgba.subarray(result.top*photo.width*4,result.bottom*photo.width*4);
 assert.equal(bounds(crop,photo.width,result.bottom-result.top),null);
 const noControls=Buffer.from(rgba);noControls.fill(0,0,(result.top-2)*photo.width*4);
 assert.equal(bounds(noControls,photo.width,photo.height),null,'black letterboxing without phone controls is insufficient');
}
function solid(w,h,value){return Buffer.alloc(w*h*4,value);}
assert.equal(bounds(solid(96,208,0),96,208),null,'dark products must remain untouched');
assert.equal(bounds(solid(96,208,255),96,208),null,'white-background portraits must remain untouched');
assert.equal(bounds(solid(96,96,0),96,96),null,'square photos remain untouched');
(async()=>{
 let probes=[],draws=[],failRead=false;
 class Probe{constructor(){probes.push(this);this.naturalWidth=738;this.naturalHeight=1600;}}
 const rgba=zlib.inflateSync(Buffer.from(photos[0].rgbaZlib,'base64'));
 const document={createElement:()=>({getContext:()=>({drawImage:(...args)=>draws.push(args),getImageData:()=>{if(failRead)throw Error('CORS');return {data:rgba}}}),toDataURL:()=> 'data:image/jpeg;base64,clean'})};
 const window={document};vm.runInNewContext(fs.readFileSync(require.resolve('../wishwave-photo-hygiene.js'),'utf8'),{window,document,Image:Probe,URL,Map});
 const src='https://i.ebayimg.com/images/g/example/s-l1600.jpg';
 function image(url=src){return {src:url,currentSrc:url,isConnected:true,dataset:{},closest:()=>true,getAttribute:()=>url};}
 const a=image(),b=image();window.wishwaveCleanListingPhoto(a);window.wishwaveCleanListingPhoto(b);
 assert.equal(probes.length,1,'share inspection across duplicate photo URLs');assert.equal(probes[0].crossOrigin,'anonymous');
 probes[0].onload();await Promise.resolve();assert.equal(a.src,'data:image/jpeg;base64,clean');assert.equal(b.src,a.src);
 assert(draws[1][2]>250&&draws[1][4]>970,'crop source frame only, retain whole photo');
 const stale=image(src+'?stale');window.wishwaveCleanListingPhoto(stale);stale.isConnected=false;probes[1].onload();await Promise.resolve();assert.equal(stale.src,src+'?stale');
 const error=image(src+'?error');window.wishwaveCleanListingPhoto(error);failRead=true;probes[2].onload();await Promise.resolve();assert.equal(error.src,src+'?error','canvas failure leaves original intact');
 window.wishwaveCleanListingPhoto(image('https://other.example/photo.jpg'));assert.equal(probes.length,3,'only known CORS-safe retailer host is inspected');
 console.log('PASS: real screenshot detection, ordinary/dark photo protection, shared work, source crop, stale gallery and CORS safety');
})().catch(error=>{console.error(error);process.exitCode=1});

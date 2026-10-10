const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','findai-app.html'),'utf8');
const tileStart=html.indexOf('  function exploreTile(item,index){'),tileEnd=html.indexOf('\n  /* v128',tileStart);
const errorStart=html.indexOf('function appRetailerImgError('),errorEnd=html.indexOf('\nfunction ',errorStart+10);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
const ctx=vm.createContext({escapeAttr:esc,escapeHTML:esc,imageCandidateUrls:item=>[item.image,...item.imageFallbacks],premiumProductImage:item=>item.image,getSource:item=>item.source,appImageAltAttr:urls=>esc(JSON.stringify(urls)),exploreSource:()=>'<span>StockX</span>',exploreCompactPrice:()=>'$200',safeUrl:s=>s,
 document:{createElement:()=>({firstElementChild:{kind:'placeholder'},set innerHTML(value){this.markup=value;}})},appRetailerProductPlaceholder:(item,cls)=>`<div class="${cls}">StockX image unavailable</div>`});
vm.runInContext(html.slice(tileStart,tileEnd)+'\n'+html.slice(errorStart,errorEnd),ctx);
const markup=ctx.exploreTile({source:'StockX',title:'Jordan 1',image:'https://images.stockx.com/bad.jpg',imageFallbacks:['https://images.stockx.com/good.jpg']},0);
assert(markup.includes('data-image-alts='));assert(markup.includes('appRetailerImgError'));assert(!markup.includes("style.display='none'"));
let replacement=null;
const attrs={'data-image-alts':JSON.stringify(['https://images.stockx.com/alt1.jpg','https://images.stockx.com/alt2.jpg'])};
const tile={style:{},price:200,source:'StockX',clickable:true};
const img={src:'https://images.stockx.com/bad.jpg',style:{},getAttribute:k=>attrs[k],setAttribute:(k,v)=>attrs[k]=v,replaceWith:node=>replacement=node,closest:()=>tile};
ctx.appRetailerImgError(img,'StockX','','premium-explore-image-placeholder');assert.equal(img.src,'https://images.stockx.com/alt1.jpg');assert.equal(replacement,null);
ctx.appRetailerImgError(img,'StockX','','premium-explore-image-placeholder');assert.equal(img.src,'https://images.stockx.com/alt2.jpg');assert.equal(replacement,null);
ctx.appRetailerImgError(img,'StockX','','premium-explore-image-placeholder');assert.equal(replacement.kind,'placeholder');assert.equal(tile.style.display,undefined);assert(tile.clickable);assert.equal(tile.price,200);
assert(html.includes('includeFallbacks?item.imageFallbacks:null].forEach'));assert(html.includes("'images','imageFallbacks','condition'"));
console.log('PASS: Search tiles retry alternative images; exhausted images replace only the image; listing position, price and click target remain; image fallbacks survive saved search items');

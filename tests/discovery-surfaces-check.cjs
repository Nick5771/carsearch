const assert=require('assert'),{create,key}=require('../wishwave-discovery-surfaces.js');
const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
let at=100000000,scope='guest';const options={storage,scope:()=>scope,now:()=>at};
const items=Array.from({length:24},(_,i)=>({_treasureTargetId:'FF'+String(i%12).padStart(3,'0'),itemId:'seller-'+i,_interestCategory:['toys','cards','apparel'][i%3]}));
const a=create(options),home=a.partition(items,'home'),search=a.partition(items,'search');
assert(home.length&&search.length);const keys=new Set(home.map(key));assert(search.every(x=>!keys.has(key(x))),'different sellers of the same target stay on one surface');assert.equal(home.length+search.length,items.length);
for(const category of ['toys','cards','apparel']){assert(home.some(x=>x._interestCategory===category));assert(search.some(x=>x._interestCategory===category));}
assert.deepEqual(create(options).partition(items,'home'),home,'device reload keeps reservations');
assert(!a.allowed(home[0],'search'));assert.deepEqual(a.claim([home[0]],'search'),[]);
const next={title:'Original unusual camera',itemId:'new'};assert.equal(a.claim([next],'search').length,1);assert(!a.allowed({...next,itemId:'other-seller'},'home'));
assert.equal(key({title:'LEGO Typewriter 21327 complete'}),key({title:'LEGO Ideas 21327 sealed from other seller'}));assert.equal(key({styleId:'DZ5485-612',brand:'Nike'}),key({styleId:'DZ5485-612',brand:'Jordan'}));assert.equal(key({}), '');
scope='signed-in-new-account';assert(a.allowed(next,'home'),'accounts do not inherit another account’s reservations');scope='guest';assert(!a.allowed(next,'home'));at+=6*3600000+1;assert(a.allowed(next,'home'),'reservations expire');
const noStorage=create({storage:{getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}},now:()=>at});assert(noStorage.partition(items,'home').length);assert(noStorage.partition(items,'search').length);
console.log('PASS: product-level split, balanced categories, shared-seller exclusion, reload persistence, account isolation, expiry and unavailable storage');

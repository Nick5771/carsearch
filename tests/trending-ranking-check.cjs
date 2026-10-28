const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert'),{execFileSync}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wishwave-trending-')),db=path.join(dir,'test.db');
const python=`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
b=json.load(sys.stdin)
if 'script' in b:c.executescript(b['script'])
else:
 r=c.execute(b['sql'],b.get('args',[]));print(json.dumps([dict(x) for x in r.fetchall()]))
c.commit()
`;
const call=b=>execFileSync('python',['-c',python,db],{input:JSON.stringify(b),encoding:'utf8'});
const now=Date.now(),image='https://i.ebayimg.com/product.jpg';
const item=(id,extra={})=>({itemId:id,title:id,price:20,currency:'USD',source:'ebay',image,url:'https://www.ebay.com/itm/'+id,...extra});
const q=value=>"'"+String(value).replace(/'/g,"''")+"'";
let script=`CREATE TABLE recommendation_trials(viewer_key TEXT,event TEXT,dwell_ms INTEGER,occurred_at INTEGER,listing_key TEXT,created_at INTEGER);
CREATE TABLE recommendation_catalogue(item_key TEXT,country TEXT,available INTEGER,observed_at INTEGER,item TEXT);
CREATE TABLE marketplace_sellers(id TEXT,user_email TEXT,display_name TEXT,country TEXT,status TEXT);
CREATE TABLE marketplace_listings(id TEXT,seller_id TEXT,title TEXT,status TEXT,quantity INTEGER,view_count INTEGER,like_count INTEGER,image TEXT);
CREATE TABLE findai_profiles(user_email TEXT,username TEXT,avatar_url TEXT,display_name TEXT);
CREATE TABLE findai_app_preferences(email TEXT,settings_json TEXT);
CREATE TABLE findai_user_controls(owner_email TEXT,target_email TEXT,kind TEXT);`;
for(const [id,available,fresh]of[['viewed',1,now],['engaged',1,now],['no-activity',1,now],['stale',1,now-86400000],['unavailable',0,now]])script+=`INSERT INTO recommendation_catalogue VALUES(${q('ebay:'+id)},'US',${available},${fresh},${q(JSON.stringify(item(id,{watchCount:999999})))});`;
for(const [id,viewer,event,at]of[['viewed','a','click',now],['viewed','a','click',now],['viewed','b','attention',now],['viewed','c','click',now],['engaged','d','like',now],['engaged','e','track',now],['no-activity','f','impression',now],['stale','g','click',now],['unavailable','h','click',now],['no-activity','old','click',now-9*86400000]])script+=`INSERT INTO recommendation_trials VALUES(${q(viewer)},${q(event)},3000,${at},${q('ebay:'+id)},${at});`;
for(const [id,views,status,privacy,country]of[['public',100,'active',null,'US'],['private',999,'active','{"privateAccount":true}','US'],['invalid',999,'active','broken','US'],['sold',999,'sold',null,'US'],['other-country',999,'active',null,'AU'],['blocked',999,'active',null,'US'],['zero',0,'active',null,'US']]){
script+=`INSERT INTO marketplace_sellers VALUES(${q(id)},${q(id+'@test')},${q(id)},${q(country)},'active');INSERT INTO marketplace_listings VALUES(${q(id)},${q(id)},${q(id)},${q(status)},1,${views},0,${q(image)});`;
if(privacy)script+=`INSERT INTO findai_app_preferences VALUES(${q(id+'@test')},${q(privacy)});`;}
script+="INSERT INTO findai_user_controls VALUES('viewer@test','blocked@test','blocked');";call({script});
const source=fs.readFileSync('findai-worker.js','utf8'),helper=source.slice(source.indexOf('async function wishwaveTrending('),source.indexOf('async function intelligenceCommunity('));
const env={DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this},async all(){return {results:JSON.parse(call({sql,args}))}}};}}};
const c=vm.createContext({URL,Date,JSON,Map,Number,String,Math,rateLimited:async()=>false,tooManyResp:()=>({status:429}),catalogueCountry:x=>x||'US',detectCountry:()=> 'US',shoppingEnsureSchema:async()=>{},catalogueEnsure:async()=>{},mpPublicMarketplaceEnabled:()=>true,mpEnsureSchema:async()=>{},findaiProfileEnsureSchema:async()=>{},findaiAppPrefsEnsureSchema:async()=>{},findaiSocialControlsEnsureSchema:async()=>{},emailFromSession:async()=> 'viewer@test',catalogueGalleryImages:i=>i.image?[i.image]:[],mpListingItem:r=>({itemId:r.id,title:r.title,price:20,source:'findai',image:r.image,viewCount:r.view_count,likeCount:r.like_count,status:r.status}),jsonResp:(body,status)=>({body,status})});
vm.runInContext(helper,c);
(async()=>{try{const run=offset=>c.wishwaveTrending({url:'https://test/recommendations/trending?country=US&limit=2&offset='+offset},env);const first=await run(0);assert.equal(first.status,200);assert.deepEqual(Array.from(first.body.items,x=>x.itemId),['public','engaged']);assert(first.body.hasMore);assert.equal(first.body.items[0]._trendingViews,100);const next=await run(first.body.nextOffset);assert.deepEqual(Array.from(next.body.items,x=>x.itemId),['viewed']);assert.equal(next.body.items[0]._trendingViews,3,'repeat clicks by the same viewer count once');assert.equal(next.body.hasMore,false);assert(!JSON.stringify(first.body).includes('@test'),'no viewer or seller identities leak');console.log('PASS: real SQL ranking, unique views, engagement weighting, pagination, freshness, public/private/blocked/active/region filters and zero-activity exclusion');}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});

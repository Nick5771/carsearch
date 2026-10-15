/* Keep passive Home and Search discovery distinct. Explicit searches are exempt. */
(function(root){
  'use strict';
  const VERSION=254,TTL=6*60*60*1000,MAX=640;
  const categoryKey=item=>/lego/i.test(String(item._treasureCategory||item._interestCategory||item.title||''))?'lego':item._treasureCategory||item._interestCategory||'other';
  const normal=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function hash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function productKey(item){
    if(!item)return '';
    const target=item._treasureTargetId||String(item._interestCluster||'').match(/^treasure:(FF\d+)$/)?.[1]||root.FindAITreasureHunt?.identify?.(item)?.id;
    if(target)return 'target:'+target;
    if(item.styleId)return 'style:'+normal(item.styleId);
    if(item.sku)return 'sku:'+normal(item.brand)+' '+normal(item.sku);
    const title=normal(item.title),set=title.includes('lego')&&title.match(/\b\d{5}\b/);
    if(set)return 'lego:'+set[0];
    // Product images help identify the same retail product across differently worded sellers.
    const image=String(item.stockxImage||'').split('?')[0];if(image)return 'image:'+image;
    const value=normal(item._shoppingProductKey||item.productId||item.title||item.itemId||item.id||item.url);return value?'product:'+value:'';
  }
  function create({storage,scope=()=> 'guest',now=()=>Date.now(),visit=''}={}){
    let scopeKey='',claims=new Map(),seed=0;
    function load(){const key='ww_discovery_surfaces_v'+VERSION+'_'+hash(scope()||'guest');if(key===scopeKey)return;
      scopeKey=key;claims=new Map();seed=hash(key+now()+visit);
      try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved&&(!visit||saved.visit===visit)){seed=saved.seed||seed;for(const c of saved.claims||[])if(c.at>now()-TTL&&['home','search'].includes(c.owner))claims.set(c.key,c);}}catch(_){}
    }
    function prune(){load();for(const[k,c]of claims)if(c.at<=now()-TTL)claims.delete(k);while(claims.size>MAX)claims.delete(claims.keys().next().value);}
    function save(){prune();try{storage?.setItem(scopeKey,JSON.stringify({seed,visit,claims:[...claims.values()]}));}catch(_){} }
    function allowed(item,surface){prune();const key=productKey(item),owner=claims.get(key)?.owner;return !!key&&(!owner||owner===surface);}
    function filter(items,surface){return (items||[]).filter(item=>allowed(item,surface));}
    function claim(items,surface){const accepted=filter(items,surface);for(const item of accepted){const key=productKey(item);claims.set(key,{key,owner:surface,category:categoryKey(item),at:now()});}save();return accepted;}
    function partition(items,surface){
      prune();const unique=new Map();for(const item of items||[]){const key=productKey(item);if(key&&!unique.has(key))unique.set(key,item);}
      const counts={home:0,search:0},categories={home:new Map(),search:new Map()};
      const category=categoryKey;
      function count(owner,item){counts[owner]++;const cat=category(item);categories[owner].set(cat,(categories[owner].get(cat)||0)+1);}
      for(const[key,item]of unique){const owner=claims.get(key)?.owner;if(owner)count(owner,item);}
      for(const[key,item]of unique){if(claims.has(key))continue;const cat=category(item),home=categories.home.get(cat)||0,search=categories.search.get(cat)||0;
        const owner=unique.size===1?surface:home!==search?(home<search?'home':'search'):counts.home!==counts.search?(counts.home<counts.search?'home':'search'):(hash(seed+key)%2?'home':'search');
        claims.set(key,{key,owner,category:category(item),at:now()});count(owner,item);
      }
      save();return filter(items,surface);
    }
    function repeatWindow(surface){prune();const count=[...claims.values()].filter(x=>x.owner===surface&&x.key.startsWith('target:')).length;return count?Math.min(20,Math.max(1,count-1)):20;}
    function categoryWindow(surface){prune();const categories=new Set([...claims.values()].filter(x=>x.owner===surface&&x.key.startsWith('target:')).map(x=>x.category||'other'));return categories.size?Math.min(9,Math.max(1,categories.size*2-1)):9;}
    return {allowed,filter,claim,partition,repeatWindow,categoryWindow,key:productKey,invalidate(){scopeKey='';},version:VERSION};
  }
  const api={create,key:productKey,version:VERSION};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root.document){let storage;try{storage=root.localStorage;}catch(_){}
    root.wishwaveDiscoverySurfaces=create({storage,visit:String(Date.now())+':'+Math.random(),scope:()=>root.wishwaveRecommendationAccount?.()||root.getAccountProfile?.()?.email||'guest'});
    root.addEventListener('storage',()=>root.wishwaveDiscoverySurfaces.invalidate());
    root.document.addEventListener('wishwave-recommendation-account-change',()=>root.wishwaveDiscoverySurfaces.invalidate());
  }
})(typeof globalThis!=='undefined'?globalThis:this);

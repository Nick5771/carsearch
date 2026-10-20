/* Timed proxy auctions. SQLite triggers serialize bids and settlement on the primary. */
(function(root){
'use strict';
const LIMIT=1000000000, DAY=86400000;
const increment=n=>n<100?5:n<500?25:n<2500?50:n<10000?100:n<25000?250:n<50000?500:n<100000?1000:n<250000?2500:n<500000?5000:10000;
const incSQL=n=>`CASE WHEN ${n}<100 THEN 5 WHEN ${n}<500 THEN 25 WHEN ${n}<2500 THEN 50 WHEN ${n}<10000 THEN 100 WHEN ${n}<25000 THEN 250 WHEN ${n}<50000 THEN 500 WHEN ${n}<100000 THEN 1000 WHEN ${n}<250000 THEN 2500 WHEN ${n}<500000 THEN 5000 ELSE 10000 END`;
const clock="CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER)";
const schema=[
`CREATE TABLE IF NOT EXISTS marketplace_auction_checkout_requests(order_id TEXT PRIMARY KEY,params_json TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS marketplace_auctions (listing_id TEXT PRIMARY KEY REFERENCES marketplace_listings(id), seller_email TEXT NOT NULL, start_minor INTEGER NOT NULL CHECK(start_minor BETWEEN 1 AND ${LIMIT}), current_minor INTEGER NOT NULL CHECK(current_minor BETWEEN 1 AND ${LIMIT}), ends_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','awaiting_payment','paid','unsold','unpaid','cancelled')), leader_email TEXT, bid_count INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, payment_due_at INTEGER, closed_at INTEGER, created_at INTEGER NOT NULL,payment_mode TEXT NOT NULL DEFAULT 'test' CHECK(payment_mode IN ('test','live')))`,
`CREATE INDEX IF NOT EXISTS idx_auctions_deadline ON marketplace_auctions(state,ends_at)`,
`CREATE TABLE IF NOT EXISTS marketplace_auction_bids (sequence INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL REFERENCES marketplace_auctions(listing_id), bidder_email TEXT NOT NULL, max_minor INTEGER NOT NULL CHECK(typeof(max_minor)='integer' AND max_minor BETWEEN 1 AND ${LIMIT}), request_id TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (${clock}), UNIQUE(listing_id,bidder_email,request_id))`,
`CREATE TABLE IF NOT EXISTS marketplace_auction_maxima (listing_id TEXT NOT NULL, bidder_email TEXT NOT NULL, max_minor INTEGER NOT NULL, priority INTEGER NOT NULL, PRIMARY KEY(listing_id,bidder_email))`,
`CREATE INDEX IF NOT EXISTS idx_auction_rank ON marketplace_auction_maxima(listing_id,max_minor DESC,priority)`,
`CREATE TABLE IF NOT EXISTS marketplace_auction_events (id TEXT PRIMARY KEY,listing_id TEXT NOT NULL,user_email TEXT NOT NULL,event_type TEXT NOT NULL,amount_minor INTEGER NOT NULL,created_at INTEGER NOT NULL,delivered_at INTEGER)`,
`CREATE TRIGGER IF NOT EXISTS ww_auction_bid_guard BEFORE INSERT ON marketplace_auction_bids BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM marketplace_auctions a JOIN marketplace_listings l ON l.id=a.listing_id WHERE a.listing_id=NEW.listing_id AND a.state='active' AND a.ends_at>${clock} AND l.status='active' AND l.quantity=1) THEN RAISE(ABORT,'AUCTION_ENDED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM marketplace_auctions WHERE listing_id=NEW.listing_id AND seller_email=NEW.bidder_email COLLATE NOCASE) THEN RAISE(ABORT,'OWN_AUCTION') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM marketplace_auction_maxima WHERE listing_id=NEW.listing_id AND bidder_email=NEW.bidder_email AND max_minor>=NEW.max_minor) THEN RAISE(ABORT,'MAXIMUM_MUST_INCREASE') END;
 SELECT CASE WHEN NEW.max_minor<(SELECT CASE WHEN bid_count=0 THEN start_minor WHEN leader_email=NEW.bidder_email THEN current_minor ELSE current_minor+${incSQL('current_minor')} END FROM marketplace_auctions WHERE listing_id=NEW.listing_id) THEN RAISE(ABORT,'BID_TOO_LOW') END;
END`,
`CREATE TRIGGER IF NOT EXISTS ww_auction_bid_apply AFTER INSERT ON marketplace_auction_bids BEGIN
 INSERT INTO marketplace_auction_maxima(listing_id,bidder_email,max_minor,priority) VALUES(NEW.listing_id,NEW.bidder_email,NEW.max_minor,NEW.sequence) ON CONFLICT(listing_id,bidder_email) DO UPDATE SET max_minor=excluded.max_minor,priority=excluded.priority;
 INSERT INTO marketplace_auction_events(id,listing_id,user_email,event_type,amount_minor,created_at) SELECT 'outbid:'||NEW.sequence,listing_id,leader_email,'auction_outbid',current_minor,${clock} FROM marketplace_auctions WHERE listing_id=NEW.listing_id AND leader_email IS NOT NULL AND leader_email!=(SELECT bidder_email FROM marketplace_auction_maxima WHERE listing_id=NEW.listing_id ORDER BY max_minor DESC,priority LIMIT 1);
 UPDATE marketplace_auctions SET leader_email=(SELECT bidder_email FROM marketplace_auction_maxima WHERE listing_id=NEW.listing_id ORDER BY max_minor DESC,priority LIMIT 1),bid_count=bid_count+1,revision=revision+1,
 current_minor=MAX(current_minor,MIN((SELECT max_minor FROM marketplace_auction_maxima WHERE listing_id=NEW.listing_id ORDER BY max_minor DESC,priority LIMIT 1),COALESCE((SELECT max_minor+${incSQL('max_minor')} FROM marketplace_auction_maxima WHERE listing_id=NEW.listing_id ORDER BY max_minor DESC,priority LIMIT 1 OFFSET 1),start_minor))) WHERE listing_id=NEW.listing_id;
 UPDATE marketplace_listings SET item_price_minor=(SELECT current_minor FROM marketplace_auctions WHERE listing_id=NEW.listing_id),auction_bid_count=(SELECT bid_count FROM marketplace_auctions WHERE listing_id=NEW.listing_id),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.listing_id;
END`,
`CREATE TRIGGER IF NOT EXISTS ww_auction_closed AFTER UPDATE OF state ON marketplace_auctions WHEN OLD.state='active' AND NEW.state IN ('awaiting_payment','unsold') BEGIN
 UPDATE marketplace_listings SET status=CASE WHEN NEW.state='awaiting_payment' THEN 'reserved' ELSE 'ended' END,reserved_order_id=CASE WHEN NEW.state='awaiting_payment' THEN 'auction:'||NEW.listing_id ELSE NULL END,reserved_until=CASE WHEN NEW.state='awaiting_payment' THEN strftime('%Y-%m-%dT%H:%M:%fZ',NEW.payment_due_at/1000.0,'unixepoch') ELSE NULL END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.listing_id;
 INSERT OR IGNORE INTO marketplace_auction_events VALUES('closed:seller:'||NEW.listing_id,NEW.listing_id,NEW.seller_email,CASE WHEN NEW.state='unsold' THEN 'auction_unsold' ELSE 'auction_sold' END,NEW.current_minor,${clock},NULL);
 INSERT OR IGNORE INTO marketplace_auction_events SELECT 'closed:winner:'||NEW.listing_id,NEW.listing_id,NEW.leader_email,'auction_won',NEW.current_minor,${clock},NULL WHERE NEW.leader_email IS NOT NULL;
END`,
`CREATE TRIGGER IF NOT EXISTS ww_auction_listing_guard BEFORE UPDATE ON marketplace_listings WHEN EXISTS(SELECT 1 FROM marketplace_auctions WHERE listing_id=OLD.id) BEGIN
 SELECT CASE WHEN NEW.title!=OLD.title OR COALESCE(NEW.description,'')!=COALESCE(OLD.description,'') OR NEW.currency!=OLD.currency OR NEW.category IS NOT OLD.category OR NEW.condition_label IS NOT OLD.condition_label OR NEW.shipping_carrier IS NOT OLD.shipping_carrier OR NEW.shipping_service IS NOT OLD.shipping_service OR NEW.offers_enabled!=OLD.offers_enabled OR (NEW.quantity!=OLD.quantity AND NOT(NEW.quantity=0 AND EXISTS(SELECT 1 FROM marketplace_auctions WHERE listing_id=OLD.id AND state='paid'))) OR NEW.shipping_minor!=OLD.shipping_minor OR NEW.shipping_mode!=OLD.shipping_mode OR NEW.seller_id!=OLD.seller_id OR NEW.image_urls_json!=OLD.image_urls_json OR COALESCE(NEW.delivery_mode,'')!=COALESCE(OLD.delivery_mode,'') OR COALESCE(NEW.pickup_area,'')!=COALESCE(OLD.pickup_area,'') OR NEW.auction_ends_at!=OLD.auction_ends_at OR NEW.listing_type!=OLD.listing_type OR NEW.item_price_minor!=(SELECT current_minor FROM marketplace_auctions WHERE listing_id=OLD.id) THEN RAISE(ABORT,'AUCTION_TERMS_LOCKED') END;
 SELECT CASE WHEN NEW.status!=OLD.status AND NOT EXISTS(SELECT 1 FROM marketplace_auctions WHERE listing_id=OLD.id AND ((state='awaiting_payment' AND NEW.status='reserved') OR (state='paid' AND NEW.status='sold') OR (state IN ('unsold','unpaid','cancelled') AND NEW.status='ended'))) THEN RAISE(ABORT,'AUCTION_STATUS_LOCKED') END;
END`
];
const ready=new WeakMap();
async function ensure(env){
 if(!env.DB)return;
 if(!ready.has(env.DB))ready.set(env.DB,(async()=>{
  const cols=new Set((await env.DB.prepare('PRAGMA table_info(marketplace_listings)').all()).results.map(x=>x.name));
  for(const [name,type]of [['listing_type',"TEXT NOT NULL DEFAULT 'fixed'"],['auction_ends_at','INTEGER'],['auction_bid_count','INTEGER NOT NULL DEFAULT 0']])if(!cols.has(name)){try{await env.DB.prepare(`ALTER TABLE marketplace_listings ADD COLUMN ${name} ${type}`).run();}catch(e){if(!String(e).includes('duplicate column'))throw e;}}
  for(const sql of schema)await env.DB.prepare(sql).run();
 })().catch(e=>{ready.delete(env.DB);throw e;}));
 await ready.get(env.DB);
}
async function closeDue(env,id){
 await env.DB.prepare(`UPDATE marketplace_auctions SET state=CASE WHEN leader_email IS NULL THEN 'unsold' ELSE 'awaiting_payment' END,closed_at=ends_at,payment_due_at=CASE WHEN leader_email IS NOT NULL THEN ends_at+${4*DAY} ELSE NULL END,revision=revision+1 WHERE state='active' AND ends_at<=${clock}${id?' AND listing_id=?':''}`).bind(...(id?[id]:[])).run();
}
async function get(env,id,email=''){
 const a=await env.DB.prepare('SELECT * FROM marketplace_auctions WHERE listing_id=?').bind(id).first();if(!a)return null;
 const mine=email?await env.DB.prepare('SELECT max_minor FROM marketplace_auction_maxima WHERE listing_id=? AND bidder_email=?').bind(id,email.toLowerCase()).first():null;
 const seller=a.seller_email===email.toLowerCase(),leader=!!email&&a.leader_email===email.toLowerCase();
 return {listingId:id,state:a.state,startingPriceMinor:a.start_minor,currentPriceMinor:a.current_minor,bidCount:a.bid_count,endsAt:a.ends_at,serverTime:Date.now(),revision:a.revision,paymentDueAt:a.payment_due_at,testMode:a.payment_mode==='test',isSeller:seller,isLeading:leader,myMaximumMinor:mine?.max_minor??null,minimumBidMinor:a.bid_count? a.current_minor+increment(a.current_minor):a.start_minor,canPay:leader&&a.state==='awaiting_payment'&&Date.now()<a.payment_due_at};
}
async function notify(env,d){
 const rows=(await env.DB.prepare('SELECT e.*,l.title,l.currency,l.image_urls_json FROM marketplace_auction_events e JOIN marketplace_listings l ON l.id=e.listing_id WHERE e.delivered_at IS NULL ORDER BY e.created_at LIMIT 40').all()).results;
 for(const e of rows){const titles={auction_outbid:'You’ve been outbid',auction_won:'You won the auction',auction_sold:'Your auction has a winner',auction_unsold:'Your auction ended without bids',auction_unpaid:'Auction payment deadline passed'};
 await d.notify(env,e.user_email,{idempotencyKey:e.id,type:e.event_type,title:titles[e.event_type]||'Auction update',body:e.title+(e.event_type==='auction_won'?' · Complete payment within 4 days.':''),url:d.publicUrl(e.listing_id),entityId:e.listing_id,imageUrl:JSON.parse(e.image_urls_json||'[]')[0]||''});
 await env.DB.prepare(`UPDATE marketplace_auction_events SET delivered_at=${clock} WHERE id=?`).bind(e.id).run();}
}
async function maintenance(env,d){
 if(!env.DB)return;await d.ensure(env);await closeDue(env);
 // Recover a lost Stripe response with the exact persisted parameters/key.
 const pending=(await env.DB.prepare("SELECT o.id,r.params_json FROM marketplace_orders o JOIN marketplace_auction_checkout_requests r ON r.order_id=o.id JOIN marketplace_auctions a ON a.listing_id=o.listing_id WHERE o.checkout_session_id IS NULL AND a.payment_mode=? AND o.created_at>? LIMIT 20").bind(d.isTest(env)?'test':'live',new Date(Date.now()-23*3600000).toISOString()).all()).results;
 for(const row of pending){try{const session=await d.stripePost(env,'/checkout/sessions',JSON.parse(row.params_json),'auction-checkout-'+row.id);await env.DB.prepare('UPDATE marketplace_orders SET checkout_session_id=? WHERE id=? AND checkout_session_id IS NULL').bind(session.id,row.id).run();}catch(e){console.error('auction checkout recovery',row.id);}}

 // Expire any open Stripe checkout first. Never release inventory on a blind timer.
 const rows=(await env.DB.prepare("SELECT a.*,l.reserved_order_id,o.checkout_session_id,o.status AS order_status FROM marketplace_auctions a JOIN marketplace_listings l ON l.id=a.listing_id LEFT JOIN marketplace_orders o ON o.id=l.reserved_order_id WHERE a.state='awaiting_payment' AND a.payment_mode=? AND a.payment_due_at<=? LIMIT 40").bind(d.isTest(env)?'test':'live',Date.now()).all()).results;
 for(const a of rows){if(a.reserved_order_id&&a.reserved_order_id!=='auction:'+a.listing_id&&!a.checkout_session_id)continue;if(a.checkout_session_id){const session=await d.stripeGet(env,'/checkout/sessions/'+encodeURIComponent(a.checkout_session_id));if(session.payment_status==='paid'||session.status==='complete')continue;if(session.status==='open')await d.stripePost(env,'/checkout/sessions/'+encodeURIComponent(a.checkout_session_id)+'/expire',{},'expire-auction-'+a.listing_id);}
 await env.DB.batch([
 env.DB.prepare(`UPDATE marketplace_auctions SET state='unpaid',revision=revision+1 WHERE listing_id=? AND state='awaiting_payment' AND payment_due_at<=${clock}`).bind(a.listing_id),
 env.DB.prepare("UPDATE marketplace_listings SET status='ended',reserved_order_id=NULL,reserved_until=NULL WHERE id=? AND EXISTS(SELECT 1 FROM marketplace_auctions WHERE listing_id=? AND state='unpaid')").bind(a.listing_id,a.listing_id),
 env.DB.prepare("UPDATE marketplace_orders SET status='cancelled_unpaid' WHERE id=? AND status IN ('pending_payment','payment_failed')").bind(a.reserved_order_id||''),
 env.DB.prepare(`INSERT OR IGNORE INTO marketplace_auction_events SELECT 'unpaid:'||listing_id,listing_id,seller_email,'auction_unpaid',current_minor,${clock},NULL FROM marketplace_auctions WHERE listing_id=? AND state='unpaid'`).bind(a.listing_id)
 ]);}
 await notify(env,d);
}
async function route(request,env,ctx,d){
 const url=new URL(request.url),match=url.pathname.match(/^\/marketplace\/auctions\/([^/]+)(?:\/(bids))?$/),mine=url.pathname==='/marketplace/me/auctions';
 if(!match&&!mine)return null;
 const response=(data,status=200)=>d.json(data,status,{'Cache-Control':'no-store'});
 const auth=await d.auth(request,env);if(auth.fail)return auth.fail;
 if(!env.DB)return response({error:'Database unavailable'},503);
 try{await d.ensure(env);if(mine){if(request.method!=='GET')return response({error:'Method not allowed'},405);await closeDue(env);const rows=(await env.DB.prepare('SELECT DISTINCT a.listing_id,l.title,l.image_urls_json,l.currency FROM marketplace_auctions a JOIN marketplace_listings l ON l.id=a.listing_id LEFT JOIN marketplace_auction_maxima m ON m.listing_id=a.listing_id WHERE a.seller_email=? OR m.bidder_email=? ORDER BY a.ends_at DESC LIMIT 100').bind(auth.email,auth.email).all()).results;return response({auctions:await Promise.all(rows.map(async x=>({...x,...await get(env,x.listing_id,auth.email)})))});}
 const id=decodeURIComponent(match[1]);await closeDue(env,id);
 const existing=await get(env,id,auth.email);if(!existing)return response({error:'Auction not found'},404);
 if(!match[2]&&request.method==='GET')return response({auction:existing});
 if(!match[2]||request.method!=='POST')return response({error:'Method not allowed'},405);
 if(existing.testMode!==d.isTest(env))return response({error:'This auction belongs to a different payment environment'},409);
 if(!d.config(env).checkoutEnabled)return response({error:'Auction bidding is unavailable until checkout is enabled'},503);
 if(await d.rate(env,request,'auction-bid',40,60))return response({error:'Too many bids. Try again shortly.'},429);
 const body=await request.json().catch(()=>({})),max=body.maximumMinor,key=String(request.headers.get('Idempotency-Key')||body.requestId||'');
 if(!Number.isSafeInteger(max)||max<1||max>LIMIT||!/^[-a-zA-Z0-9_]{8,100}$/.test(key)||body.confirmed!==true)return response({error:'Confirm a valid maximum bid and provide a request ID'},400);
 const replay=await env.DB.prepare('SELECT max_minor FROM marketplace_auction_bids WHERE listing_id=? AND bidder_email=? AND request_id=?').bind(id,auth.email,key).first();
 if(replay){if(replay.max_minor!==max)return response({error:'Request ID was already used for another bid'},409);return response({ok:true,replayed:true,auction:await get(env,id,auth.email)});}
 const row=await env.DB.prepare('SELECT a.seller_email,s.status,s.stripe_charges_enabled FROM marketplace_auctions a JOIN marketplace_listings l ON l.id=a.listing_id JOIN marketplace_sellers s ON s.id=l.seller_id WHERE a.listing_id=?').bind(id).first();
 if(row.status!=='approved'||!row.stripe_charges_enabled)return response({error:'Seller cannot accept payments'},409);
 if(await d.blocked(env,auth.email,row.seller_email))return response({error:'You cannot bid on this auction'},403);
 try{await env.DB.prepare('INSERT INTO marketplace_auction_bids(listing_id,bidder_email,max_minor,request_id) VALUES(?,?,?,?)').bind(id,auth.email,max,key).run();}catch(e){if(String(e).includes('UNIQUE constraint')){const same=await env.DB.prepare('SELECT max_minor FROM marketplace_auction_bids WHERE listing_id=? AND bidder_email=? AND request_id=?').bind(id,auth.email,key).first();if(!same||same.max_minor!==max)throw e;}else throw e;}
 ctx.waitUntil(notify(env,d).catch(e=>console.error('auction notifications',e)));
 return response({ok:true,auction:await get(env,id,auth.email)},201);
 }catch(e){const msg=String(e.message||e),codes={AUCTION_ENDED:'This auction has ended',OWN_AUCTION:'You cannot bid on your own auction',MAXIMUM_MUST_INCREASE:'Your new maximum must exceed your previous maximum',BID_TOO_LOW:'The price changed. Increase your maximum and try again.'};const code=Object.keys(codes).find(x=>msg.includes(x));if(code)return response({error:codes[code],code},409);return response({error:'Auction request failed. Please retry.'},500);}
}
const api={increment,incSQL,schema,ensure,closeDue,get,notify,maintenance,route};root.WishWaveAuctions=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);

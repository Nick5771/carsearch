const assert=require('assert'),fs=require('fs'),{spawnSync}=require('child_process');
const engine=require('../wishwave-auctions-engine.js');
assert.deepEqual([99,100,499,500,2499,2500,9999,10000,24999,25000,49999,50000,99999,100000,249999,250000,499999,500000].map(engine.increment),[5,25,25,50,50,100,100,250,250,500,500,1000,1000,2500,2500,5000,5000,10000]);
const code=String.raw`
import sqlite3,json,sys,time,threading,tempfile,os
schema=json.load(sys.stdin)
f=tempfile.NamedTemporaryFile(delete=False);f.close()
def connect():
 c=sqlite3.connect(f.name,timeout=15,isolation_level=None);c.execute('PRAGMA foreign_keys=ON');return c
c=connect()
c.execute('CREATE TABLE marketplace_listings(id TEXT PRIMARY KEY,seller_id TEXT,title TEXT,description TEXT,currency TEXT,item_price_minor INTEGER,shipping_minor INTEGER,shipping_mode TEXT,image_urls_json TEXT,delivery_mode TEXT,pickup_area TEXT,quantity INTEGER,status TEXT,listing_type TEXT,auction_ends_at INTEGER,auction_bid_count INTEGER,updated_at TEXT,reserved_order_id TEXT,reserved_until TEXT,category TEXT,condition_label TEXT,shipping_carrier TEXT,shipping_service TEXT,offers_enabled INTEGER)')
for sql in schema:c.execute(sql)
def auction(id='one',start=1000,end=None):
 now=int(time.time()*1000);end=end or now+60000
 c.execute('INSERT INTO marketplace_listings(id,seller_id,title,description,currency,item_price_minor,shipping_minor,shipping_mode,image_urls_json,delivery_mode,pickup_area,quantity,status,listing_type,auction_ends_at,auction_bid_count,updated_at,reserved_order_id,reserved_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(id,'seller','Camera','Film camera','USD',start,500,'flat','[]','shipping','',1,'active','auction',end,0,'',None,None))
 c.execute('INSERT INTO marketplace_auctions(listing_id,seller_email,start_minor,current_minor,ends_at,created_at) VALUES(?,?,?,?,?,?)',(id,'seller@test',start,start,end,now))
def bid(who,maximum,key,id='one',db=None):
 (db or c).execute('INSERT INTO marketplace_auction_bids(listing_id,bidder_email,max_minor,request_id) VALUES(?,?,?,?)',(id,who,maximum,key))
def state(id='one'):return c.execute('SELECT leader_email,current_minor,bid_count,state FROM marketplace_auctions WHERE listing_id=?',(id,)).fetchone()
def reject(fn,code):
 try:fn();raise AssertionError('Expected '+code)
 except sqlite3.IntegrityError as e:assert code in str(e),(code,str(e))
auction();bid('alice@test',10000,'alice-first');assert state()==('alice@test',1000,1,'active')
bid('bob@test',5000,'bob-first');assert state()[:3]==('alice@test',5100,2)
bid('alice@test',15000,'raise');assert state()[:3]==('alice@test',5100,3),'raising own max must not bid against yourself'
bid('bob@test',15000,'tie');assert state()[:3]==('alice@test',15000,4),'earlier equal max wins'
reject(lambda:bid('seller@test',100000,'own'),'OWN_AUCTION')
reject(lambda:bid('carol@test',15001,'low'),'BID_TOO_LOW')
reject(lambda:bid('alice@test',15000,'same'),'MAXIMUM_MUST_INCREASE')
assert state()[2]==4,'rejected bids roll back all writes'
bid('carol@test',15250,'newleader');assert state()[:2]==('carol@test',15250),'winner can pay less than a full increment over runner'
assert c.execute("SELECT count(*) FROM marketplace_auction_events WHERE event_type='auction_outbid'").fetchone()[0]==1
reject(lambda:c.execute("UPDATE marketplace_listings SET title='Changed' WHERE id='one'"),'AUCTION_TERMS_LOCKED')
reject(lambda:c.execute("UPDATE marketplace_listings SET status='removed' WHERE id='one'"),'AUCTION_STATUS_LOCKED')
# End exactly at authoritative DB time, then repeated closing is idempotent.
c.execute("UPDATE marketplace_auctions SET ends_at=0 WHERE listing_id='one'")
reject(lambda:bid('dan@test',100000,'late'),'AUCTION_ENDED')
close="UPDATE marketplace_auctions SET state=CASE WHEN leader_email IS NULL THEN 'unsold' ELSE 'awaiting_payment' END,closed_at=ends_at,payment_due_at=ends_at+345600000 WHERE state='active' AND ends_at<=CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER)"
c.execute(close);c.execute(close)
assert state()[3]=='awaiting_payment'
assert c.execute("SELECT status,reserved_order_id FROM marketplace_listings WHERE id='one'").fetchone()==('reserved','auction:one')
assert c.execute("SELECT count(*) FROM marketplace_auction_events WHERE id LIKE 'closed:%'").fetchone()[0]==2
auction('empty',end=1);c.execute(close);assert state('empty')[3]=='unsold'
assert c.execute("SELECT status FROM marketplace_listings WHERE id='empty'").fetchone()[0]=='ended'
# Real simultaneous writers, unique maxima and stable price. No JS read/compute/write window.
auction('race');barrier=threading.Barrier(12);errors=[]
def compete(i):
 d=connect()
 try:barrier.wait();bid('bidder'+str(i)+'@test',100000+i*10000,'race-'+str(i),'race',d)
 except Exception as e:
  if 'BID_TOO_LOW' not in str(e):errors.append(str(e))
 finally:d.close()
threads=[threading.Thread(target=compete,args=(i,)) for i in range(12)]
for t in threads:t.start()
for t in threads:t.join()
assert not errors,errors
assert state('race')[0]=='bidder11@test',state('race')
assert state('race')[1]<=210000 and state('race')[2]>=1
# Duplicate retry doesn't mutate state, including concurrent duplicate inserts.
before=state('race')
reject(lambda:bid('bidder11@test',210000,'race-11','race'),'MAXIMUM_MUST_INCREASE')
assert state('race')==before
# Corrupt money rejected by DB even if an API validation is bypassed.
reject(lambda:bid('eve@test',1.5,'fraction','race'),'BID_TOO_LOW')
c.close();os.unlink(f.name)
print('PASS: proxy increments, private maximum ranking, own raises, ties, insufficient bids, ownership, exact deadlines, immutable terms, one-time settlement, no bids, rollback and 12 concurrent SQLite writers')
`;
const result=spawnSync('python3',['-c',code],{input:JSON.stringify(engine.schema),encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'SQLite auction tests');

import importlib.util,sqlite3,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('evaluate',Path(__file__).resolve().parents[1]/'scripts/evaluate-shopping-trials.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
db=sqlite3.connect(':memory:');db.execute('CREATE TABLE recommendation_trials(viewer_key TEXT,event_id TEXT,exposure_id TEXT,listing_key TEXT,event TEXT,arm TEXT,surface TEXT,policy TEXT,created_at INTEGER)');now=int(time.time()*1000)
def add(viewer,event_id,exposure,event,arm,at,key='product',surface='home'):db.execute('INSERT INTO recommendation_trials VALUES(?,?,?,?,?,?,?,?,?)',(viewer,event_id,exposure,key,event,arm,surface,'shopping-v228',at))
for arm in ('control','treatment'):
 for i in range(4):
  v=arm+str(i);add(v,v+'a',v,'impression',arm,now-2*86400000)
  if arm=='treatment':add(v,v+'b',v,'like',arm,now-2*86400000+100)
add('orphan','orphan','none','click','treatment',now-86400000);add('fresh','fresh','fresh','impression','treatment',now)
add('control0','invalid','control0','click','control',now-2*86400000+1,key='wrong-product');add('treatment0','undo','treatment0','unlike','treatment',now-2*86400000+101)
r=module.evaluate(db,now=now,bootstrap=100);assert r['control']['matured_exposures']==4;assert r['treatment']['matured_exposures']==4;assert r['treatment']['save_rate']==.75;assert r['control']['product_visit_rate']==0;assert r['treatment_minus_control']['save_rate']['difference']==.75
print('PASS: matured exposure denominator, outcome attribution, orphan/fresh exclusion, unlike reversal and viewer bootstrap')

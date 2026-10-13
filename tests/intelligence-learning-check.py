import importlib.util,sqlite3,time,datetime
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,root/'scripts'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load('train_intelligence','train-shopping-intelligence.py');rows=[]
for i in range(4000):
 values=[0.]*len(m.FEATURES);values[5]=1 if i%2 else -1
 rows.append({'viewer':'viewer'+str(i%400),'at':i*1000,'values':values,'labels':{'save':int(i%2),'visit':int(i%2),'relevance':None,'purchase_kept':None}})
model=m.train(rows);assert model['mode']=='shadow';assert model['heads']['save']['weights'][6]>0;assert 'relevance' in model['declined'];assert 'purchase_kept' in model['declined'];assert model['heads']['save']['evaluation']['auc']>.9
try:m.train(rows[:50]);raise AssertionError('insufficient data accepted')
except ValueError:pass
r=load('retention','evaluate-shopping-retention.py');db=sqlite3.connect(':memory:');db.execute('CREATE TABLE recommendation_visits(viewer_key TEXT,day TEXT,arm TEXT,policy TEXT)');db.executemany('INSERT INTO recommendation_visits VALUES(?,?,?,?)',[('a','2026-10-01','control','shopping-v230'),('a','2026-10-02','control','shopping-v230'),('a','2026-10-08','control','shopping-v230'),('b','2026-10-12','treatment','shopping-v230')]);result=r.evaluate(db,datetime.date(2026,10,13));assert result['control']['D7']['rate']==1;assert result['treatment']['D7']['eligible_viewers']==0
print('PASS: separate outcome heads, future/held-out-viewer evaluation, learned semantic direction, missing-label and insufficient-data rejection, shadow-only output and matured retention cohorts')

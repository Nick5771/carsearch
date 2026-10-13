#!/usr/bin/env python3
"""Train shadow-only outcome heads from a real D1 SQLite export.
Usage: python scripts/train-shopping-intelligence.py export.sqlite model.json
Nothing is uploaded or activated. Missing satisfaction/purchase labels stay
missing. Future evaluation also holds out viewers to limit repeated-user leakage.
"""
import argparse,hashlib,importlib.util,json,math,sqlite3,time
from pathlib import Path
FEATURES=('topicBoost','preferenceBoost','repeatPenalty','sharedBoost','confidence','semanticMatch','collaborativeBoost','missionBuy','missionGift','missionCollect','missionBrowse','catalogueFit','catalogueCoverage')
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('train-recommendation-ranker.py'));base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

def examples(db,now=None):
 now=int(now or time.time()*1000);db.row_factory=sqlite3.Row
 events=db.execute("SELECT * FROM recommendation_trials WHERE policy='shopping-v230' AND surface='home' ORDER BY occurred_at,event_id").fetchall()
 grouped={}
 for e in events:grouped.setdefault((e['viewer_key'],e['exposure_id']),[]).append(e)
 orders={}
 try:
  for row in db.execute('SELECT * FROM recommendation_verified_orders WHERE exposure_id IS NOT NULL'):orders.setdefault((row['viewer_key'],row['exposure_id']),[]).append(row)
 except sqlite3.OperationalError:pass
 rows=[]
 for key,group in grouped.items():
  exposure=next((x for x in group if x['event']=='impression'),None)
  if not exposure or exposure['occurred_at']>now-86400000:continue
  features=json.loads(exposure['features'])
  if not all(isinstance(features.get(k),(int,float)) and math.isfinite(features[k]) for k in FEATURES):continue
  outcomes=sorted((x for x in group if x['listing_key']==exposure['listing_key'] and x['arm']==exposure['arm'] and exposure['occurred_at']<=x['occurred_at']<=exposure['occurred_at']+86400000),key=lambda x:(x['occurred_at'],int(x['event_id'].rsplit('_',1)[-1]) if x['event_id'].rsplit('_',1)[-1].isdigit() else 0))
  likes=[x for x in outcomes if x['event'] in ('like','unlike')];feedback=[x for x in outcomes if x['event'] in ('relevancePositive','relevanceNegative')]
  labels={'save':int((likes and likes[-1]['event']=='like') or any(x['event']=='track' for x in outcomes)),'visit':int(any(x['event']=='click' for x in outcomes)),'relevance':int(feedback[-1]['event']=='relevancePositive') if feedback else None,'purchase_kept':None}
  if exposure['listing_key'].startswith('findai:') and exposure['occurred_at']<=now-21*86400000:
   verified=[o for o in orders.get(key,[]) if exposure['occurred_at']<=o['paid_at']<=exposure['occurred_at']+7*86400000]
   labels['purchase_kept']=int(any(o['state']=='paid' and o['paid_at']<=now-14*86400000 for o in verified))
  rows.append({'viewer':key[0],'at':exposure['occurred_at'],'values':[max(-2,min(2,features[k])) for k in FEATURES],'labels':labels})
 return sorted(rows,key=lambda x:x['at'])

def heldout(viewer):return int(hashlib.sha256(viewer.encode()).hexdigest()[:8],16)%5==0

def fit(rows,target):
 labelled=[r for r in rows if r['labels'][target] is not None]
 if len(labelled)<500:raise ValueError('Need at least 500 matured labelled exposures')
 boundary=labelled[int(len(labelled)*.8)]['at'];train=[r for r in labelled if r['at']<boundary and not heldout(r['viewer'])];test=[r for r in labelled if r['at']>=boundary and heldout(r['viewer'])]
 if len(train)<300 or len(test)<100 or len({r['viewer'] for r in train})<50 or len({r['viewer'] for r in test})<10:raise ValueError('Insufficient future/held-out-viewer coverage')
 for dataset in (train,test):
  positives=sum(r['labels'][target] for r in dataset)
  if min(positives,len(dataset)-positives)<20:raise ValueError('Need at least 20 positive and 20 negative outcomes in each split')
 weights=[0.]*(len(FEATURES)+1)
 for _ in range(350):
  gradient=[0.]*len(weights)
  for r in train:
   error=base.probability(weights,r['values'])-r['labels'][target]
   for i,x in enumerate([1.]+r['values']):gradient[i]+=error*x
  for i in range(len(weights)):weights[i]-=.15*(gradient[i]/len(train)+(.01*weights[i] if i else 0))
 labels=[r['labels'][target] for r in test];predicted=[base.probability(weights,r['values']) for r in test];baseline=[r['values'][0]+r['values'][1] for r in test]
 learned=base.auc(labels,predicted);baseline_auc=base.auc(labels,baseline);loss=-sum(y*math.log(max(1e-8,p))+(1-y)*math.log(max(1e-8,1-p)) for y,p in zip(labels,predicted))/len(labels)
 return {'weights':weights,'training_examples':len(train),'evaluation_examples':len(test),'training_viewers':len({r['viewer'] for r in train}),'evaluation_viewers':len({r['viewer'] for r in test}),'evaluation':{'auc':learned,'baseline_auc':baseline_auc,'log_loss':loss},'eligible_for_experiment':learned>baseline_auc+.01}

def train(rows):
 heads={};declined={}
 for target in ('save','visit','relevance','purchase_kept'):
  try:heads[target]=fit(rows,target)
  except ValueError as error:declined[target]=str(error)
 if not heads:raise ValueError('No model produced: '+json.dumps(declined))
 return {'policy':'shopping-v230','version':'shadow-'+str(int(time.time())),'mode':'shadow','features':list(FEATURES),'heads':heads,'declined':declined,'activation':'Requires a controlled real-user experiment; offline metrics do not activate ranking','purchase_label':'Verified native purchase without observed refund/dispute after 14 days; not lifetime satisfaction'}

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('database',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
 db=sqlite3.connect(f'file:{args.database.resolve()}?mode=ro',uri=True)
 try:model=train(examples(db))
 except ValueError as error:parser.exit(2,str(error)+'\n')
 args.output.write_text(json.dumps(model,indent=2)+'\n');print('Saved shadow model. Live ranking was not changed.')

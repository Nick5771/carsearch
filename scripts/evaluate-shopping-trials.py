#!/usr/bin/env python3
"""Evaluate a local SQLite export of recommendation_trials; no deployment changes.
Use: python scripts/evaluate-shopping-trials.py export.sqlite --bootstrap 1000
The bootstrap resamples viewers, not individual exposures. Outcomes mature for
24h, and must reference a matching, earlier qualified exposure on the same surface.
"""
import argparse,json,random,sqlite3,time
from collections import defaultdict

def evaluate(db,now=None,bootstrap=1000,policy='shopping-v228'):
    now=int(now or time.time()*1000)
    db.row_factory=sqlite3.Row
    events=db.execute("SELECT * FROM recommendation_trials WHERE policy=?",(policy,)).fetchall()
    def event_time(row):return row['occurred_at'] if 'occurred_at' in row.keys() else row['created_at']
    events.sort(key=lambda row:(event_time(row),int(row['event_id'].rsplit('_',1)[-1]) if row['event_id'].rsplit('_',1)[-1].isdigit() else 0,row['event_id']))
    exposures={};actions=defaultdict(list)
    for row in events:
        key=(row['viewer_key'],row['exposure_id'])
        if row['event']=='impression':
            if row['surface']=='home' and event_time(row)<=now-86400000:
                exposures.setdefault(key,row)
        else:actions[key].append(row)
    viewers={'control':defaultdict(lambda:[0,0,0,0]),'treatment':defaultdict(lambda:[0,0,0,0])}
    for key,row in exposures.items():
        arm=row['arm']
        if arm not in viewers:continue
        valid=[a for a in actions[key] if a['arm']==arm and a['listing_key']==row['listing_key'] and a['surface']==row['surface'] and event_time(row)<=event_time(a)<=event_time(row)+86400000]
        latest_like=next((a['event'] for a in reversed(valid) if a['event'] in ('like','unlike')),None)
        saved=latest_like=='like' or any(a['event']=='track' for a in valid)
        clicked=any(a['event']=='click' for a in valid)
        rejected=any(a['event']=='notInterested' for a in valid)
        bucket=viewers[arm][row['viewer_key']]
        for i,value in enumerate((1,int(saved),int(clicked),int(rejected))):bucket[i]+=value
    names=('save_rate','product_visit_rate','rejection_rate');report={}
    for arm,people in viewers.items():
        total=[sum(v[i] for v in people.values()) for i in range(4)]
        report[arm]={'viewers':len(people),'matured_exposures':total[0],**{name:total[i+1]/total[0] if total[0] else None for i,name in enumerate(names)}}
    rng=random.Random(228)
    if all(viewers[arm] for arm in viewers):
        deltas={name:[] for name in names}
        for _ in range(max(0,bootstrap)):
            rates={}
            for arm,people in viewers.items():
                rows=list(people.values());sample=[rng.choice(rows) for _ in rows];sums=[sum(v[i] for v in sample) for i in range(4)]
                rates[arm]=[sums[i]/sums[0] for i in range(1,4)]
            for i,name in enumerate(names):deltas[name].append(rates['treatment'][i]-rates['control'][i])
        report['treatment_minus_control']={}
        for name,values in deltas.items():
            values.sort();report['treatment_minus_control'][name]={'difference':report['treatment'][name]-report['control'][name],'viewer_bootstrap_95pct':([values[int(.025*(len(values)-1))],values[int(.975*(len(values)-1))]] if values else None)}
    report['interpretation']='Descriptive evidence; check assignment, delivery, inventory and position balance. A small sample or repeated peeking does not establish improvement. Clicks are not purchases. No automatic rollout.'
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('database');parser.add_argument('--bootstrap',type=int,default=1000);parser.add_argument('--policy',choices=['shopping-v228','shopping-v229','shopping-v230'],default='shopping-v230');args=parser.parse_args()
    with sqlite3.connect(args.database) as db:print(json.dumps(evaluate(db,bootstrap=args.bootstrap,policy=args.policy),indent=2))

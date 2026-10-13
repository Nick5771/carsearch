#!/usr/bin/env python3
"""Descriptive D1/D7 return rates from a SQLite recommendation_visits export."""
import argparse,datetime,json,sqlite3
from collections import defaultdict

def evaluate(db,today=None):
 today=today or datetime.datetime.now(datetime.timezone.utc).date();people=defaultdict(set);arms={}
 for viewer,day,arm in db.execute("SELECT viewer_key,day,arm FROM recommendation_visits WHERE policy='shopping-v230' ORDER BY day"):
  people[viewer].add(datetime.date.fromisoformat(day));arms.setdefault(viewer,arm)
 result={}
 for arm in ('control','treatment'):
  result[arm]={}
  for gap in (1,7):
   cohort=[dates for viewer,dates in people.items() if arms[viewer]==arm and min(dates)+datetime.timedelta(days=gap)<=today]
   returned=sum(min(dates)+datetime.timedelta(days=gap) in dates for dates in cohort)
   result[arm]['D'+str(gap)]={'eligible_viewers':len(cohort),'returned':returned,'rate':returned/len(cohort) if cohort else None}
 result['note']='UTC day buckets, exact-day returns, stable account/browser identity. Clear storage and guest-to-account changes can split identities. These rates alone do not prove causal lift.'
 return result
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('database');args=parser.parse_args()
 with sqlite3.connect(f'file:{args.database}?mode=ro',uri=True) as db:print(json.dumps(evaluate(db),indent=2))

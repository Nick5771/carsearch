"""Build editorial sourcing targets; this never creates inventory or prices."""
import argparse, json, re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('catalogue', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
audit_path = root / 'data/treasure-pilot-supply-audit.json'
audit = json.loads(audit_path.read_text()) if audit_path.exists() else {'results': []}
audit_by_id = {x['id']: x for x in audit['results']}
targets = []
category = ''
for line in args.catalogue.read_text().splitlines():
    if line.startswith('## '):
        category = re.sub(r' \(\d+\)$', '', line[3:])
    match = re.match(r'^- \*\*(FF\d{3}) — (.+?)\*\* — (.+)$', line)
    if not match:
        continue
    item_id, title, rule = match.groups()
    target = {'id': item_id, 'title': title, 'category': category,
                    'query': re.sub(r'\s+', ' ', title.replace(' — ', ' ')).strip()[:160],
                    'matchingNotes': rule, 'status': 'pending_supply_audit',
                    'rarityVerified': False, 'inventory': None}
    if item_id in audit_by_id:
        evidence = audit_by_id[item_id]
        target.update(query=evidence['query'],status=evidence['status'],
                      supplyAuditAt=evidence['checkedAt'],authenticationVerified=False)
    targets.append(target)
assert len(targets) == len({x['id'] for x in targets}) == 500
payload = {'version': 'treasure-v3', 'market': 'US', 'kind': 'editorial_sourcing_targets',
           'inventoryCreated': False, 'targets': sorted(targets, key=lambda x:x['id'])}
(root / 'data').mkdir(exist_ok=True)
(root / 'data/treasure-hunt-catalogue-v3.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False)+'\n')
print('500 unique editorial targets generated; no inventory created')

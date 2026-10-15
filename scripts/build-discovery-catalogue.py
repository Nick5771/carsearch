"""Compile the reviewed workbook export into conservative discovery queries.

Rows are sourcing targets, never inventory or authentication evidence. Keep
unresolved formats/identities out of retrieval. Existing hand-written pilot
variant rules take precedence over generated exact-query terms.
"""
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
rows = json.loads((ROOT / 'data/discovery-catalogue-v270.json').read_text())['targets']
policy = ROOT / 'findai-treasure-pilot.js'
source = policy.read_text()
start = source.index(' // BEGIN GENERATED CATALOGUE') if ' // BEGIN GENERATED CATALOGUE' in source else source.index(' function norm(')
end = source.index(' function norm(', start)
stop = set('a an the and or for with of in to by original authentic authenticity complete working tested used new vintage sealed near mint adult mens womens size full official genuine release edition set per caption no better raw documented'.split())

def normal(value):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', value).encode('ascii','ignore').decode().lower()).strip()

generated = []
for row in rows:
    if row['hold']:
        continue
    tokens = list(dict.fromkeys(t for t in normal(row['query']).split() if t not in stop))
    if len(tokens) < 2:
        continue
    generated.append(dict(id=row['id'], category=row['category'], query=row['query'],
                          terms=[[t] for t in tokens], reject=['bootleg','replica','empty box','accessory only','digital download'],
                          catalogueCandidate=True, authenticationVerified=False))
block = ' // BEGIN GENERATED CATALOGUE — scripts/build-discovery-catalogue.py\n'
block += ' const expandedTargets=' + json.dumps(generated, ensure_ascii=False, separators=(',', ':')) + ';\n'
block += " const pilotIds=new Set(targets.map(x=>x.id));for(const target of expandedTargets)if(!pilotIds.has(target.id))targets.push(target);\n"
block += ' // END GENERATED CATALOGUE\n'
source = source[:start] + block + source[end:]
source = source.replace("function norm(v){return String(v||'').toLowerCase()", "function norm(v){return String(v||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase()")
source = re.sub(r' const observedIds=new Set\(\[.*?\]\);', ' const observedIds=new Set(targets.map(x=>x.id));', source)
source = source.replace("version:'treasure-pilot-v240.3'", "version:'discovery-catalogue-v270'")
policy.write_text(source)
print(f'{len(rows)} candidates compiled; {len(generated)} resolved query candidates plus hand-written pilot overrides')

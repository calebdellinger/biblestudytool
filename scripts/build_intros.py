"""Book and section introductions (original text written for Margin) -> app/public/data/intro.json.
Run: python scripts/build_intros.py   then   node scripts/build_intros_refs.mjs  (resolves key verses)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'intros'))
from sections import SECTIONS
import ot_law_history, ot_wisdom_prophets, nt
root = os.path.dirname(HERE)
books = {b['id']: b for b in json.load(open(os.path.join(root, 'app/public/data/books.json')))}
allb = ot_law_history.BOOKS + ot_wisdom_prophets.BOOKS + nt.BOOKS
ids = [b['id'] for b in allb]
assert sorted(ids) == list(range(1, 67)), sorted(set(range(1, 67)) - set(ids))
errors = []
def pos(x):
    if isinstance(x, int): return (x, None)
    c, v = x.split(':'); return (int(c), int(v))
out = []
for b in sorted(allb, key=lambda b: b['id']):
    bk = books[b['id']]; n = len(bk['verses'])
    sec = next(s['id'] for s in SECTIONS if s['first'] <= b['id'] <= s['last'])
    ol = []
    for label, a, z in b['outline']:
        (c1, v1), (c2, v2) = pos(a), pos(z)
        if not (1 <= c1 <= c2 <= n): errors.append(f"{bk['name']}: outline {label} {a}-{z} (has {n})")
        if v2 and v2 > bk['verses'][c2 - 1]: errors.append(f"{bk['name']}: verse {z} too high")
        ol.append([label, c1, v1 or 1, c2, v2 or bk['verses'][c2 - 1]])
    if ol and (ol[0][1] != 1 or ol[-1][3] != n): errors.append(f"{bk['name']}: outline doesn't cover 1..{n}")
    for k in ('summary', 'fits', 'author', 'date', 'to', 'kind', 'means'):
        if not b.get(k): errors.append(f"{bk['name']}: missing {k}")
    out.append({k: v for k, v in dict(
        id=b['id'], section=sec, means=b['means'], kind=b['kind'], author=b['author'], authorMeans=b.get('author_means'),
        authorNote=b.get('author_note'), date=b['date'], to=b['to'], covers=b.get('covers'), summary=b['summary'],
        themes=b['themes'], key=b['key'], outline=ol, fits=b['fits']).items() if v is not None})
if errors: print('\n'.join(errors)); sys.exit(1)
json.dump({'sections': SECTIONS, 'books': out}, open(os.path.join(root, 'app/public/data/intro.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
words = sum(len((b['summary'] + ' ' + b['fits']).split()) for b in out)
print('ok', len(out), 'books', words, 'words in summaries')

# Gemini marked Deuteronomy's inner quotes as nested in Moses' speech, but the BSB leaves most of
# Moses' discourse unquoted, so those quotes are top-level. Un-nest any line that sits inside a top-level quote.
import json, sys
sys.path.insert(0, '.')
import speak

text, segs = speak.segments(5)
src, dst = sys.argv[1], sys.argv[2]
out, fixed = [], 0
for l in open(src, encoding='utf8'):
    l = l.strip()
    if not l.startswith('{'):
        out.append(l); continue
    r = json.loads(l)
    if r.get('nested_in'):
        c, v = map(int, r['ref'].split()[1].split(':'))
        verse = text[c - 1][v - 1]
        i = verse.find(r['text'])
        top = [(s, e) for (vv, s, e) in segs.get(c, []) if vv == v]
        if i >= 0 and any(s <= i <= s + 2 and i + len(r['text']) <= e for s, e in top):
            r['nested_in'] = None; fixed += 1
    out.append(json.dumps(r, ensure_ascii=False))
open(dst, 'w', encoding='utf8').write('\n'.join(out) + '\n')
print('fixed', fixed)

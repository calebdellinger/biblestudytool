#!/usr/bin/env python3
"""Claude's own "who's speaking" tagging, cheaper than retyping the words.
  speak.py show <book id> <c1> [c2]     chapter text with each top-level quotation numbered ⟦n⟧ (long ones shortened)
  speak.py apply <book id> <file>       turn an assignment file into Gemini-format JSONL (stdout)
Assignment file:  "@ id=Name; id2=Name 2"  lines, then "c: 1-3 id; 4 id2; 5 -" per chapter ("-" = leave uncoloured).
Quotation text is cut from the Bible text itself, so it always matches."""
import json, re, sys, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BOOKS = json.load(open(os.path.join(ROOT, 'app/public/data/books.json')))

def segments(bid):
    text = json.load(open(os.path.join(ROOT, f'app/public/data/bible/BSB/{bid}.json')))
    out = {}  # c -> list of (v, start, end)
    for ci, ch in enumerate(text, 1):
        depth = 0; segs = []
        for vi, verse in enumerate(ch, 1):
            start = 0 if depth > 0 else None
            for i, k in enumerate(verse):
                if k == '“':
                    if depth == 0: start = i + 1
                    depth += 1
                elif k == '”' and depth > 0:
                    depth -= 1
                    if depth == 0 and start is not None:
                        if verse[start:i].strip(): segs.append((vi, start, i))
                        start = None
            if depth > 0 and start is not None and verse[start:].strip():
                segs.append((vi, start, len(verse)))
        # a quotation never closed at chapter end just ends there
        out[ci] = segs
    return text, out

def show(bid, c1, c2):
    text, segs = segments(bid)
    for c in range(c1, c2 + 1):
        print(f'=== {c}')
        by_v = {}
        for n, (v, s, e) in enumerate(segs.get(c, []), 1): by_v.setdefault(v, []).append((n, s, e))
        keep = {v for v in by_v} | {v + 1 for v in by_v} | {v - 1 for v in by_v}
        skipped = False
        for vi, verse in enumerate(text[c - 1], 1):
            if vi not in keep:
                if not skipped: print('…'); skipped = True
                continue
            skipped = False
            parts, at = [], 0
            for n, s, e in by_v.get(vi, []):
                q = verse[s:e]
                if len(q) > 90: q = q[:70] + '…' + q[-12:]
                parts.append(verse[at:s]); parts.append(f'⟦{n}⟧{q}⟦/⟧'); at = e
            parts.append(verse[at:])
            print(f'{vi} ' + ''.join(parts))

def outline(bid, c1, c2):
    """Compact view: only where a quotation begins after narration; continuing speech is collapsed."""
    text, segs = segments(bid)
    for c in range(c1, c2 + 1):
        cs = segs.get(c, [])
        if not cs: continue
        out, run = [], None
        for n, (v, s, e) in enumerate(cs, 1):
            verse = text[c - 1][v - 1]
            lead = verse[:s].rstrip('“ ')
            prev_end = cs[n - 2][2] if n > 1 and cs[n - 2][0] == v else 0
            between = verse[prev_end:s].strip('“” ,')
            if s == 0:
                run = (run[0], n, v) if run else (n, n, v)
                continue
            if run: out.append(f'  ⟦{run[0]}-{run[1]}⟧ cont. to v{run[2]}'); run = None
            ctx = between[-110:] if between else ('[prev] ' + text[c - 1][v - 2][-90:] if v > 1 else '')
            out.append(f'  ⟦{n}⟧ v{v} {ctx} “{verse[s:e][:50]}…')
        if run: out.append(f'  ⟦{run[0]}-{run[1]}⟧ cont. to v{run[2]}')
        print(f'=== {c} ({len(cs)})'); print('\n'.join(out))

def apply(bid, path):
    book = BOOKS[bid - 1]; code = book['osis'].upper()
    text, segs = segments(bid)
    names, lines = {}, []
    for raw in open(path):
        raw = raw.strip()
        if not raw or raw.startswith('#'): continue
        if raw.startswith('@'):
            for pair in raw[1:].split(';'):
                if '=' in pair: k, v = pair.split('=', 1); names[k.strip()] = v.strip()
            continue
        c, rest = raw.split(':', 1); c = int(c)
        cs = segs.get(c, [])
        seen = set()
        for item in rest.split(';'):
            item = item.strip()
            if not item: continue
            rng, sp = item.rsplit(' ', 1)
            a, _, b = rng.partition('-')
            hi = int(b or a)
            if hi > len(cs) and int(a) <= len(cs) and b: hi = len(cs)  # "5-999 id" = to the end of the chapter
            for n in range(int(a), hi + 1):
                if n < 1 or n > len(cs): print(f'# {code} {c}: no segment {n}', file=sys.stderr); continue
                seen.add(n)
                if sp == '-': continue
                v, s, e = cs[n - 1]
                verse = text[c - 1][v - 1]
                q = verse[s:e]
                # same words twice in a verse: say which one
                occ = [m.start() for m in re.finditer(re.escape(q), verse)]
                r = {'ref': f'{code} {c}:{v}', 'speaker': sp, 'text': q, 'tag': None, 'to': None, 'nested_in': None, 'confidence': 'high'}
                if sp in names: r['name'] = names[sp]
                if len(occ) > 1: r['occurrence'] = occ.index(s) + 1
                # naming words: the speaker's name (or the LORD for god) in the narration just before the quotation
                nm = {'god': 'the LORD', 'jesus': 'Jesus'}.get(sp, names.get(sp, '').split(' (')[0])
                if nm:
                    before = verse[:s]
                    for cand in (nm, nm.split(' ')[0], nm.replace('The ', 'the ')):
                        if len(cand) > 2 and cand in before and cand not in q: r['tag'] = cand; break
                lines.append(r)
        missing = [n for n in range(1, len(cs) + 1) if n not in seen]
        if missing: print(f'# {code} {c}: not assigned {missing}', file=sys.stderr)
    for r in lines: print(json.dumps(r, ensure_ascii=False))

if __name__ == '__main__':
    cmd, bid = sys.argv[1], int(sys.argv[2])
    if cmd == 'outline': outline(bid, int(sys.argv[3]), int(sys.argv[4] if len(sys.argv) > 4 else sys.argv[3]))
    elif cmd == 'show': show(bid, int(sys.argv[3]), int(sys.argv[4] if len(sys.argv) > 4 else sys.argv[3]))
    else: apply(bid, sys.argv[3])

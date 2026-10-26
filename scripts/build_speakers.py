"""Who's speaking, for the BSB: turns Gemini's JSON Lines (data/speakers/<BOOK>.jsonl) into character ranges.

Each line names a verse, the speaker, the exact words spoken and the words that name the speaker ("tag").
Every line is checked against the app's BSB text: the words must be found in that verse. Lines that
don't match are reported and left out. Speeches quoted inside another speech ("nested_in") are left to
the outer speaker, and "low" confidence lines are skipped, so a wrong guess never gets a colour.

Output: app/public/data/speakers/BSB/<bookId>.json
  { "<chapter>": { "people": [[id, name], ...],            # in order of first appearance in the chapter
                   "v": { "<verse>": [[start, end, person index, 0 = words | 1 = name], ...] } } }
plus app/public/data/speakers/BSB/index.json listing the books that have data.
Usage: python scripts/build_speakers.py
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
books = json.load(open(os.path.join(ROOT, 'app/public/data/books.json')))
by_code = {b['osis'].upper(): b for b in books}
by_code.update({'JOS': by_code['JOSH'], 'GEN': by_code['GEN'], 'JHN': by_code['JOHN'], 'JON': by_code['JONAH'], 'RUT': by_code['RUTH']})
PRONOUNS = {'he', 'she', 'they', 'you', 'we', 'i', 'him', 'her', 'them'}

def norm(s):
    return s.replace('‘', "'").replace('’', "'").replace('“', '"').replace('”', '"').replace('—', '-').replace('–', '-')

def find(text, needle, occurrence=1, near=None):
    """Exact search, then one that ignores quote/dash styles; returns (start, end) or None."""
    for hay, ndl in ((text, needle), (norm(text), norm(needle))):
        hits = [m.start() for m in re.finditer(re.escape(ndl), hay)] if ndl else []
        if hits:
            if near is not None:  # the naming words closest before the speech, else the closest after it
                before = [h for h in hits if h <= near]
                h = before[-1] if before else hits[0]
            else:
                h = hits[min(occurrence, len(hits)) - 1]
            return h, h + len(ndl)
    return None

def main():
    out_dir = os.path.join(ROOT, 'app/public/data/speakers/BSB')
    os.makedirs(out_dir, exist_ok=True)
    index, problems, total, kept = [], [], 0, 0
    for path in sorted(glob.glob(os.path.join(ROOT, 'data/speakers/*.jsonl'))):
        rows = []
        for i, line in enumerate(open(path, encoding='utf-8'), 1):
            line = line.strip()
            if not line.startswith('{'): continue
            try: r = json.loads(line)
            except json.JSONDecodeError as e: problems.append(f'{os.path.basename(path)}:{i} not valid JSON ({e})'); continue
            if 'continue_from' in r: continue
            rows.append((i, r))
        if not rows: continue
        code = rows[0][1]['ref'].split()[0].upper()
        book = by_code.get(code)
        if not book: problems.append(f'{path}: unknown book code {code}'); continue
        text = json.load(open(os.path.join(ROOT, f"app/public/data/bible/BSB/{book['id']}.json")))
        names, chapters = {}, {}
        for i, r in rows:
            total += 1
            try:
                c, v = map(int, r['ref'].split()[1].split(':'))
                verse = text[c - 1][v - 1]
            except Exception:
                problems.append(f"{code} line {i}: bad reference {r.get('ref')}"); continue
            sid = r.get('speaker')
            if r.get('name'): names.setdefault(sid, r['name'])
            if r.get('nested_in') or r.get('confidence') == 'low': continue
            span = find(verse, r.get('text', ''), r.get('occurrence', 1))
            if not span:
                problems.append(f"{r['ref']}: words not found in the BSB verse: {r.get('text', '')[:70]!r}"); continue
            ch = chapters.setdefault(c, {'people': [], 'v': {}})
            if sid not in ch['people']: ch['people'].append(sid)
            k = ch['people'].index(sid)
            ch['v'].setdefault(str(v), []).append([span[0], span[1], k, 0])
            tag = r.get('tag')
            if tag:
                t = find(verse, tag, near=span[0])
                if t and not (t[0] < span[1] and span[0] < t[1]):
                    ch['v'][str(v)].append([t[0], t[1], k, 1])
                elif not t:
                    problems.append(f"{r['ref']}: naming words not found: {tag!r}")
            kept += 1
        out = {}
        for c, ch in sorted(chapters.items()):
            people = [[sid, names.get(sid) or sid.replace('-', ' ').title()] for sid in ch['people']]
            vs = {v: sorted({tuple(s) for s in spans}) for v, spans in ch['v'].items()}
            out[str(c)] = {'people': people, 'v': {v: [list(s) for s in spans] for v, spans in vs.items()}}
        json.dump(out, open(os.path.join(out_dir, f"{book['id']}.json"), 'w'), ensure_ascii=False, separators=(',', ':'))
        index.append(book['id'])
    json.dump(sorted(index), open(os.path.join(out_dir, 'index.json'), 'w'))
    print(f'{kept} of {total} lines used; books: {sorted(index)}')
    for p in problems: print('  !', p)

if __name__ == '__main__':
    main()

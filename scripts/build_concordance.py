# Every occurrence of every Hebrew and Greek word, for the word-study page.
# Reads app/public/data/orig/words/<book>.json (STEPBible TAHOT/TAGNT, CC BY 4.0) and writes
# app/public/data/orig/conc/<bucket>.json, bucketed like the lexicon (H26 = H2600–H2699):
#   { "H2617A": { "f": [forms…], "g": [glosses…], "o": [[verseId, formIndex, glossIndex], …] } }
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..', 'app', 'public', 'data', 'orig')
OUT = os.path.join(ROOT, 'conc')

def norm(s):
    m = re.search(r'([HG])(\d+)([A-Za-z]?)', s)
    return f'{m[1]}{m[2].zfill(4)}{m[3].upper()}' if m else s

def main_of(strongs):
    m = re.search(r'\{([HG]\d+[A-Za-z]?)\}', strongs) or re.search(r'([HG]\d+[A-Za-z]?)', strongs)
    return norm(m[1]) if m else ''

def clean_gloss(g):
    g = re.sub(r'\[[^\]]*\]', '', g)          # editorial additions: "[the] covenant loyalty of"
    g = g.replace('<', '').replace('>', '')
    g = re.sub(r'[.,;:!?·]+$', '', g.strip())
    g = re.sub(r'\s+', ' ', g).strip()
    g = re.sub(r'^(?:of|the|and|to|in|for|from|with|by) ', '', g)   # small connecting words the Hebrew carries elsewhere
    return re.sub(r' of$', '', g)

entries = defaultdict(lambda: {'f': [], 'g': [], 'o': [], '_f': {}, '_g': {}})
for b in range(1, 67):
    words = json.load(open(os.path.join(ROOT, 'words', f'{b}.json'), encoding='utf8'))
    for cv, ws in words.items():
        c, v = map(int, cv.split(':'))
        vid = b * 1_000_000 + c * 1000 + v
        for text, _tr, gloss, strongs, _morph in ws:
            strongs = strongs.split('\\')[0]
            s = main_of(strongs)
            if not s:
                continue
            parts, gparts, tparts = strongs.split('/'), gloss.split('/'), text.split('\\')[0].split('/')
            i = next((k for k, p in enumerate(parts) if '{' in p), 0)
            g = clean_gloss(gparts[i] if i < len(gparts) else gloss) or clean_gloss(gloss)
            form = tparts[i] if b <= 39 and i < len(tparts) else text.split('\\')[0].replace('/', '')
            form = re.sub(r'[\s.,;:·\u0387¶!?“”‘’"\'()\[\]׃־]+$', '', form.strip()) or form
            e = entries[s]
            fi = e['_f'].setdefault(form, len(e['f']))
            if fi == len(e['f']): e['f'].append(form)
            gi = e['_g'].setdefault(g.lower(), len(e['g']))   # "Love" and "love" are one rendering
            if gi == len(e['g']): e['g'].append(g)
            o = e['o']
            if o and o[-1][0] == vid and o[-1][1] == fi and o[-1][2] == gi:
                continue  # same word twice in a verse with the same form: list the verse once
            o.append([vid, fi, gi])

buckets = defaultdict(dict)
for s, e in entries.items():
    buckets[s[0] + str(int(s[1:5]) // 100)][s] = {'f': e['f'], 'g': e['g'], 'o': e['o']}
os.makedirs(OUT, exist_ok=True)
total = 0
for k, d in buckets.items():
    p = os.path.join(OUT, f'{k}.json')
    with open(p, 'w', encoding='utf8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    total += os.path.getsize(p)
print(f'{len(entries)} words, {sum(len(e["o"]) for e in entries.values())} occurrences, {len(buckets)} files, {total / 1e6:.1f} MB')

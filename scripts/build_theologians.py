"""Andrew Murray, E. M. Bounds and D. L. Moody from Project Gutenberg (public domain) -> app/public/data/theologians/.

Usage: python scripts/build_theologians.py <folder of Gutenberg HTML files named <id>.html>
Then:  node scripts/build_theologians_refs.mjs   (finds every Bible reference and indexes it by verse)

Each book is split into chapters at its most common heading level; running headers and contents pages are dropped;
old-style references ("John xv. 7", "Ps. cxix. 105") are rewritten as "John 15:7" so they can be linked.
"""
import json, os, re, sys
from collections import Counter
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app/public/data/theologians')

AUTHORS = [
    dict(id='murray', name='Andrew Murray', years='1828–1917',
         about='South African pastor of the Dutch Reformed Church and one of the most loved devotional writers of his age. He wrote over 240 books, most of them on prayer, abiding in Christ, humility and the Holy Spirit.'),
    dict(id='bounds', name='E. M. Bounds', years='1835–1913',
         about='American Methodist minister and Civil War chaplain who spent his later years rising at four in the morning to pray. His books on prayer, most published after his death, are still among the most read on the subject.'),
    dict(id='moody', name='D. L. Moody', years='1837–1899',
         about='American evangelist who preached to millions in Britain and America, and founded the Moody Bible Institute and the Northfield schools. His sermons are plain, warm and full of Scripture and stories.'),
]
WORKS = [  # (Gutenberg id, author, title)
    (26709, 'murray', 'Lord, Teach Us to Pray'), (57121, 'murray', 'Humility'),
    (29296, 'murray', 'The Ministry of Intercession'), (12854, 'murray', "The Master's Indwelling"),
    (26990, 'murray', 'Holy in Christ'), (26003, 'murray', "'Jesus Himself'"), (41994, 'murray', 'Money'),
    (65115, 'bounds', 'Power Through Prayer'), (66112, 'bounds', 'Purpose in Prayer'), (73271, 'bounds', 'The Essentials of Prayer'),
    (73032, 'bounds', 'The Reality of Prayer'), (70657, 'bounds', 'Prayer and Praying Men'),
    (30449, 'moody', 'The Way to God'), (33341, 'moody', 'Secret Power'), (61883, 'moody', 'Prevailing Prayer'),
    (36655, 'moody', 'Pleasure and Profit in Bible Study'), (30657, 'moody', 'Sovereign Grace'), (30740, 'moody', 'Men of the Bible'),
    (30768, 'moody', 'Sowing and Reaping'), (33340, 'moody', 'Weighed and Wanting'), (33015, 'moody', 'The Overcoming Life'),
    (33520, 'moody', 'Wondrous Love'), (33014, 'moody', 'To the Work! To the Work!'), (27316, 'moody', 'The Blessed Hope'),
]
BOOKS = r'(?:Gen|Exod?|Lev|Num|Deut|Josh|Judg|Ruth|(?:[12I]{1,2}\.? )?(?:Sam|Kings?|Chron|Cor|Thess|Tim|Pet|John)|Ezra|Neh|Esth|Job|Psa?l?m?s?|Ps|Prov|Eccl?e?s?|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt?h?e?w?|Mark|Luke|John|Acts|Rom|Gal|Eph|Phil|Col|Tit|Philem|Heb|Jas|James|Jude|Rev)[a-z]*'
ROMAN = re.compile(r'\b(' + BOOKS + r')\.?\s+([ivxlc]+)\.\s*(\d+)', re.I)
LEVEL = {'Holy in Christ': 3}  # books whose chapter headings sit below a running head

def roman(s):
    v, total = {'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100}, 0
    s = s.lower()
    for i, ch in enumerate(s):
        n = v[ch]; total += -n if i + 1 < len(s) and v[s[i + 1]] > n else n
    return total
def modern_refs(t):
    return ROMAN.sub(lambda m: f'{m.group(1)} {roman(m.group(2))}:{m.group(3)}', t)

def inline(el):
    """Paragraph HTML -> markdown-ish text keeping italics."""
    out = []
    for n in el.descendants:
        if isinstance(n, NavigableString):
            if n.parent.name in ('script', 'style'): continue
            par = n.parent
            txt = str(n)
            if any(p.name in ('i', 'em') for p in n.parents if isinstance(p, Tag) and p is not el and p in el.descendants):
                if txt.strip(): txt = f'*{txt.strip()}* ' if txt.endswith(' ') else f'*{txt.strip()}*'
            out.append(txt)
        elif n.name == 'br':
            out.append(' ')
    t = re.sub(r'\s+', ' ', ''.join(out)).strip()
    t = re.sub(r'\*\s*\*', '', t)
    return modern_refs(t)

def blocks_of(path):
    soup = BeautifulSoup(open(path, encoding='utf-8'), 'html.parser')
    for sel in ['#pg-header', '#pg-footer', 'section.pg-boilerplate', '.pg-boilerplate', 'header.pg-boilerplate']:
        for x in soup.select(sel): x.decompose()
    for x in soup.find_all(['table', 'img', 'script', 'style']): x.decompose()
    blocks = []
    for el in soup.body.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote']):
        if el.find_parent(['blockquote']) and el.name == 'p': continue
        if el.name == 'p' and el.find_parent(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']): continue
        text = re.sub(r'\[p?[ivxlc\d]+\]\s*', '', inline(el), flags=re.I)
        if not text or text.startswith('*** '): continue
        if el.name.startswith('h'):
            h = re.sub(r'\[p?[ivxlc\d]+\]\s*', '', re.sub(r'\*', '', text), flags=re.I)
            h = re.sub(r'\s*Contents\.?$', '', h).strip()
            if h: blocks.append(('h', int(el.name[1]), h))
        else: blocks.append(('q' if el.name == 'blockquote' else 'p', 0, text))
    return blocks

def chapters_of(blocks, title):
    norm = lambda t: re.sub(r'[^a-z]', '', t.lower())
    heads = Counter(norm(t) for k, _, t in blocks if k == 'h')
    blocks = [b for b in blocks if b[0] != 'h' or heads[norm(b[2])] < 3 or re.fullmatch(r'(chapter)?[ivxlc\d]*', norm(b[2]))]
    counts = Counter(lv for k, lv, _ in blocks if k == 'h')
    if not counts: return [('', [b for b in blocks])]
    # Chapters are the highest heading level that occurs at least three times (lower levels become sub-headings).
    common = [lv for lv, c in counts.items() if c >= 3]
    lvl = LEVEL.get(title) or (min(common) if common else max(counts, key=lambda lv: counts[lv]))
    repeated = {t for t, c in Counter(t for k, _, t in blocks if k == 'p').items() if c >= 3 and len(t) < 90}
    chs, cur_title, cur, i = [], None, [], 0
    while i < len(blocks):
        k, lv, t = blocks[i]
        if k == 'h' and lv <= lvl:
            if cur_title is not None or cur: chs.append((cur_title or '', cur))
            parts = [t]; i += 1
            while i < len(blocks) and blocks[i][0] == 'h' and blocks[i][1] >= lvl and not re.match(r'contents', parts[-1], re.I): parts.append(blocks[i][2]); i += 1
            # "I." or "CHAPTER IV." followed by a short title line
            if re.fullmatch(r'(chapter\s+)?[ivxlc\d]+\.?', parts[-1].strip(), re.I) and i < len(blocks) and blocks[i][0] == 'p' and len(blocks[i][2]) < 90 and blocks[i][2] not in repeated:
                parts.append(blocks[i][2]); i += 1
            parts = [p for p in parts if p.strip().upper() not in ('OR', 'OR,') and not re.match(r'(by rev|copyright|philadelphia|new york|chicago|london)', p.strip(), re.I)]
            for j in range(len(parts) - 1, 0, -1):
                if re.match(r'chapter\b', parts[j], re.I): parts = parts[j:]; break
            cur_title, cur = ' · '.join(parts), []
            continue
        if k == 'p' and t in repeated: i += 1; continue
        cur.append(blocks[i]); i += 1
    if cur_title is not None or cur: chs.append((cur_title or '', cur))
    # Front matter: keep a preface only; drop title pages and contents.
    out = []
    for n, (t, body) in enumerate(chs):
        words = sum(len(b[2].split()) for b in body)
        if re.search(r'contents|index|catalogue', t, re.I) or words < 60: continue
        if n < 2 and norm(t) == norm(title) and words < 400: continue
        if n == 0 and not t: t = 'Introduction'
        if out and words < 250 and not re.search(r'preface|introduction|foreword', t, re.I):
            out[-1] = (out[-1][0], out[-1][1] + ([('h', 9, t)] if t else []) + body); continue
        out.append((t, body))
    return out

def tidy(title, n):
    t = re.sub(r'\s+', ' ', title.replace('*', '')).strip(' .:')
    parts = [x.strip(' .:—') for x in t.split(' · ')]
    numeral = lambda x: re.fullmatch(r'(chapter\s+)?([ivxlc]+|\d+)', x, re.I)
    words = [x for x in parts if x and not numeral(x)]
    if not words:
        m = numeral(parts[0]) if parts and parts[0] else None
        return f'Chapter {roman(m.group(2)) if m and not m.group(2).isdigit() else (m.group(2) if m else n)}'
    t = ' · '.join(words)
    t = re.sub(r'^(CHAPTER\s+)?([IVXLC]+|\d+)(\.|\s*—)\s*', '', t)
    t = re.sub(r'^CHAPTER\s+[IVXLC\d]+\.?\s*', '', t, flags=re.I)
    t = re.sub(r'^[IVXL]+\s*(?:\.\s*)?—\s*|^—\s*', '', t)
    t = re.sub(r'^[IVXL]+\s+(?=[A-Z][A-Z\W])', '', t)
    letters = [c for c in t if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) > 0.7 * len(letters): t = t.title()
    return re.sub(r"(['’])S\b", r'\1s', t)

def main(src):
    os.makedirs(OUT, exist_ok=True)
    authors = {a['id']: {**a, 'works': []} for a in AUTHORS}
    for gid, aid, title in WORKS:
        path = os.path.join(src, f'{gid}.html')
        if not os.path.exists(path): print('missing', gid, title); continue
        chs = chapters_of(blocks_of(path), title)
        wid = f'{aid}-{re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")}'
        wdir = os.path.join(OUT, 'works', wid)
        os.makedirs(wdir, exist_ok=True)
        toc = []
        for n, (t, body) in enumerate(chs, 1):
            md = []
            for k, lv, txt in body:
                if k == 'h': md.append(f'### {tidy(txt, 0)}')
                elif k == 'q': md.append('> ' + txt)
                else: md.append(txt.replace('\n', ' '))
            ct = tidy(t, n) or f'Chapter {n}'
            open(os.path.join(wdir, f'{n}.md'), 'w').write(f'## {ct}\n\n' + '\n\n'.join(md) + '\n')
            toc.append([n, ct, sum(len(b[2].split()) for b in body)])
        authors[aid]['works'].append({'id': wid, 'title': title, 'gutenberg': gid, 'chapters': toc})
        print(f'{title}: {len(toc)} chapters, {sum(c[2] for c in toc):,} words')
    json.dump({'authors': list(authors.values())}, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False)

if __name__ == '__main__':
    main(sys.argv[1])

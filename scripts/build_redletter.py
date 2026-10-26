"""Words of Jesus ("red letters") for the KJV and BSB, as character ranges in the app's verse text.

Sources (eBible.org, public domain): eng-kjv2006 USFM, which marks Jesus' words with \\wj ... \\wj*,
and engbsb USFM, which has no red-letter marks but has Strong's numbers and quotation marks.

KJV: the \\wj marks, mapped onto the app's KJV text.
BSB: the BSB's own quotation marks decide where speech starts and stops; the KJV decides who is
speaking. A quoted stretch of a BSB verse is red when the KJV marks Jesus' words in that verse and
the quoted words' Strong's numbers line up with those words (not the narrator's or someone else's).

Usage: python scripts/build_redletter.py <kjv usfm dir> <bsb usfm dir>
"""
import difflib, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = json.load(open(os.path.join(ROOT, 'app/public/data/books.json')))
CODES = ['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM',
         'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']

# Very common words (and, the, he, be, this, I, you…) say nothing about who is speaking.
COMMON = {'2532', '1161', '3588', '846', '1510', '2076', '3778', '1473', '4771', '3739', '1722', '1519', '3756', '3754', '1063', '235', '5100', '3956', '3004', '2036', '1537', '575', '4314', '1909', '3361', '5124', '3708', '1437', '3767'}

# The BSB capitalizes pronouns for God and Jesus, so 'He said' is Jesus and 'he said' is someone else.
VERB = r'(?:said|says|asked|asks|replied|answered|told|tells|declared|cried|called|added|continued|prayed|spoke|warned|commanded|shouted|saying|exclaimed)'
JESUS_SAYS = re.compile(rf'\b(?:Jesus|He|the Lord)\s+(?:\w+\s+){{0,8}}{VERB}\b|^\s*{VERB}\s+(?:Jesus|the Lord)\b')
OTHER_SAYS = re.compile(rf'\b(?:he|she|they|She|They|we|We|woman|man|men|Peter|Simon|Saul|Pilate|disciples|Jews|Pharisees|scribes|crowd|crowds|people|servant|officer|centurion|demons?|spirit|Thomas|Philip|Andrew|Nathanael|Judas|Martha|Mary|John|Nicodemus|devil|tempter|governor|priests?|Herod|others|someone|one of them)\s+(?:\w+\s+){{0,2}}{VERB}\b|^\s*{VERB}\s+(?:the woman|the man|Peter|Simon|Saul|Pilate|Thomas|Philip|Nathanael|Martha|Mary|Judas|Nicodemus|the Jews|the crowd|the people|the disciples|the officer|the servant|the governor|the high priest)\b')

def parse(path):
    """-> {(c, v): [(text, strong, wj)]} tokens, where untagged text has strong None."""
    raw = open(path, encoding='utf-8').read()
    raw = re.sub(r'\\f .*?\\f\*', '', raw, flags=re.S)
    raw = re.sub(r'\\x .*?\\x\*', '', raw, flags=re.S)
    lines = [l for l in raw.split('\n') if not re.match(r'\\(s\d?|r|ms\d?|mr|d|id|ide|h|toc\d|mt\d?|rem|sp|cl)\b', l.strip())]
    text = ' '.join(lines)
    out, c, v = {}, 0, 0
    for part in re.split(r'(\\c \d+|\\v \d+)', text):
        m = re.match(r'\\c (\d+)', part)
        if m: c = int(m.group(1)); continue
        m = re.match(r'\\v (\d+)', part)
        if m: v = int(m.group(1)); continue
        if not c or not v: continue
        toks, wj = [], False
        pos = 0
        for m in re.finditer(r'\\wj\*|\\wj\s|\\\+?w ([^|\\]*)\|strong="([^"]*)"\\\+?w\*|\\[a-z0-9+*]+\s?', part):
            if m.start() > pos: toks.append((part[pos:m.start()], None, wj))
            t = m.group(0)
            if t.startswith('\\wj*'): wj = False
            elif t.startswith('\\wj'): wj = True
            elif m.group(1) is not None: toks.append((m.group(1), m.group(2).split(',')[0].lstrip('GH0') , wj))
            pos = m.end()
        if pos < len(part): toks.append((part[pos:], None, wj))
        out.setdefault((c, v), []).extend(toks)
    return out

def plain(toks):
    """Join tokens into clean text, returning text and per-character token index."""
    s, idx = '', []
    for i, (t, _, _) in enumerate(toks):
        s += t; idx += [i] * len(t)
    # collapse whitespace, keeping the index aligned
    out, oidx, prev_space = '', [], True
    for ch, i in zip(s, idx):
        if ch.isspace():
            if prev_space: continue
            out += ' '; oidx.append(i); prev_space = True
        else:
            out += ch; oidx.append(i); prev_space = False
    while out.endswith(' '): out = out[:-1]; oidx.pop()
    return out, oidx

def mapper(src, dst):
    """Character offset map src -> dst."""
    sm = difflib.SequenceMatcher(None, src, dst, autojunk=False)
    m = [None] * (len(src) + 1)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): m[a + k] = b + k
    m[len(src)] = len(dst)
    last = 0
    for i in range(len(m)):
        if m[i] is None: m[i] = last
        else: last = m[i]
    return m

def ranges_from_flags(flags):
    out, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None: start = i
        if not f and start is not None: out.append([start, i]); start = None
    return out

def trim(text, rs):
    """Drop leading/trailing spaces from ranges and merge ones separated only by spaces."""
    out = []
    for a, b in rs:
        while a < b and text[a] == ' ': a += 1
        while b > a and text[b - 1] == ' ': b -= 1
        if b <= a: continue
        if out and text[out[-1][1]:a].strip() == '': out[-1][1] = b
        else: out.append([a, b])
    return out

def main(kdir, bdir):
    app = lambda tr, b: json.load(open(os.path.join(ROOT, f'app/public/data/bible/{tr}/{b}.json')))
    result = {'KJV': {}, 'BSB': {}}
    stats = dict(kjv=0, bsb=0, bsb_quotes=0)
    for n, code in enumerate(CODES):
        bid = 40 + n
        kf = glob.glob(os.path.join(kdir, f'*{code}*.usfm'))[0]
        bf = glob.glob(os.path.join(bdir, f'*{code}*.usfm'))[0]
        K, B = parse(kf), parse(bf)
        ka, ba = app('KJV', bid), app('BSB', bid)
        open_q = 0
        last_c = 0
        for (c, v), ktoks in sorted(K.items()):
            vid = bid * 1_000_000 + c * 1000 + v
            if not any(w for _, _, w in ktoks): continue
            # ---- KJV
            kt, kidx = plain(ktoks)
            atext = ka[c - 1][v - 1] if c <= len(ka) and v <= len(ka[c - 1]) else None
            if atext:
                flags = [ktoks[i][2] for i in kidx]
                m = mapper(kt, atext)
                rs = [[m[a], m[b]] for a, b in ranges_from_flags(flags)]
                rs = trim(atext, rs)
                if rs: result['KJV'][vid] = rs; stats['kjv'] += 1
        # ---- BSB: walk every verse in order to track open quotation marks across verses
        wj_by_v, wj_pos = {}, {}
        for (c, v), ktoks in K.items():
            wj = {s for _, s, w in ktoks if s and w}
            non = {s for _, s, w in ktoks if s and not w}
            words = [w for t, _, w in ktoks if t.strip()]
            share = sum(words) / len(words) if words else 0
            wj_by_v[(c, v)] = (wj, non, share)
            wj_pos[(c, v)] = [w for t, _, w in ktoks if t.strip() and any(ch.isalpha() for ch in t)]
        open_q = 0
        for (c, v), btoks in sorted(B.items()):
            if c != last_c: open_q = []; last_c = c
            bt, bidx = plain(btoks)
            wj, non, share = wj_by_v.get((c, v), (set(), set(), 0))
            # Split into quoted / unquoted stretches by double quotation marks. The BSB reopens a quotation at each
            # new paragraph of a long speech without closing the last one, so an opening mark always means "inside".
            # Nesting matters: Jesus' parables quote people (‘…’) who quote others (“…”), so keep a stack.
            open_before = bool(open_q)
            segs, start, stack = [], 0, list(open_q or [])
            for i, ch in enumerate(bt):
                was = bool(stack)
                if ch == '“':
                    if not stack or stack[-1] == '‘': stack.append('“')
                    # an opening mark with a quotation already open is a new paragraph of the same speech
                elif ch == '”':
                    while stack and stack.pop() != '“': pass
                elif ch == '‘':
                    stack.append('‘')
                elif ch == '’' and stack and stack[-1] == '‘' and not (i + 1 < len(bt) and bt[i + 1].isalpha()):
                    stack.pop()
                if not was and stack: segs.append((start, i, False)); start = i
                elif was and not stack: segs.append((start, i + 1, True)); start = i + 1
            segs.append((start, len(bt), bool(stack)))
            open_q = stack
            if not wj: continue
            kflags = wj_pos.get((c, v), [])
            red = [False] * len(bt)
            for a, b, quoted in segs:
                if not quoted or b <= a or not bt[a:b].strip(' “”‘’'): continue
                # 1) Strong's numbers that occur only in Jesus' words (or only outside them) in the KJV verse
                strongs = {btoks[bidx[i]][1] for i in range(a, b) if btoks[bidx[i]][1]} - COMMON
                score = len(strongs & (wj - non)) - len(strongs & (non - wj))
                # 2) Where in the verse it falls: the KJV words at the same relative position
                if kflags:
                    lo, hi = a / len(bt), b / len(bt)
                    window = kflags[int(lo * len(kflags)):max(int(lo * len(kflags)) + 1, int(round(hi * len(kflags))))]
                    frac = sum(window) / len(window)
                    score += 2 if frac > 0.6 else -2 if frac < 0.4 else 0
                # 3) Who the narration names as speaker: the last sentence before the quotation ("Jesus said to her,")
                #    and a short tag right after it ("Jesus asked."). A clause after it that ends in a comma
                #    introduces the next quotation instead ("she said, …"), so it doesn't count.
                k = segs.index((a, b, quoted))
                before = bt[segs[k - 1][0]:segs[k - 1][1]] if k > 0 and not segs[k - 1][2] else ''
                after = bt[segs[k + 1][0]:segs[k + 1][1]] if k + 1 < len(segs) and not segs[k + 1][2] else ''
                # Narration before a quotation names its speaker if it leads into it ("Jesus said to her,").
                # A short finished tag there ("Jesus asked.") belongs to the quotation before, but in the BSB's
                # “A,” Jesus asked. “B?” pattern the same person keeps talking, so it counts for half.
                b_s = before.strip()
                lead = re.split(r'[.!?)]\s', b_s)[-1] if b_s and b_s[-1] in ',:—' else ''
                tag_before = b_s if b_s and b_s[-1] in '.!?' and len(b_s.split()) <= 5 else ''
                # After it: a short tag ("Jesus asked."), or a mid-sentence one when the quotation breaks off at a
                # comma ("“My name is Legion,” he replied, “for…”). After a full stop, a comma clause introduces
                # the next quotation instead.
                quote = bt[a:b].rstrip('” ')
                m2 = re.match(r'\s*([^.!?“]*[.!?])', after)
                a_s = after.strip()
                tag_after = m2.group(1) if m2 else (a_s if a_s.endswith(',') and quote.endswith(',') and len(a_s.split()) <= 6 else '')
                # A verse that carries on a speech already under way, which the KJV gives wholly to Jesus.
                if a == 0 and open_before and share >= 0.9: score += 4
                for part, w in ((lead, 6), (tag_after, 6), (tag_before, 3)):
                    if part and JESUS_SAYS.search(part): score += w
                    if part and OTHER_SAYS.search(part): score -= w
                if score > 0:
                    for i in range(a, b): red[i] = True
                    stats['bsb_quotes'] += 1
            atext = ba[c - 1][v - 1] if c <= len(ba) and v <= len(ba[c - 1]) else None
            if not atext or not any(red): continue
            m = mapper(bt, atext)
            rs = trim(atext, [[m[a], m[b]] for a, b in ranges_from_flags(red)])
            if rs: result['BSB'][bid * 1_000_000 + c * 1000 + v] = rs; stats['bsb'] += 1
    outdir = os.path.join(ROOT, 'app/public/data/redletter')
    os.makedirs(outdir, exist_ok=True)
    for tr, d in result.items():
        json.dump(d, open(os.path.join(outdir, f'{tr}.json'), 'w'), separators=(',', ':'))
    print(stats)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

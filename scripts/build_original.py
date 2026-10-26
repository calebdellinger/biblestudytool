"""Build the interlinear Hebrew/Greek data from STEPBible-Data (Tyndale House, CC BY 4.0).

Input:  a checkout of https://github.com/STEPBible/STEPBible-Data (path as argv[1])
Output (app/public/data/orig):
  words/<book>.json  {"c:v": [[text, translit, gloss, strongs, morph], ...]}   one list per verse, in original word order
  lex/<H|G><bucket>.json  {strong: [lemma, translit, gloss, definitionHtml, count, [verseIds...]]}
  morph.json  {code: "Function=Verb; ..."}  only the codes that occur
"""
import json, os, re, sys, glob, collections, html

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "data", "orig")

CODES = ("Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam "
         "Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col "
         "1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev").split()
BOOK = {c: i + 1 for i, c in enumerate(CODES)}
REF = re.compile(r"^([0-9A-Za-z]{3})\.(\d+)\.(\d+)[^#\t]*#(\d+)=([^\t]+)")

def vid(b, c, v): return b * 1_000_000 + c * 1000 + v
def main_strong(s):
    m = re.search(r"\{([HG]\d+[A-Za-z]?)\}", s)
    if m: return m.group(1)
    m = re.search(r"([HG]\d+[A-Za-z]?)", s)
    return m.group(1) if m else ""
def norm(s):  # H1254a -> H1254A ; pad to 4 digits
    m = re.match(r"([HG])(\d+)([A-Za-z]?)", s)
    return f"{m.group(1)}{int(m.group(2)):04d}{m.group(3).upper()}" if m else s

words = collections.defaultdict(lambda: collections.defaultdict(list))
occ = collections.defaultdict(list)
morph_used = set()

for path in sorted(glob.glob(os.path.join(SRC, "Translators Amalgamated OT+NT", "TA*.txt"))):
    hebrew = os.path.basename(path).startswith("TAHOT")
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = REF.match(line)
            if not m: continue
            code, c, v, _, typ = m.groups()
            if code not in BOOK: continue
            cols = line.rstrip("\n").split("\t")
            if hebrew:
                if typ[0] not in "LQR": continue
                text, translit, gloss, strongs, morph = cols[1], cols[2], cols[3], cols[4], cols[5]
                lang = morph[:1] if morph[:1] in "HA" else "H"
                for i, part in enumerate(morph.split("/")):
                    morph_used.add(part if i == 0 else lang + part)
            else:
                if not typ.startswith("N"): continue
                gk = cols[1]
                mm = re.match(r"(.*?)\s*\((.*)\)\s*$", gk)
                text, translit = (mm.group(1), mm.group(2)) if mm else (gk, "")
                gloss = cols[2]
                strongs, _, morph = cols[3].partition("=")
                morph_used.add(morph)
            b, ci, vi = BOOK[code], int(c), int(v)
            words[b][f"{ci}:{vi}"].append([text, translit, gloss.strip(), strongs, morph])
            ms = norm(main_strong(strongs))
            if ms: occ[ms].append(vid(b, ci, vi))

os.makedirs(os.path.join(OUT, "words"), exist_ok=True)
for b, verses in words.items():
    json.dump(verses, open(os.path.join(OUT, "words", f"{b}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# Lexicons
ALLOWED = re.compile(r"</?(b|i|br)\s*/?>", re.I)
def clean(defn):
    defn = re.sub(r"<ref='[^']*'>(.*?)</ref>", r"\1", defn)
    parts = re.split(r"(<[^>]+>)", defn)
    out = []
    for p in parts:
        if p.startswith("<"):
            t = p.lower()
            if re.match(r"<br", t): out.append("<br>")
            elif t in ("<b>", "</b>", "<i>", "</i>"): out.append(t)
        else:
            out.append(p)
    s = "".join(out).replace("__", "").strip()
    return re.sub(r"(<br>\s*){3,}", "<br><br>", s)

lex = collections.defaultdict(dict)
for name in ("TBESH", "TBESG"):
    path = glob.glob(os.path.join(SRC, "Lexicons", f"{name}*.txt"))[0]
    with open(path, encoding="utf-8") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 8 or not re.match(r"^[HG]\d", cols[0]): continue
            key = norm(cols[1].split("=")[0].strip()) if cols[1] else norm(cols[0])
            if not re.match(r"^[HG]\d{4}[A-Z]?$", key): continue
            ids = sorted(set(occ.get(key, [])))
            lex[key[0] + str(int(key[1:5]) // 100)][key] = [cols[3], cols[4], cols[6], clean(cols[7]), len(occ.get(key, [])), ids]

os.makedirs(os.path.join(OUT, "lex"), exist_ok=True)
for bucket, entries in lex.items():
    json.dump(entries, open(os.path.join(OUT, "lex", f"{bucket}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

morph = {}
for path in glob.glob(os.path.join(SRC, "Morphology codes", "*.txt")):
    with open(path, encoding="utf-8") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) >= 2 and cols[0] in morph_used and "Function=" in cols[1]:
                morph[cols[0]] = cols[1].strip()
json.dump(morph, open(os.path.join(OUT, "morph.json"), "w"), separators=(",", ":"))

missing_lex = sum(1 for k in occ if not any(k in e for e in lex.values()))
print(f"books {len(words)}, words {sum(len(w) for vs in words.values() for w in vs.values())}, "
      f"lexicon entries {sum(len(e) for e in lex.values())}, morph codes {len(morph)}/{len(morph_used)}, strongs without lexicon {missing_lex}")

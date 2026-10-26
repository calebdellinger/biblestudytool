"""Build the app's static reference data from public-domain sources.

Inputs (downloaded into data/raw):
  BSB.json, KJV.json  - scrollmapper/bible_databases formats/json
  xrefs.txt           - OpenBible.info cross references (CC-BY), via scrollmapper sources/extras
Outputs (app/public/data):
  books.json                       - book metadata
  bible/<TR>/<book>.json           - [[verse text, ...] per chapter]
  xrefs/<book>.json                - {"c:v": [[startId, endId, votes], ...]}  top refs per verse
"""
import json, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "app", "public", "data")

BOOKS = [
 ("Gen","Genesis","Gen"),("Exod","Exodus","Exod"),("Lev","Leviticus","Lev"),("Num","Numbers","Num"),
 ("Deut","Deuteronomy","Deut"),("Josh","Joshua","Josh"),("Judg","Judges","Judg"),("Ruth","Ruth","Ruth"),
 ("1Sam","1 Samuel","1 Sam"),("2Sam","2 Samuel","2 Sam"),("1Kgs","1 Kings","1 Kgs"),("2Kgs","2 Kings","2 Kgs"),
 ("1Chr","1 Chronicles","1 Chr"),("2Chr","2 Chronicles","2 Chr"),("Ezra","Ezra","Ezra"),("Neh","Nehemiah","Neh"),
 ("Esth","Esther","Esth"),("Job","Job","Job"),("Ps","Psalms","Ps"),("Prov","Proverbs","Prov"),
 ("Eccl","Ecclesiastes","Eccl"),("Song","Song of Songs","Song"),("Isa","Isaiah","Isa"),("Jer","Jeremiah","Jer"),
 ("Lam","Lamentations","Lam"),("Ezek","Ezekiel","Ezek"),("Dan","Daniel","Dan"),("Hos","Hosea","Hos"),
 ("Joel","Joel","Joel"),("Amos","Amos","Amos"),("Obad","Obadiah","Obad"),("Jonah","Jonah","Jonah"),
 ("Mic","Micah","Mic"),("Nah","Nahum","Nah"),("Hab","Habakkuk","Hab"),("Zeph","Zephaniah","Zeph"),
 ("Hag","Haggai","Hag"),("Zech","Zechariah","Zech"),("Mal","Malachi","Mal"),
 ("Matt","Matthew","Matt"),("Mark","Mark","Mark"),("Luke","Luke","Luke"),("John","John","John"),
 ("Acts","Acts","Acts"),("Rom","Romans","Rom"),("1Cor","1 Corinthians","1 Cor"),("2Cor","2 Corinthians","2 Cor"),
 ("Gal","Galatians","Gal"),("Eph","Ephesians","Eph"),("Phil","Philippians","Phil"),("Col","Colossians","Col"),
 ("1Thess","1 Thessalonians","1 Thess"),("2Thess","2 Thessalonians","2 Thess"),("1Tim","1 Timothy","1 Tim"),
 ("2Tim","2 Timothy","2 Tim"),("Titus","Titus","Titus"),("Phlm","Philemon","Phlm"),("Heb","Hebrews","Heb"),
 ("Jas","James","Jas"),("1Pet","1 Peter","1 Pet"),("2Pet","2 Peter","2 Pet"),("1John","1 John","1 John"),
 ("2John","2 John","2 John"),("3John","3 John","3 John"),("Jude","Jude","Jude"),("Rev","Revelation","Rev"),
]
OSIS = {b[0]: i + 1 for i, b in enumerate(BOOKS)}

def vid(b, c, v):
    return b * 1_000_000 + c * 1000 + v

def parse_ref(s):
    bk, c, v = s.split(".")
    return vid(OSIS[bk], int(c), int(v))

def main():
    os.makedirs(OUT, exist_ok=True)
    meta = []
    for tr in ("BSB", "KJV"):
        src = json.load(open(os.path.join(RAW, f"{tr}.json"), encoding="utf-8"))
        assert len(src["books"]) == 66, tr
        d = os.path.join(OUT, "bible", tr); os.makedirs(d, exist_ok=True)
        for i, book in enumerate(src["books"]):
            chapters = []
            for ch in book["chapters"]:
                verses = [""] * max(v["verse"] for v in ch["verses"])
                for v in ch["verses"]:
                    verses[v["verse"] - 1] = v["text"].strip()
                chapters.append(verses)
            json.dump(chapters, open(os.path.join(d, f"{i+1}.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))
            if tr == "BSB":
                osis, name, abbr = BOOKS[i]
                meta.append({"id": i + 1, "osis": osis, "name": name, "abbr": abbr,
                             "testament": "OT" if i < 39 else "NT",
                             "verses": [len(c) for c in chapters]})
    json.dump(meta, open(os.path.join(OUT, "books.json"), "w"), separators=(",", ":"))

    per = collections.defaultdict(list)
    with open(os.path.join(RAW, "xrefs.txt"), encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3: continue
            frm, to, votes = parts[0], parts[1], int(parts[2] or 0)
            if votes < 1: continue
            a, _, b = to.partition("-")
            per[parse_ref(frm)].append((parse_ref(a), parse_ref(b) if b else parse_ref(a), votes))
    by_book = collections.defaultdict(dict)
    for k, refs in per.items():
        refs.sort(key=lambda r: -r[2])
        b, rest = divmod(k, 1_000_000); c, v = divmod(rest, 1000)
        by_book[b][f"{c}:{v}"] = [list(r) for r in refs[:15]]
    d = os.path.join(OUT, "xrefs"); os.makedirs(d, exist_ok=True)
    for b, m in by_book.items():
        json.dump(m, open(os.path.join(d, f"{b}.json"), "w"), separators=(",", ":"))
    print("books", len(meta), "xref verses", len(per))

if __name__ == "__main__":
    main()

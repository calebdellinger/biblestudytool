"""People, events and approximate years from Theographic Bible Metadata (Robert Rouse, CC BY-SA 4.0),
with Easton's Bible Dictionary (1897, public domain) for short biographies.

Usage: python build_people.py <theographic-bible-metadata/json>
Output (app/public/data/people):
  people.json            [[name, title, gender, birth, death, father[], mother[], siblings[], partners[], children[], verseCount, minYear, maxYear, alsoCalled[]], ...]  (index = person number)
  verses/<book>.json     {"c:v": [person numbers]}
  years/<book>.json      {"c": [minYear, maxYear]} per chapter, from the verses' years
  events.json            [[title, startYear, duration, firstVerse, lastVerse, [person numbers]], ...]
  bio/<letter>.json      {person number: "Easton's entry"}
  mentions/<n div 200>.json {person number: [verse ids]}
"""
import json, os, sys, re, collections

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "data", "people")
load = lambda f: json.load(open(os.path.join(SRC, f + ".json"), encoding="utf-8"))
people, verses, events, easton = load("people"), load("verses"), load("events"), load("easton")

books = json.load(open(os.path.join(ROOT, "app", "public", "data", "books.json")))
OSIS = {b["osis"]: b["id"] for b in books}
def vid_of(osis):
    b, c, v = osis.split(".")
    return OSIS[b] * 1_000_000 + int(c) * 1000 + int(v) if b in OSIS else None

verse_by_rec = {v["id"]: v["fields"] for v in verses}
rec_vid = {k: vid_of(f["osisRef"]) for k, f in verse_by_rec.items()}
people = [p for p in people if p["fields"].get("status") in ("publish", "wip")]
pidx = {p["id"]: i for i, p in enumerate(people)}
num = lambda s: int(s) if s not in (None, "") else None
ids = lambda f, k: [pidx[x] for x in f.get(k, []) if x in pidx]

core, mentions = [], collections.defaultdict(list)
for i, p in enumerate(people):
    f = p["fields"]
    core.append([f.get("name", ""), f.get("displayTitle", ""), (f.get("gender") or "")[:1], num(f.get("birthYear")), num(f.get("deathYear")),
                 ids(f, "father"), ids(f, "mother"), ids(f, "siblings") + ids(f, "halfSiblingsSameFather") + ids(f, "halfSiblingsSameMother"),
                 ids(f, "partners"), ids(f, "children"), f.get("verseCount", 0), f.get("minYear"), f.get("maxYear"),
                 [a.strip() for a in (f.get("alsoCalled") or "").split(",") if a.strip()] if isinstance(f.get("alsoCalled"), str) else []])
    mentions[i] = sorted(v for v in (rec_vid.get(r) for r in f.get("verses", [])) if v)

os.makedirs(OUT, exist_ok=True)
dump = lambda path, obj: json.dump(obj, open(os.path.join(OUT, path), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
dump("people.json", core)

# verse -> people, and chapter year ranges
by_book = collections.defaultdict(dict)
years = collections.defaultdict(lambda: collections.defaultdict(list))
for rec, f in verse_by_rec.items():
    v = rec_vid.get(rec)
    if not v: continue
    b, c, vv = v // 1_000_000, (v // 1000) % 1000, v % 1000
    ps = [pidx[x] for x in f.get("people", []) if x in pidx]
    if ps: by_book[b][f"{c}:{vv}"] = ps
    if f.get("yearNum") is not None: years[b][c].append(f["yearNum"])
os.makedirs(os.path.join(OUT, "verses"), exist_ok=True); os.makedirs(os.path.join(OUT, "years"), exist_ok=True)
for b, m in by_book.items(): dump(f"verses/{b}.json", m)
for b, chs in years.items(): dump(f"years/{b}.json", {str(c): [min(y), max(y)] for c, y in chs.items()})

# events
ev = []
for e in events:
    f = e["fields"]
    vs = sorted(v for v in (rec_vid.get(r) for r in f.get("verses", [])) if v)
    if not vs or f.get("startDate") in (None, ""): continue
    sd = str(f["startDate"])
    m = re.match(r"^(-?\d+)", sd)
    if not m: continue
    ev.append([f["title"], int(m.group(1)), f.get("duration", ""), vs[0], vs[-1], ids(f, "participants")])
ev.sort(key=lambda x: (x[1], x[3]))
dump("events.json", ev)

# biographies from Easton's
east = {e["id"]: e["fields"].get("dictText", "") for e in easton}
bios = collections.defaultdict(dict)
for i, p in enumerate(people):
    f = p["fields"]
    text = "\n\n".join(east.get(x, "") for x in f.get("eastons", []) if east.get(x))
    if not text: continue
    text = re.sub(r"\]\(/[^)]*\)", "]", text).replace("[", "")
    text = text.replace("]", "")
    letter = (core[i][0][:1] or "_").upper()
    bios[letter if letter.isalpha() else "_"][str(i)] = text.strip()
os.makedirs(os.path.join(OUT, "bio"), exist_ok=True); os.makedirs(os.path.join(OUT, "mentions"), exist_ok=True)
for k, m in bios.items(): dump(f"bio/{k}.json", m)
shards = collections.defaultdict(dict)
for i, vs in mentions.items(): shards[i // 200][str(i)] = vs
for k, m in shards.items(): dump(f"mentions/{k}.json", m)
print(f"people {len(core)}, verses with people {sum(len(m) for m in by_book.values())}, events {len(ev)}, bios {sum(len(m) for m in bios.values())}")

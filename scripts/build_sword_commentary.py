"""Convert a CrossWire SWORD zCom commentary (e.g. Barnes) to Margin's per-verse JSON.

Usage: python build_sword_commentary.py <unzipped module dir> <name> <KJV.json>
Writes app/public/data/commentary/<name>/<book>.json  {"c": {"v": "markdown"}}
Reads the module's compressed blocks directly (.?zs block index, .?zv verse index, .?zz zlib data),
using KJV versification, which is what CrossWire's KJV-versified modules use.
"""
import json, os, re, struct, sys, zlib, glob, html

mod_dir, name, kjv_path = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "public", "data", "commentary", name)
kjv = json.load(open(kjv_path, encoding="utf-8"))
counts = [[len(ch["verses"]) for ch in b["chapters"]] for b in kjv["books"]]

data_dir = os.path.dirname(glob.glob(os.path.join(mod_dir, "modules", "**", "*.?zv"), recursive=True)[0])

def read_testament(prefix):
    zs = open(os.path.join(data_dir, f"{prefix}.czs"), "rb").read() if os.path.exists(os.path.join(data_dir, f"{prefix}.czs")) else open(os.path.join(data_dir, f"{prefix}.bzs"), "rb").read()
    ext = "c" if os.path.exists(os.path.join(data_dir, f"{prefix}.czs")) else "b"
    zv = open(os.path.join(data_dir, f"{prefix}.{ext}zv"), "rb").read()
    zz = open(os.path.join(data_dir, f"{prefix}.{ext}zz"), "rb").read()
    blocks = {}
    def block(n):
        if n not in blocks:
            off, csize, usize = struct.unpack_from("<III", zs, n * 12)
            blocks[n] = zlib.decompress(zz[off:off + csize])
        return blocks[n]
    def entry(i):
        if (i + 1) * 10 > len(zv): return b""
        bn, off, size = struct.unpack_from("<IIH", zv, i * 10)
        if size == 0: return b""
        return block(bn)[off:off + size]
    return entry

def thml_to_md(t):
    t = re.sub(r"<scripRef[^>]*>(.*?)</scripRef>", r"\1", t, flags=re.S)
    t = re.sub(r"<(b|strong)>(.*?)</\1>", r"**\2**", t, flags=re.S)
    t = re.sub(r"<(i|em)>(.*?)</\1>", r"*\2*", t, flags=re.S)
    t = re.sub(r"<br\s*/?>|</p>|<p[^>]*>", "\n\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n\n", t).strip()

os.makedirs(OUT, exist_ok=True)
total = 0
for testament, prefix, book_range in (("OT", "ot", range(0, 39)), ("NT", "nt", range(39, 66))):
    if not glob.glob(os.path.join(data_dir, f"{prefix}.?zv")): continue
    entry = read_testament(prefix)
    idx = 2  # [0] module header, [1] testament heading
    for b in book_range:
        idx += 1  # book heading
        book = {}
        for c, nv in enumerate(counts[b], start=1):
            idx += 1  # chapter heading
            for v in range(1, nv + 1):
                raw = entry(idx).decode("utf-8", "replace")
                idx += 1
                if raw.strip():
                    book.setdefault(str(c), {})[str(v)] = thml_to_md(raw)
                    total += 1
        if book:
            json.dump(book, open(os.path.join(OUT, f"{b + 1}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(name, "verses with notes:", total)

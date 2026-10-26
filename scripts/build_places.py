"""Places for Margin's map.

Inputs: OpenBible.info Bible-Geocoding-Data checkout (CC BY 4.0) and Natural Earth 10m countries + populated places (public domain).
Usage: python build_places.py <Bible-Geocoding-Data dir> <natural earth geojson dir>
Output: app/public/data/map/places.json
  [[id, name, type, lon, lat, confidence(0-1000), todayName, [nearTown, km] | null, country, [alternatives], [verseIds]], ...]
"""
import json, os, sys, math
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

OB, NE = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
books = json.load(open(os.path.join(ROOT, "app", "public", "data", "books.json")))
OSIS = {b["osis"]: b["id"] for b in books}

countries = json.load(open(os.path.join(NE, "ne_10m_admin_0_countries.geojson"), encoding="utf-8"))["features"]
cgeoms = [shape(f["geometry"]) for f in countries]
ctree = STRtree(cgeoms)
towns = [f for f in json.load(open(os.path.join(NE, "ne_10m_populated_places_simple.geojson"), encoding="utf-8"))["features"]]

def country_of(lon, lat):
    p = Point(lon, lat)
    for i in ctree.query(p):
        if cgeoms[i].contains(p): return countries[i]["properties"]["NAME_EN"]
    # at sea or on a coastline: nearest country within ~20 km
    i = ctree.nearest(p)
    return countries[i]["properties"]["NAME_EN"] if cgeoms[i].distance(p) < 0.2 else ""

def km(lon1, lat1, lon2, lat2):
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))

def near_town(lon, lat):
    best = None
    for t in towns:
        tl, tt = t["geometry"]["coordinates"]
        if abs(tl - lon) > 0.6 or abs(tt - lat) > 0.6: continue
        d = km(lon, lat, tl, tt)
        if best is None or d < best[0]: best = (d, t["properties"]["name"])
    return (best[1], round(best[0])) if best and best[0] < 45 else ("", 0)

def vid(o):
    parts = o.split(".")
    if parts[0] not in OSIS or len(parts) < 3: return None
    return OSIS[parts[0]] * 1_000_000 + int(parts[1]) * 1000 + int(parts[2])

out = []
for line in open(os.path.join(OB, "data", "ancient.jsonl"), encoding="utf-8"):
    a = json.loads(line)
    extra = json.loads(a.get("extra") or "{}")
    verses = sorted({v for v in (vid(o) for o in extra.get("osises", [])) if v})
    assoc = extra.get("associations") or []
    lon = lat = None
    for ident in a.get("identifications") or []:
        for res in ident.get("resolutions") or []:
            if res.get("lonlat"):
                lon, lat = map(float, res["lonlat"].split(",")); break
        if lon is not None: break
    score = assoc[0]["score"] if assoc else 0
    today = assoc[0]["name"] if assoc else ""
    alts = [x["name"] for x in assoc[1:] if x.get("score", 0) > 0][:3]
    town, dist = near_town(lon, lat) if lon is not None else ("", 0)
    if town and today and town.lower() in today.lower(): town = ""
    country = country_of(lon, lat) if lon is not None else ""
    typ = (a.get("types") or ["place"])[0]
    out.append([a["id"], a["friendly_id"], typ, round(lon, 5) if lon is not None else None, round(lat, 5) if lat is not None else None,
                max(0, min(1000, score)), today, [town, dist] if town else None, country, alts, verses])

json.dump(out, open(os.path.join(ROOT, "app", "public", "data", "map", "places.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
located = sum(1 for p in out if p[3] is not None)
print(f"places {len(out)}, located {located}, with verses {sum(1 for p in out if p[10])}")
for name in ("Capernaum", "Jerusalem", "Philippi", "Ur", "Babylon", "Tarshish", "Bethlehem"):
    print([p[:10] for p in out if p[1] == name][:1])

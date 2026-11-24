import json, math, osmium
from pathlib import Path
from collections import defaultdict
from itertools import combinations
from datetime import date

center = (121.58448422, 31.08790789)


def distance(lon, lat):
    return math.hypot((lon - center[0]) * 95240, (lat - center[1]) * 111100)


refs, roads, shops = {}, defaultdict(dict), []
for o in osmium.FileProcessor(
    ".test-output/model-sources/shanghai.osm.pbf"
).with_locations():
    if (
        o.is_node()
        and o.tags.get("name")
        and (
            o.tags.get("shop")
            or o.tags.get("amenity") in ("pharmacy", "restaurant", "cafe", "bakery")
        )
    ):
        ll = o.location.lon, o.location.lat
        if distance(*ll) <= 10000:
            address = (o.tags.get("addr:street") or "") + (
                o.tags.get("addr:housenumber") or ""
            )
            shops.append(
                [
                    str(o.id),
                    o.tags["name"],
                    *ll,
                    address,
                    o.tags.get("shop") or o.tags.get("amenity"),
                ]
            )
    if (
        not o.is_way()
        or not o.tags.get("name")
        or o.tags.get("highway")
        not in (
            "primary",
            "secondary",
            "tertiary",
            "residential",
            "unclassified",
            "living_street",
            "pedestrian",
            "service",
        )
    ):
        continue
    name = o.tags.get("name:zh") or o.tags["name"]
    nodes = list(o.nodes)
    layer = o.tags.get("layer", "0")
    if not any(n.location.valid() and distance(n.lon, n.lat) <= 10000 for n in nodes):
        continue
    for i, n in enumerate(nodes):
        if not n.location.valid() or distance(n.lon, n.lat) > 10000:
            continue
        attrs = roads[(n.ref, layer)]
        refs[n.ref] = (n.lon, n.lat)
        for ind in (i - 1, i + 1):
            if not 0 <= ind < len(nodes):
                continue
            other = nodes[ind]
            if not other.location.valid():
                continue
            dx, dy = (other.lon - n.lon) * 95240, (other.lat - n.lat) * 111100
            if dx * dx + dy * dy < 1:
                continue
            angle = round(math.degrees(math.atan2(dx, dy))) % 360
            attrs.setdefault(name, set()).add(angle)
intersections = []
groups = defaultdict(list)
for (node, _), arms in roads.items():
    if len(arms) < 2:
        continue
    names = sorted(arms)
    lon, lat = refs[node]
    for x, y in combinations(names, 2):
        # Two line segments can be the same road changing name. Require three distinct approaches.
        bearings = []
        for angle in sorted(arms[x] | arms[y]):
            if all(abs((angle - b + 180) % 360 - 180) >= 22 for b in bearings):
                bearings.append(angle)
        if len(bearings) < 3:
            continue
        key = (x, y)
        known = groups[key]
        if any(
            math.hypot((lon - u) * 95240, (lat - v) * 111100) < 32 for u, v in known
        ):
            continue
        known.append((lon, lat))
        intersections.append(
            [str(node), x, y, lon, lat, sorted(arms[x]), sorted(arms[y])]
        )
result = {
    "osmDate": "2026-11-18",
    "junctions": sorted(intersections, key=lambda r: distance(r[3], r[4])),
    "shops": sorted(shops, key=lambda r: distance(r[2], r[3])),
}
out = Path("public/recognition")
out.mkdir(exist_ok=True)
(out / "ruihe-index.json").write_text(
    json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
print("junctions", len(intersections), "shops", len(shops))
print(
    "matching shops",
    [
        (s[0], s[1], s[2:4])
        for s in result["shops"][:55]
        if s[1] in ("阳光超市", "益丰大药房", "吉祥里生鲜超市")
    ],
)
print("first junctions", result["junctions"][:5])

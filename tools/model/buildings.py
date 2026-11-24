"""Build LoD1/LoD2 building meshes from OSM multipolygons, preserving holes and pitched roofs, with an inspectable source table."""

import argparse, gzip, json, math, re, struct, time
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import osmium, mapbox_earcut, shapely
from shapely.geometry import Polygon, MultiPolygon, Point, mapping, shape
from shapely.ops import unary_union


def transform(fn, geom):
    return shapely.transform(geom, fn, interleaved=False)


from shapely.strtree import STRtree
from pyproj import Geod
from rasterio.features import geometry_mask
from affine import Affine
from rasters import (
    CITIES,
    CACHE,
    OUTPUT,
    MERC,
    GEO,
    SceneGrid,
    write_json,
)

GEOD = Geod(ellps="WGS84")


def polygons(g):
    if g.geom_type == "Polygon":
        return [g] if not g.is_empty else []
    return [p for member in getattr(g, "geoms", []) for p in polygons(member)]


def metres(raw):
    if not raw:
        return None
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(m|米|ft|feet|\')?\s*", str(raw).lower())
    if not m:
        return None
    value = float(m[1].replace(",", ".")) * (
        0.3048 if m[2] in ("ft", "feet", "'") else 1
    )
    return value if 0 <= value <= 1000 else None


def circle_boundary(city):
    angles = np.arange(0, 360, 1.0)
    lo, la, _ = GEOD.fwd(
        np.full(len(angles), city["lon"]),
        np.full(len(angles), city["lat"]),
        angles,
        np.full(len(angles), SceneGrid.for_city(city).radius),
    )
    return Polygon(zip(lo, la))


def anchor_metadata(city):
    if not city.get("osmBoundary"):
        return {}
    return {
        "centerSource": "https://www.openstreetmap.org/" + city["osmBoundary"],
        "address": city["address"],
        "centerMethod": "OSM boundary centroid in EPSG:32651",
        "boundary": [
            [round(x, 7), round(y, 7)] for x, y in circle_boundary(city).exterior.coords
        ],
    }


def collect(city):
    cache = CACHE / (city["id"] + "-outlines.json.gz")
    if cache.exists():
        with gzip.open(cache, "rt", encoding="utf-8") as f:
            return json.load(f)
    disc = circle_boundary(city)
    w, s, e, n = disc.bounds
    records = []
    factory = osmium.geom.WKBFactory()
    path = CACHE / (city["extract"] + ".osm.pbf")
    if not path.exists():
        import requests
        from shutil import copyfileobj

        url = f"https://download.geofabrik.de/asia/china/{city['extract']}/{city['extract']}-261118.osm.pbf"
        with (
            requests.get(url, stream=True, timeout=80) as res,
            path.with_suffix(".part").open("wb") as f,
        ):
            res.raise_for_status()
            copyfileobj(res.raw, f)
        path.with_suffix(".part").replace(path)
    for area in (
        osmium.FileProcessor(str(path))
        .with_areas()
        .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    ):
        part = area.tags.get("building:part")
        building = area.tags.get("building")
        if not (part and part != "no" or building and building != "no"):
            continue
        try:
            geom = shapely.from_wkb(bytes.fromhex(factory.create_multipolygon(area)))
            bb = geom.bounds
            if bb[0] > e or bb[2] < w or bb[1] > n or bb[3] < s:
                continue
            if not geom.is_valid:
                geom = shapely.make_valid(geom)
            clipped = geom.intersection(disc)
            if clipped.is_empty:
                continue
            tags = {
                k: area.tags.get(k)
                for k in [
                    "height",
                    "building",
                    "building:levels",
                    "min_height",
                    "building:min_level",
                    "building:part",
                    "roof:height",
                    "roof:shape",
                    "roof:levels",
                    "roof:orientation",
                    "building:colour",
                    "roof:colour",
                    "name",
                ]
                if area.tags.get(k)
            }
            oid = ("w" if area.from_way() else "r") + str(area.orig_id())
            for poly in polygons(clipped):
                records.append([oid, tags, mapping(poly)])
        except (ValueError, RuntimeError, shapely.errors.GEOSException):
            continue
    with gzip.open(cache, "wt", encoding="utf-8") as f:
        json.dump(records, f, separators=(",", ":"))
    print(city["id"], "source polygons", len(records), flush=True)
    return records


def measured_height(poly, tags, raster, grid):
    explicit = metres(tags.get("height"))
    if explicit and explicit >= 1:
        return explicit, "tag"
    levels = metres(tags.get("building:levels"))
    roof = metres(tags.get("roof:height")) or 0
    if levels and levels <= 180:
        return levels * 3 + roof, "levels"
    x0, y0, x1, y1 = poly.bounds
    cell = 2 * grid.half / grid.rgb_n
    c0 = max(0, math.floor((x0 + grid.half) / cell))
    r0 = max(0, math.floor((grid.half - y1) / cell))
    c1 = min(grid.rgb_n, math.ceil((x1 + grid.half) / cell))
    r1 = min(grid.rgb_n, math.ceil((grid.half - y0) / cell))
    # Use pixel centers inside the footprint; a small footprint gets a single point sample.
    window = raster[r0:r1, c0:c1]
    if window.size:
        transform_ = Affine(
            cell, 0, c0 * cell - grid.half, 0, -cell, grid.half - r0 * cell
        )
        inside = geometry_mask([poly], window.shape, transform_, invert=True)
        vals = window[inside]
        positive = vals[np.isfinite(vals) & (vals >= 2) & (vals < 700)]
        if len(positive):
            return round(float(np.median(positive)), 1), "raster"
    if poly.area <= 180:
        p = poly.representative_point()
        i = int((p.x + grid.half) / cell)
        j = int((grid.half - p.y) / cell)
        v = raster[j, i]
        if np.isfinite(v) and 2 <= v < 700:
            return round(float(v), 1), "raster"
    return 0, "outline"


def ground_at(x, y, dem, grid):
    i = np.clip(
        (x + grid.half) * (grid.dem_n - 1) / (2 * grid.half), 0, grid.dem_n - 1.0001
    )
    j = np.clip(
        (grid.half - y) * (grid.dem_n - 1) / (2 * grid.half), 0, grid.dem_n - 1.0001
    )
    a, b = i.astype("int32"), j.astype("int32")
    u, v = i - a, j - b
    return (dem[b, a] * (1 - u) + dem[b, a + 1] * u) * (1 - v) + (
        dem[b + 1, a] * (1 - u) + dem[b + 1, a + 1] * u
    ) * v


def resolve_roof_shape(poly, tags, h, infer_roofs=False):
    raw = (tags.get("roof:shape") or "").strip().lower()
    if raw in ("gabled", "hipped", "half-hipped", "pyramidal", "dome", "onion", "flat"):
        return raw
    if (
        infer_roofs
        and not poly.interiors
        and 35 <= poly.area <= 420
        and 4.5 <= h <= 14.0
        and tags.get("building") in ("house", "detached", "semidetached_house", "residential", "terrace", "temple")
    ):
        return "hipped"
    return "flat"


def rectangular_quad(ring):
    """Return 4 ordered vertices if a polygon exterior is close to a rectangle, else None."""
    if len(ring) != 4:
        return None
    edges = np.roll(ring, -1, axis=0) - ring
    lens = np.hypot(edges[:, 0], edges[:, 1])
    if np.any(lens < 1.5):
        return None
    u = edges / lens[:, None]
    dots = np.abs(np.sum(u * np.roll(u, -1, axis=0), axis=1))
    if np.max(dots) > 0.25:
        return None
    return ring, lens


def append_mesh(tile, poly, h, base, dem, grid, roof_shape="flat", roof_h_tag=0.0):
    rings = [
        np.asarray(r.coords, dtype=np.float64)[:-1, :2]
        for r in [poly.exterior, *poly.interiors]
    ]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return "flat"
    xy = np.concatenate(rings)
    ends = np.cumsum([len(r) for r in rings]).astype("uint32")
    n = len(xy)
    ground = ground_at(xy[:, 0], xy[:, 1], dem, grid)
    floor = float(np.median(ground))
    bottom = np.minimum(ground - 0.4, floor) if base == 0 else np.full(n, floor + base)
    top_y = max(floor + h, float(np.max(bottom)) + 0.2)

    origin_x, _, origin_z = tile["origin"]
    east = (xy[:, 0] - origin_x) * 4
    south = (-xy[:, 1] - origin_z) * 4

    applied_roof = "flat"
    extra_verts = []
    roof_tris = None

    # Build LoD2 pitched roofs when the footprint has no interior courtyards and sufficient wall clearance.
    if roof_shape != "flat" and len(rings) == 1 and h - base >= 3.2:
        ridge_rise = roof_h_tag if roof_h_tag and roof_h_tag < (h - base) * 0.65 else min(4.2, max(1.6, (h - base) * 0.24))
        eave_y = max(float(np.max(bottom)) + 1.8, top_y - ridge_rise)
        if roof_shape in ("pyramidal", "dome", "onion") and len(rings[0]) <= 16:
            c = poly.representative_point()
            peak_e = (c.x - origin_x) * 4
            peak_s = (-c.y - origin_z) * 4
            extra_verts.append([peak_e, top_y * 10, peak_s])
            peak_idx = 2 * n
            tris = []
            for a in range(n):
                b = (a + 1) % n
                tris.extend((n + a, n + b, peak_idx))
            roof_tris = np.asarray(tris, dtype="int32")
            top = np.full(n, eave_y)
            applied_roof = roof_shape
        elif roof_shape in ("gabled", "hipped", "half-hipped"):
            quad = rectangular_quad(rings[0])
            if quad is not None:
                pts, lens = quad
                # Ridge runs parallel to the longer edge pair
                long_is_01 = (lens[0] + lens[2]) >= (lens[1] + lens[3])
                if long_is_01:
                    m0 = 0.5 * (pts[0] + pts[3])
                    m1 = 0.5 * (pts[1] + pts[2])
                    inset = 0.18 if roof_shape != "gabled" else 0.0
                    r0 = m0 + (m1 - m0) * inset
                    r1 = m1 + (m0 - m1) * inset
                    # Vertex indices: 0..3 bottom, 4..7 eave, 8=r0, 9=r1
                    extra_verts.append([(r0[0] - origin_x) * 4, top_y * 10, (-r0[1] - origin_z) * 4])
                    extra_verts.append([(r1[0] - origin_x) * 4, top_y * 10, (-r1[1] - origin_z) * 4])
                    r0i, r1i = 2 * n, 2 * n + 1
                    roof_tris = np.asarray([
                        n + 0, n + 1, r1i, n + 0, r1i, r0i,
                        n + 2, n + 3, r0i, n + 2, r0i, r1i,
                        n + 1, n + 2, r1i,
                        n + 3, n + 0, r0i,
                    ], dtype="int32")
                else:
                    m0 = 0.5 * (pts[0] + pts[1])
                    m1 = 0.5 * (pts[2] + pts[3])
                    inset = 0.18 if roof_shape != "gabled" else 0.0
                    r0 = m0 + (m1 - m0) * inset
                    r1 = m1 + (m0 - m1) * inset
                    extra_verts.append([(r0[0] - origin_x) * 4, top_y * 10, (-r0[1] - origin_z) * 4])
                    extra_verts.append([(r1[0] - origin_x) * 4, top_y * 10, (-r1[1] - origin_z) * 4])
                    r0i, r1i = 2 * n, 2 * n + 1
                    roof_tris = np.asarray([
                        n + 1, n + 2, r1i, n + 1, r1i, r0i,
                        n + 3, n + 0, r0i, n + 3, r0i, r1i,
                        n + 0, n + 1, r0i,
                        n + 2, n + 3, r1i,
                    ], dtype="int32")
                top = np.full(n, eave_y)
                applied_roof = roof_shape

    if roof_tris is None:
        top = np.full(n, top_y)
        roof_tris = mapbox_earcut.triangulate_float64(xy, ends).astype("int32") + n

    # Positive Y is up; positive local Z points south. Mesh coordinates are quarter-metres horizontally.
    stacked = [
        np.c_[east, bottom * 10, south],
        np.c_[east, top * 10, south],
    ]
    if extra_verts:
        stacked.append(np.asarray(extra_verts, dtype=np.float64))
    packed = np.vstack(stacked).round()
    if packed.min() < -32768 or packed.max() > 32767:
        raise ValueError("Tile-local vertex exceeds the signed 16-bit encoding")
    verts = packed.astype("<i2")
    side = []
    start = 0
    for stop in ends:
        for a in range(start, int(stop)):
            b = a + 1 if a + 1 < stop else start
            side.extend((a, b, b + n, a, b + n, a + n))
        start = int(stop)
    tile["v"].append(verts)
    tile["i"].append(np.r_[roof_tris, side] + tile["count"])
    tile["count"] += len(verts)
    return applied_roof


def save_glb(out, tile):
    pos = np.concatenate(tile["v"])
    idx = np.concatenate(tile["i"])
    small = len(pos) < 65536
    idx = idx.astype("<u2" if small else "<u4")
    raw = pos.tobytes()
    pad = lambda body, fill: body + fill * ((-len(body)) % 4)
    first = pad(raw, b"\0")
    buf = pad(first + idx.tobytes(), b"\0")
    g = {
        "asset": {
            "version": "2.0",
            "generator": "Linli satellite neighbourhood builder",
        },
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"mesh": 0, "scale": [0.25, 0.1, 0.25], "translation": tile["origin"]}
        ],
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": 0}, "indices": 1, "material": 0}
                ]
            }
        ],
        "materials": [
            {
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.65, 0.64, 0.60, 1],
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
            }
        ],
        "buffers": [{"byteLength": len(buf)}],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": len(raw),
                "target": 34962,
                "byteStride": 8,
            },
            {
                "buffer": 0,
                "byteOffset": len(first),
                "byteLength": idx.nbytes,
                "target": 34963,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5122,
                "count": len(pos),
                "type": "VEC3",
                "min": pos.min(axis=0).tolist(),
                "max": pos.max(axis=0).tolist(),
            },
            {
                "bufferView": 1,
                "componentType": 5123 if small else 5125,
                "count": len(idx),
                "type": "SCALAR",
            },
        ],
    }
    # glTF vertex attributes must start on 4-byte boundaries; pad XYZ to 8 bytes per vertex.
    raw = (
        np.column_stack((pos, np.zeros(len(pos), dtype="<i2"))).astype("<i2").tobytes()
    )
    buf = pad(raw + idx.tobytes(), b"\0")
    g["bufferViews"][0]["byteLength"] = len(raw)
    g["bufferViews"][1]["byteOffset"] = len(raw)
    g["buffers"][0]["byteLength"] = len(buf)
    js = pad(json.dumps(g, separators=(",", ":")).encode(), b" ")
    total = 28 + len(js) + len(buf)
    blob = (
        b"glTF"
        + struct.pack("<II", 2, total)
        + struct.pack("<I4s", len(js), b"JSON")
        + js
        + struct.pack("<I4s", len(buf), b"BIN\0")
        + buf
    )
    out.write_bytes(gzip.compress(blob, compresslevel=7, mtime=0))
    return len(idx) // 3


def build(city, infer_roofs=False):
    grid = SceneGrid.for_city(city)
    block_width = grid.half * 2 / grid.blocks
    records = collect(city)
    out = OUTPUT / city["id"]
    info = json.loads((out / "raster.json").read_text(encoding="utf-8"))
    dem = (
        np.fromfile(out / "terrain.i16", "<i2")
        .reshape(grid.dem_n, grid.dem_n)
        .astype("float32")
        * 0.1
    )
    raster = np.load(CACHE / (city["id"] + "-cnbh.npy"))
    mx, my = MERC.transform(city["lon"], city["lat"])
    k = math.cos(math.radians(city["lat"]))

    def to_local(x, y):
        a, b = MERC.transform(x, y)
        return (np.asarray(a) - mx) * k, (np.asarray(b) - my) * k

    def to_geo(x, y):
        return GEO.transform(np.asarray(x) / k + mx, np.asarray(y) / k + my)

    local = [
        (oid, tags, transform(to_local, shape(geom))) for oid, tags, geom in records
    ]
    parts = [geom for _, tags, geom in local if tags.get("building:part", "no") != "no"]
    tree = STRtree(parts)
    chunks = defaultdict(lambda: {"v": [], "i": [], "count": 0})
    counts = Counter()
    roof_counts = Counter()
    features = []
    for oid, tags, poly in local:
        if poly.area < 2:
            continue
        h, src = measured_height(poly, tags, raster, grid)
        base = (
            metres(tags.get("min_height"))
            or (metres(tags.get("building:min_level")) or 0) * 3
        )
        roof_h_tag = metres(tags.get("roof:height")) or 0.0
        # Do not double-extrude a parent footprint underneath individually mapped building parts.
        if not tags.get("building:part") and parts:
            covers = [
                parts[i]
                for i in tree.query(poly, predicate="intersects")
                if poly.covers(parts[i].representative_point())
            ]
            if covers:
                poly = poly.difference(unary_union(covers))
        for geom in polygons(poly):
            if geom.area < 2:
                continue
            if base >= h:
                h = 0
                src = "outline"
            counts[src] += 1
            desired_roof = resolve_roof_shape(geom, tags, h, infer_roofs=infer_roofs)
            applied_roof = "flat"
            if h > 0:
                c = geom.representative_point()
                x = min(grid.blocks - 1, max(0, int((c.x + grid.half) / block_width)))
                y = min(grid.blocks - 1, max(0, int((grid.half - c.y) / block_width)))
                tile = chunks[x, y]
                tile["origin"] = [
                    (x + 0.5) * block_width - grid.half,
                    0,
                    (y + 0.5) * block_width - grid.half,
                ]
                applied_roof = append_mesh(
                    tile, geom, h, base, dem, grid, roof_shape=desired_roof, roof_h_tag=roof_h_tag
                )
                roof_counts[applied_roof] += 1
            geo = transform(to_geo, geom)
            props = {
                "osm": oid,
                "height_m": round(h, 1) if h else None,
                "height_source": src,
                "base_m": base,
                "roof_shape": applied_roof,
            }
            if tags.get("building"):
                props["building_type"] = tags["building"]
            if tags.get("name"):
                props["name"] = tags["name"]
            features.append(
                {
                    "type": "Feature",
                    "properties": props,
                    "geometry": mapping(shapely.set_precision(geo, 0.0000001)),
                }
            )
    tilelist = []
    for (x, y), tile in sorted(chunks.items()):
        filename = f"block-{x}-{y}.glb.gz"
        tris = save_glb(out / filename, tile)
        tilelist.append(
            {
                "file": filename,
                "x": tile["origin"][0],
                "z": tile["origin"][2],
                "triangles": tris,
            }
        )
    with gzip.open(
        out / "footprints.geojson.gz", "wt", encoding="utf-8", compresslevel=7
    ) as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            separators=(",", ":"),
        )
    info.update(
        {
            "id": city["id"],
            "name": city["name"],
            "lon": city["lon"],
            "lat": city["lat"],
            "radius": grid.radius,
            "anchorId": city.get("anchorId", city["id"]),
            "lod": 2,
            "counts": dict(counts),
            "roofCounts": dict(roof_counts),
            "osmDate": "2026-11-18",
            "chunks": tilelist,
            "terrainMin": round(float(dem.min()), 1),
            "terrainMax": round(float(dem.max()), 1),
            "triangles": sum(t["triangles"] for t in tilelist),
        }
    )
    info.update(anchor_metadata(city))
    write_json(out / "manifest.json", info)
    print(city["id"], dict(counts), "roofs", dict(roof_counts), "faces", info["triangles"], flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("city")
    ap.add_argument("--outlines-only", action="store_true")
    ap.add_argument("--infer-roofs", action="store_true", help="Infer pitched LoD2 roofs for low-rise rectangular residential buildings")
    a = ap.parse_args()
    city = next(c for c in CITIES if c["id"] == a.city)
    collect(city) if a.outlines_only else build(city, infer_roofs=a.infer_roofs)

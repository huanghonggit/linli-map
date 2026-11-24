"""Build the georeferenced satellite texture, terrain and height samples for one area."""

from pathlib import Path
import argparse, gzip, json, math
from dataclasses import dataclass
import numpy as np
import rasterio as rio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.windows import from_bounds, Window
from rasterio.transform import from_bounds as affine_bounds
from pyproj import Transformer
from PIL import Image
import requests, certifi

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".test-output/model-sources"
OUTPUT = ROOT / "public/models/v1"
AREAS = json.loads(Path(__file__).with_name("areas.json").read_text(encoding="utf-8"))
CITIES = []
for area in AREAS:
    if "radiiKm" in area:
        for km in area["radiiKm"]:
            CITIES.append(
                {
                    **area,
                    "id": f"{area['id']}-{km}",
                    "radiusKm": km,
                    "anchorId": area["id"],
                }
            )
    else:
        CITIES.append({**area, "radiusKm": 5})


@dataclass(frozen=True)
class SceneGrid:
    radius: int
    half: int
    dem_n: int
    rgb_n: int
    blocks: int

    @classmethod
    def for_city(cls, city):
        km = city["radiusKm"]
        half = int(1080 * km)
        return cls(
            km * 1000,
            half,
            half * 2 // 30 + 1,
            half * 2 // 10,
            math.ceil(half * 2 / 2800),
        )


MERC = Transformer.from_crs(4326, 3857, always_xy=True)
GEO = Transformer.from_crs(3857, 4326, always_xy=True)
DEM_URL = "https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif"
STAC = "https://earth-search.aws.element84.com/v1/search"


def bounds(city, half=None):
    if half is None:
        half = SceneGrid.for_city(city).half
    mx, my = MERC.transform(city["lon"], city["lat"])
    a = half / math.cos(math.radians(city["lat"]))
    return mx - a, my - a, mx + a, my + a


def write_json(path, value):
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def crop(url, region, size, bands, sampler, dtype="float32", fill=np.nan):
    target = affine_bounds(*region, size, size)
    with rio.open(url) as src:
        box = transform_bounds("EPSG:3857", src.crs, *region, densify_pts=21)
        raw = from_bounds(*box, src.transform)
        col, row = math.floor(raw.col_off) - 2, math.floor(raw.row_off) - 2
        win = Window(
            col,
            row,
            math.ceil(raw.col_off + raw.width) - col + 2,
            math.ceil(raw.row_off + raw.height) - row + 2,
        )
        win = win.intersection(Window(0, 0, src.width, src.height))
        out = np.full((len(bands), size, size), fill, dtype=dtype)
        reproject(
            src.read(bands, window=win),
            out,
            src_transform=src.window_transform(win),
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_crs="EPSG:3857",
            dst_transform=target,
            dst_nodata=fill,
            resampling=sampler,
        )
        return out


def scenes(city):
    if city.get("sceneId"):
        url = f"https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{city['sceneId']}"
        resp = requests.get(url, timeout=25)
        resp.raise_for_status()
        return [resp.json()]
    path = CACHE / (city["id"] + "-scenes.json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    a, b, c, d = bounds(city)
    west, south = GEO.transform(a, b)
    east, north = GEO.transform(c, d)
    params = {
        "collections": "sentinel-2-l2a",
        "bbox": f"{west},{south},{east},{north}",
        "datetime": "2026-04-01T00:00:00Z/2026-11-18T23:59:59Z",
        "limit": 80,
        "query": json.dumps({"eo:cloud_cover": {"lt": 6}}),
    }
    resp = requests.get(STAC, params=params, timeout=30)
    resp.raise_for_status()
    items = resp.json()["features"]
    write_json(path, items)
    return items


def imagery(city, region, out):
    picks = []
    for item in scenes(city):
        scl = crop(
            item["assets"]["scl"]["href"],
            region,
            270,
            [1],
            Resampling.nearest,
            "uint8",
            0,
        )[0]
        coverage = np.mean(scl != 0)
        clear = np.mean(np.isin(scl, [4, 5, 6]))
        picks.append((coverage * 2 + clear, item, clear))
        if coverage >= 0.999 and clear >= 0.994:
            break
    _, item, clear = max(picks, key=lambda p: p[0])
    rgb = crop(
        item["assets"]["visual"]["href"],
        region,
        SceneGrid.for_city(city).rgb_n,
        [1, 2, 3],
        Resampling.bilinear,
        "uint8",
        0,
    )
    assert np.mean(rgb.max(axis=0) == 0) < 0.002, "Incomplete satellite coverage"
    Image.fromarray(rgb.transpose(1, 2, 0)).save(
        out / "satellite.webp", quality=94, method=6
    )
    return {
        "scene": item["id"],
        "imageDate": item["properties"]["datetime"][:10],
        "sourcePixelsM": 10,
        "clearClassPercent": round(100 * clear, 2),
        "visualUrl": item["assets"]["visual"]["href"],
        "sclUrl": item["assets"]["scl"]["href"],
    }


def build(city):
    grid = SceneGrid.for_city(city)
    out = OUTPUT / city["id"]
    out.mkdir(exist_ok=True, parents=True)
    CACHE.mkdir(exist_ok=True, parents=True)
    region = bounds(city)
    rgbmeta = CACHE / (city["id"] + "-visual-meta.json")
    with rio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CURL_CA_BUNDLE=certifi.where(),
        GDAL_HTTP_CONNECTTIMEOUT="10",
        GDAL_HTTP_TIMEOUT="35",
        GDAL_HTTP_MULTIRANGE="SERIAL",
        GDAL_HTTP_MAX_RETRY="1",
    ):
        if not (out / "satellite.webp").is_file() or not rgbmeta.is_file():
            info = imagery(city, region, out)
            write_json(rgbmeta, info)
        else:
            info = json.loads(rgbmeta.read_text())
        print(city["id"], "image", info["scene"], info["clearClassPercent"], flush=True)
        if not (out / "terrain.i16").exists():
            dtm = crop(
                DEM_URL,
                bounds(city, grid.half + grid.half / (grid.dem_n - 1)),
                grid.dem_n,
                [1],
                Resampling.bilinear,
            )[0]
            assert np.all(np.isfinite(dtm)) and dtm.min() > -150 and dtm.max() < 2500
            np.rint(dtm * 10).astype("<i2").tofile(out / "terrain.i16")
        with Image.open(out / "satellite.webp") as image:
            image.resize((420, 420), Image.Resampling.LANCZOS).save(
                out / "preview.webp", quality=78, method=6
            )
        (out / "terrain.i16.gz").write_bytes(
            gzip.compress((out / "terrain.i16").read_bytes(), mtime=0)
        )
        height = CACHE / (city["id"] + "-cnbh.npy")
        if not height.exists():
            link = f"https://zenodo.org/records/7923866/files/CNBH10m_{city['heightTile']}.tif?download=1"
            sampled = crop(link, region, grid.rgb_n, [1], Resampling.nearest)[0]
            assert np.count_nonzero(np.isfinite(sampled) & (sampled > 0)) > 50
            np.save(height, sampled)
        west, south = GEO.transform(*region[:2])
        east, north = GEO.transform(*region[2:])
        info.update(
            {
                "gridSize": grid.dem_n,
                "halfWidth": grid.half,
                "bounds": [west, south, east, north],
                "terrainSource": "GEDTM30 v1.2",
                "terrainUrl": DEM_URL,
                "heightSource": "CNBH-10m (2020)",
                "heightTile": city["heightTile"],
            }
        )
        write_json(out / "raster.json", info)
        print(city["id"], "rasters ready", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("city", choices=[p["id"] for p in CITIES])
    args = parser.parse_args()
    build(next(p for p in CITIES if p["id"] == args.city))

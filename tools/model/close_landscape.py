"""Build the local close-view land cover and deterministic illustrative canopy positions.
Run from the repository root with the model environment after building the 5 km preset.
"""
import gzip
import json
import math
from pathlib import Path

import numpy as np
import osmium
from affine import Affine
from PIL import Image
from rasterio.features import rasterize
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform

OUT = Path('src/closeup')
SOURCE = Path('.test-output/model-sources')
area = next(p for p in json.loads(Path('tools/model/areas.json').read_text()) if p['id'] == 'ruiheyuan')
r = 6378137 * math.cos(math.radians(area['lat']))
y0 = math.asinh(math.tan(math.radians(area['lat'])))


def project(lon, lat):
    return r * np.radians(np.asarray(lon) - area['lon']), r * (y0 - np.arcsinh(np.tan(np.radians(lat))))


zones = []
for way in osmium.FileProcessor(str(SOURCE / 'shanghai.osm.pbf')).with_locations():
    if not way.is_way() or not way.is_closed():
        continue
    use, kind = way.tags.get('landuse'), way.tags.get('natural')
    value = 3 if kind == 'water' or use in ('reservoir', 'basin') else 2 if kind in ('wood', 'scrub') or use == 'forest' else 1 if use == 'residential' or way.tags.get('leisure') in ('park', 'garden') else 0
    if not value or len(way.nodes) < 4:
        continue
    first = way.nodes[0]
    if not first.location.valid() or abs(first.lon - area['lon']) > .15 or abs(first.lat - area['lat']) > .15:
        continue
    coords = [project(n.lon, n.lat) for n in way.nodes if n.location.valid()]
    if len(coords) >= 4:
        zones.append((Polygon(coords), value))

rgb = np.array(Image.open('public/models/v1/ruiheyuan-5/satellite.webp').convert('RGB'), dtype=float)
n = len(rgb)
options = dict(out_shape=(n, n), transform=Affine(10800/n, 0, -5400, 0, 10800/n, -5400))
zone = rasterize(sorted(zones, key=lambda entry: entry[1]), **options)
red, green, blue = rgb.transpose(2, 0, 1)
coverage = np.clip((green - red * .91 - blue * .10) / 13, 0, 1) * np.clip((green-blue)/22, 0, 1)
coverage = np.where(zone == 2, np.maximum(.80, coverage), coverage)
water = zone == 3
cover = np.stack([coverage*255,water*255,np.clip((red+green+blue)/3,0,255)], axis=-1).astype('uint8')
Image.fromarray(cover).save(OUT/'ground-cover.webp',quality=92,method=6)
with gzip.open('public/models/v1/ruiheyuan-5/footprints.geojson.gz', 'rt', encoding='utf8') as f:
    blocked = [transform(project, shape(p['geometry'])).buffer(3) for p in json.load(f)['features']]
roads = json.loads(Path('src/ruihe-streets.json').read_text())
for name, clearance in [('streets',5), ('paths',2.5)]:
    blocked.extend(LineString(line).buffer(clearance) for line in roads[name])
# A two-metre exclusion mask keeps illustrative crowns off mapped streets and rooftops.
mask = rasterize([(geom,1) for geom in blocked], out_shape=(5400,5400),transform=Affine(2,0,-5400,0,2,-5400),all_touched=True)
rng = np.random.default_rng(168)
zz,xx = np.mgrid[-4998:5000:9,-4998:5000:9]
xx = xx + rng.uniform(-3,3,xx.shape); zz = zz + rng.uniform(-3,3,zz.shape)
ix, iz = ((xx+5400)/10).astype(int), ((zz+5400)/10).astype(int)
keep = ((xx**2+zz**2 < 5000**2) & (zone[iz,ix] > 0) & ~water[iz,ix] &
        (rng.random(xx.shape) < coverage[iz,ix] * .65) & (mask[((zz+5400)/2).astype(int),((xx+5400)/2).astype(int)] == 0))
points = np.round(np.stack((xx[keep],zz[keep]),axis=-1)).astype('<i2')
points.tofile(OUT/'canopy.bin')
print(f'{len(points)} illustrative canopy locations, {np.sum(np.hypot(points[:,0].astype(float),points[:,1]) < 100)} within 100 m')

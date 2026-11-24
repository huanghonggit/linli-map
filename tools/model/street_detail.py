"""Build local OSM street centerlines and tagged pedestrian crossings for the Ruiheyuan 5 km scene."""
import json
import math
import re
import sys
from pathlib import Path
import osmium

AREA = next(p for p in json.loads(Path('tools/model/areas.json').read_text(encoding='utf8')) if p['id'] == 'ruiheyuan')
R = 6378137 * math.cos(math.radians(AREA['lat']))
Y0 = math.asinh(math.tan(math.radians(AREA['lat'])))


def project(lon, lat):
    return [round(R * math.radians(lon - AREA['lon'])), round(R * (Y0 - math.asinh(math.tan(math.radians(lat)))))]


streets, paths, crossings = [], [], []
street_widths, path_widths, labels = [], [], []
widths = {'primary': 14, 'secondary': 12, 'tertiary': 9, 'residential': 6.2, 'service': 3.6, 'cycleway': 2.5, 'steps': 1.8, 'footway': 1.8, 'path': 1.5, 'pedestrian': 3.5}


def emit():
    out.append(part)
    (path_widths if out is paths else street_widths).append(round(width, 1))
    if not name:
        return
    # Store a tangent and anchor on the longest segment, not the mean of multiple roads.
    pairs = zip(part, part[1:])
    a, b = max(pairs, key=lambda edge: math.dist(*edge))
    if math.dist(a, b) > 15:
        labels.append([name, round((a[0] + b[0])/2), round((a[1]+b[1])/2), round(math.atan2(b[1]-a[1],b[0]-a[0]),3)])

classes = {'residential', 'service', 'tertiary', 'secondary', 'primary', 'living_street', 'unclassified', 'pedestrian', 'footway', 'cycleway', 'path', 'steps'}
source = sys.argv[1] if len(sys.argv) > 1 else '.test-output/model-sources/shanghai.osm.pbf'
for o in osmium.FileProcessor(source).with_locations():
    if o.is_node() and o.tags.get('highway') == 'crossing':
        xy = project(o.location.lon, o.location.lat)
        if math.hypot(*xy) <= 5000:
            crossings.append(xy)
    if not o.is_way() or o.tags.get('highway') not in classes or o.tags.get('area') == 'yes' or o.tags.get('tunnel') or o.tags.get('bridge') or o.tags.get('layer', '0') != '0':
        continue
    out = paths if o.tags['highway'] in {'footway', 'cycleway', 'pedestrian', 'path', 'steps'} else streets
    highway = o.tags['highway']
    raw_width = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*(?:m)?', o.tags.get('width', ''))
    raw_lanes = o.tags.get('lanes', '')
    width = float(raw_width[1]) if raw_width else 3.25 * int(raw_lanes) if raw_lanes.isdigit() and int(raw_lanes) else widths.get(highway, 5)
    width = min(36, max(0.8, width))
    name = o.tags.get('name:zh') or o.tags.get('name')
    part = []
    for n in o.nodes:
        xy = project(n.lon, n.lat) if n.location.valid() else None
        if xy is None or math.hypot(*xy) > 5000:
            if len(part) > 1:
                emit()
            part = []
        elif not part or part[-1] != xy:
            part.append(xy)
    if len(part) > 1:
        emit()
result = {'origin': [AREA['lon'], AREA['lat']], 'streets': streets, 'paths': paths, 'crossings': crossings, 'streetWidths':street_widths, 'pathWidths':path_widths, 'labels':labels}
Path('src/ruihe-streets.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf8')
print(len(streets), 'street ways,', len(paths), 'path ways,', len(crossings), 'crossing nodes')

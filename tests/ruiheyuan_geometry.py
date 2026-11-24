"""Check the actual footprint boundary and decoded GLB positions for all three Ruiheyuan ranges."""
import sys, gzip, json, struct
from pathlib import Path
import numpy as np
from pyproj import Geod, Transformer

root=Path(__file__).resolve().parents[1]/'public/models/v1'
geod=Geod(ellps='WGS84');to_merc=Transformer.from_crs(4326,3857,always_xy=True);to_geo=Transformer.from_crs(3857,4326,always_xy=True)
previous=0
for km in (5,8,10):
    path=root/f'ruiheyuan-{km}';meta=json.loads((path/'manifest.json').read_text(encoding='utf-8'))
    lon,lat=(meta['lon'],meta['lat']);assert (lon,lat)==(121.58448422,31.08790789) and meta['radius']==km*1000
    assert meta['centerSource'].endswith('/263343232') and meta['imageDate']=='2026-10-31'
    assert 2*meta['halfWidth']/(meta['gridSize']-1)==30
    ring=np.array(meta['boundary']);ds=geod.inv(np.full(len(ring),lon),np.full(len(ring),lat),ring[:,0],ring[:,1])[2];assert np.max(abs(ds-km*1000))<.02
    X,Y=to_merc.transform(lon,lat);k=np.cos(np.deg2rad(lat));extents=[];faces=0
    for tile in meta['chunks']:
        blob=gzip.decompress((path/tile['file']).read_bytes());magic,version,total,jlength=struct.unpack_from('<4sIII',blob);assert (magic,version,total)==(b'glTF',2,len(blob));spec=json.loads(blob[20:20+jlength]);offset=28+jlength
        pos,ix=spec['accessors'];v=np.frombuffer(blob,dtype='<i2',offset=offset,count=4*pos['count']).reshape(-1,4)[:,:3];n=spec['nodes'][0];xyz=v*np.array(n['scale'])+n['translation'];index=np.frombuffer(blob,dtype='<u2' if ix['componentType']==5123 else '<u4',offset=offset+spec['bufferViews'][1]['byteOffset'],count=ix['count']);assert index.max()<len(v) and len(index)%3==0
        faces+=len(index)//3;gx,gy=to_geo.transform(X+xyz[:,0]/k,Y-xyz[:,2]/k);d=geod.inv(np.full(len(gx),lon),np.full(len(gx),lat),gx,gy)[2];assert d.max()<=km*1000+.4;extents.append(d.max()); assert abs(xyz[:,0].mean()-tile['x'])<3000 and abs(xyz[:,2].mean()-tile['z'])<3000
    assert max(extents)>km*1000-15 and faces==meta['triangles'];pts=sum(meta['counts'].values())-meta['counts'].get('outline',0);assert pts>previous;previous=pts
    print(f'{km} km: {len(meta["chunks"])} meshes, {pts} modeled features, {faces} triangles, most distant vertex {max(extents):.1f} m')

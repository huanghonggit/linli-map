import * as T from 'three';

// Ground-following cartographic marks. Width and color are symbols, not surveyed road surfaces.
export function streetLayer(data, ground) {
  const group = new T.Group();
  function lines(ways, color, opacity) {
    const vertices = [];
    for (const way of ways) {
      for (let i = 1; i < way.length; i++) {
        const [x, z] = way[i - 1], [ex, ez] = way[i];
        const count = Math.ceil(Math.hypot(ex - x, ez - z) / 24);
        for (let j = 0; j < count; j++) {
          for (const fraction of [j / count, (j + 1) / count]) {
            const px = x + fraction * (ex - x), pz = z + fraction * (ez - z);
            vertices.push(px, ground(px, pz) + 1, pz);
          }
        }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    group.add(new T.LineSegments(geo, new T.LineBasicMaterial({color, transparent:true, opacity, depthWrite:false})));
  }
  lines(data.streets, 0xffdc83, 0.83);
  lines(data.paths, 0xc7fbe0, 0.88);
  const geo = new T.BufferGeometry();
  const points = data.crossings.flatMap(([x,z]) => [x, ground(x,z) + 1.4, z]);
  geo.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  group.add(new T.Points(geo, new T.PointsMaterial({ color:0xffffff, size:5, sizeAttenuation:false })));
  return group;
}

// Pure binary glTF building decoder + facade vertical-limits precomputation.
// Runs identically inside Web Workers and as a main-thread fallback.

export async function gunzipBuffer(buffer) {
  const magic = new Uint8Array(buffer, 0, 2);
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return buffer;
  return new Response(
    new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
}

export function decodeBuildingBuffers(buffer) {
  const header = new DataView(buffer);
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2
  ) {
    throw Error("建筑文件格式错误");
  }
  const jsonLength = header.getUint32(12, true);
  const spec = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  );
  const binary = 28 + jsonLength;
  const [positions, indices] = spec.accessors;
  const packed = new Int16Array(buffer, binary, positions.count * 4);
  const node = spec.nodes[0];
  const [ox, oy, oz] = node.translation || [0, 0, 0];
  const [sx, sy, sz] = node.scale;

  const xyz = new Float32Array(positions.count * 3);
  for (let n = 0; n < positions.count; n++) {
    xyz[n * 3] = ox + packed[n * 4] * sx;
    xyz[n * 3 + 1] = oy + packed[n * 4 + 1] * sy;
    xyz[n * 3 + 2] = oz + packed[n * 4 + 2] * sz;
  }

  const indexView = spec.bufferViews[1];
  const Index = indices.componentType === 5123 ? Uint16Array : Uint32Array;
  const indexSlice = new Index(
    buffer,
    binary + indexView.byteOffset,
    indices.count,
  );
  // Copy into standalone TypedArray so the original decompressed buffer can be GC'd / transferred cleanly.
  const indexArray = new Index(indexSlice);

  // Precompute vertical wall limits [baseY, roofY] per vertex for photorealistic procedural facades.
  const limits = new Float32Array(positions.count * 2);
  const filled = new Uint8Array(positions.count);
  for (let i = 0; i < indexArray.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indexArray[i + k];
      const b = indexArray[i + ((k + 1) % 3)];
      const ax = xyz[a * 3], ay = xyz[a * 3 + 1], az = xyz[a * 3 + 2];
      const bx = xyz[b * 3], by = xyz[b * 3 + 1], bz = xyz[b * 3 + 2];
      if (ax !== bx || az !== bz || ay === by) continue;
      const lo = ay < by ? ay : by;
      const hi = ay > by ? ay : by;
      if (!filled[a] || hi - lo > limits[a * 2 + 1] - limits[a * 2]) {
        limits[a * 2] = lo;
        limits[a * 2 + 1] = hi;
        filled[a] = 1;
      }
      if (!filled[b] || hi - lo > limits[b * 2 + 1] - limits[b * 2]) {
        limits[b * 2] = lo;
        limits[b * 2 + 1] = hi;
        filled[b] = 1;
      }
    }
  }
  // Roof vertices that don't share an upright edge (e.g. pitched roof peaks or interior triangles) inherit neighbor height.
  for (let i = 0; i < indexArray.length; i += 3) {
    const a = indexArray[i], b = indexArray[i + 1], c = indexArray[i + 2];
    const ref = filled[a] ? a : filled[b] ? b : filled[c] ? c : -1;
    if (ref < 0) continue;
    const lo = limits[ref * 2], hi = limits[ref * 2 + 1];
    for (const v of [a, b, c]) {
      if (!filled[v]) {
        limits[v * 2] = lo;
        limits[v * 2 + 1] = Math.max(hi, xyz[v * 3 + 1]);
        filled[v] = 1;
      }
    }
  }
  for (let v = 0; v < positions.count; v++) {
    if (!filled[v]) {
      const y = xyz[v * 3 + 1];
      limits[v * 2] = y - 6;
      limits[v * 2 + 1] = y;
    }
  }

  return { positions: xyz, indices: indexArray, limits };
}

import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { wgs84ToGcj02, gcj02ToWgs84, meters } from "../src/geo.js";
import { gunzipBuffer, decodeBuildingBuffers } from "../src/map/meshDecoder.js";

test("WGS-84 <-> GCJ-02 round-trip achieves sub-decimetre accuracy in China and is identity outside China", () => {
  const shanghai = { lat: 31.08790789, lon: 121.58448422 };
  const gcj = wgs84ToGcj02(shanghai);
  // GCJ-02 offset in Shanghai is typically ~400-600 metres
  const offsetDist = meters(shanghai, gcj);
  assert.ok(offsetDist > 200 && offsetDist < 900, `unexpected offset ${offsetDist}`);

  const back = gcj02ToWgs84(gcj);
  const err = meters(shanghai, back);
  assert.ok(err < 0.05, `round-trip error too large: ${err}m`);

  const london = { lat: 51.5074, lon: -0.1278 };
  assert.deepEqual(wgs84ToGcj02(london), london);
  assert.deepEqual(gcj02ToWgs84(london), london);
});

test("meshDecoder unpacks gzipped quantized glTF and computes vertical building facade limits", async () => {
  // Construct a minimal 1-box quantized glTF (4 bottom + 4 top vertices, scale [0.25, 0.1, 0.25])
  const coords = [
    [0, 0, 0, 0],
    [40, 0, 0, 0],
    [40, 0, 40, 0],
    [0, 0, 40, 0],
    [0, 120, 0, 0], // height = 12.0m
    [40, 120, 0, 0],
    [40, 120, 40, 0],
    [0, 120, 40, 0],
  ];
  const posArr = new Int16Array(coords.flat());
  const idxArr = new Uint16Array([
    4, 5, 6, 4, 6, 7, // roof
    0, 1, 5, 0, 5, 4, // side 1
    1, 2, 6, 1, 6, 5, // side 2
    2, 3, 7, 2, 7, 6, // side 3
    3, 0, 4, 3, 4, 7, // side 4
  ]);
  const rawPos = Buffer.from(posArr.buffer);
  const rawIdx = Buffer.from(idxArr.buffer);
  const binPad = (4 - ((rawPos.length + rawIdx.length) % 4)) % 4;
  const bin = Buffer.concat([rawPos, rawIdx, Buffer.alloc(binPad)]);
  const spec = {
    asset: { version: "2.0" },
    nodes: [{ mesh: 0, scale: [0.25, 0.1, 0.25], translation: [100, 0, -50] }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: rawPos.length },
      { buffer: 0, byteOffset: rawPos.length, byteLength: rawIdx.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5122, count: 8, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: idxArr.length, type: "SCALAR" },
    ],
  };
  let jsonBuf = Buffer.from(JSON.stringify(spec));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const total = 28 + jsonBuf.length + bin.length;
  const glb = Buffer.alloc(total);
  glb.write("glTF", 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonBuf.length, 12);
  glb.write("JSON", 16);
  jsonBuf.copy(glb, 20);
  glb.writeUInt32LE(bin.length, 20 + jsonBuf.length);
  glb.write("BIN\0", 24 + jsonBuf.length);
  bin.copy(glb, 28 + jsonBuf.length);

  const gz = gzipSync(glb);
  const unpacked = await gunzipBuffer(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
  const decoded = decodeBuildingBuffers(unpacked);

  assert.equal(decoded.positions.length, 8 * 3);
  assert.equal(decoded.positions[0], 100);
  assert.equal(decoded.positions[4 * 3 + 1], 12);
  assert.equal(decoded.limits.length, 8 * 2);
  // Every vertex of the 12m building should carry limits [0, 12]
  for (let i = 0; i < 8; i++) {
    assert.equal(decoded.limits[i * 2], 0);
    assert.equal(decoded.limits[i * 2 + 1], 12);
  }
});

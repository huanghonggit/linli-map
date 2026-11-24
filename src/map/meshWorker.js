import { gunzipBuffer, decodeBuildingBuffers } from "./meshDecoder.js";

self.onmessage = async (event) => {
  const { id, buffer } = event.data;
  try {
    const raw = await gunzipBuffer(buffer);
    const decoded = decodeBuildingBuffers(raw);
    self.postMessage(
      {
        id,
        ok: true,
        positions: decoded.positions,
        indices: decoded.indices,
        limits: decoded.limits,
      },
      [
        decoded.positions.buffer,
        decoded.indices.buffer,
        decoded.limits.buffer,
      ],
    );
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || "建筑解码失败",
    });
  }
};

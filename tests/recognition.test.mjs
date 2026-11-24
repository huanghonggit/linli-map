import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  featured,
  inRange,
  readIndex,
  sortedCards,
  turnJunction,
  nearbyStore,
  publicPanoUrl,
} from "../src/recognition/places.js";
const raw = JSON.parse(
  readFileSync(
    new URL("../public/recognition/ruihe-index.json", import.meta.url),
  ),
);
const all = readIndex(raw);
test("each displayed intersection and store has a unique identifier", () =>
  assert.equal(new Set(all.map((p) => p.id)).size, all.length));
test("storefront photos and local OSM names merge without listing the same storefront twice", () => {
  assert.equal(all.filter((p) => p.name === "吉祥里生鲜超市").length, 1);
  const list = sortedCards(
    inRange(all, { lon: 121.58448422, lat: 31.08790789 }, 5),
    "shop",
    "",
    true,
  );
  assert.equal(list.length, 4);
  assert.ok(list.every((p) => p.photo.startsWith("https:") && p.address));
  assert.ok(!sortedCards(list, "shop", "不存在的店名", false).length);
});
test("street confirmation uses the turn coordinates and never invents an intersecting street", () => {
  const junction = featured.find((p) => p.id === "cross:9836149178");
  assert.equal(turnJunction(junction).id, junction.id);
  assert.equal(turnJunction({ ...junction, lat: junction.lat + 0.003 }), null);
  assert.equal(turnJunction({ text: "向右转" }), null);
  assert.ok(nearbyStore(junction)?.label.includes("距路口约"));
  const url = new URL(publicPanoUrl(junction.pano));
  assert.equal(url.hostname, "map.baidu.com");
  assert.ok(url.hash.includes(junction.pano.pid));
});

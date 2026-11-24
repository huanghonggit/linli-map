import test from "node:test";
import assert from "node:assert/strict";
import {
  offset,
  meters,
  measureRoute,
  makeGrid,
  direction,
  areaFor,
  zoneName,
  snapToRoute,
  pointAhead,
  newTracker,
  navigationFix,
} from "../src/geo.js";
import { loadSettings } from "../src/services.js";
const start = { lat: 30.25186, lon: 120.1557 };
const coords = [start, offset(start, 0, 250), offset(start, 180, 250)];
const route = {
  coords,
  cumulative: measureRoute(coords),
  steps: [
    { at: 0, text: "出发" },
    { at: 250, text: "右转" },
    { at: 430, text: "到达" },
  ],
};
const fix = (east, north, sec, accuracy = 6) => ({
  ...offset(start, east, north),
  time: sec * 1000,
  accuracy,
});

test("a midpoint on a long segment stays on route", () => {
  const p = snapToRoute(offset(start, 0, 120), coords, route.cumulative);
  assert.ok(p.distance < 1);
  assert.ok(Math.abs(p.progress - 120) < 1);
});
test("one drifting fix does not alarm, two independent good fixes do", () => {
  const t = newTracker();
  assert.equal(navigationFix(route, fix(65, 80, 1), t).alarm, false);
  const b = navigationFix(route, fix(69, 82, 3), t);
  assert.equal(b.state, "offroute");
  assert.equal(b.alarm, true);
  assert.equal(navigationFix(route, fix(65, 85, 6), t).alarm, false);
  assert.equal(navigationFix(route, fix(68, 92, 29), t).alarm, true);
});
test("noisy GPS interrupts the consecutive-fix counter", () => {
  const t = newTracker();
  navigationFix(route, fix(90, 40, 1), t);
  assert.equal(navigationFix(route, fix(100, 50, 2, 110), t).state, "weak");
  assert.equal(navigationFix(route, fix(75, 55, 3), t).alarm, false);
  assert.equal(navigationFix(route, fix(0, 60, 4), t).state, "onroute");
});
test("arrival needs two fixes close to the route end", () => {
  const t = newTracker();
  const end = (sec) => ({ ...coords[2], accuracy: 6, time: sec * 1000 });
  assert.notEqual(navigationFix(route, end(1), t).state, "arrived");
  assert.equal(navigationFix(route, end(3), t).state, "arrived");
});
test("a point on a parallel street cannot trigger arrival", () => {
  const t = newTracker();
  for (const time of [1, 2])
    assert.notEqual(
      navigationFix(route, fix(180, 355, time), t).state,
      "arrived",
    );
});
test("heading zero is valid and the look-ahead follows the next segment", () => {
  const t = newTracker();
  const out = navigationFix(route, { ...fix(0, 240, 1), heading: 0 }, t);
  assert.equal(out.heading, 0);
  assert.ok(meters(pointAhead(route, 275), offset(start, 25, 250)) < 1);
  assert.equal(direction(90), "东");
});
test("the ring and region labels use the selected center and radius", () => {
  const grid = makeGrid(start, 10000);
  assert.equal(grid.length, 5);
  assert.ok(Math.abs(meters(start, grid[0][0]) - 10000) < 2);
  assert.equal(
    zoneName(areaFor(offset(start, -6000, 6000), start, 10000)),
    "西北",
  );
  assert.equal(zoneName(areaFor(start, start, 10000)), "中心");
});
test("damaged or missing local settings restore the usable example", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => "{broken" },
      configurable: true,
    });
    assert.equal(loadSettings().center.id, "example-hubin");
  } finally {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else delete globalThis.localStorage;
  }
});

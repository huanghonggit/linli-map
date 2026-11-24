import test from "node:test";
import assert from "node:assert/strict";
import { locate } from "../src/services.js";

async function withLocation(getCurrentPosition, run) {
  const saved = new Map(
    ["window", "navigator"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { isSecureContext: true },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { geolocation: { getCurrentPosition } },
    });
    await run();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
const fix = (accuracy, age = 0) => ({
  coords: { latitude: 31.23, longitude: 121.47, accuracy },
  timestamp: Date.now() - age,
});
test("a recent accurate device fix opens the center selector immediately", async () => {
  const requests = [];
  await withLocation(
    (ok, err, opts) => {
      requests.push(opts.enableHighAccuracy);
      ok(fix(12, 7500));
    },
    async () => {
      assert.equal((await locate({ forCenter: true })).accuracy, 12);
      assert.deepEqual(requests, [false]);
    },
  );
});
test("coarse or stale center fixes request a more precise result, and permission denial stops attempts", async () => {
  for (const [acc, age] of [
    [450, 0],
    [12, 360000],
  ]) {
    const calls = [];
    await withLocation(
      (ok, no, opt) => {
        calls.push(opt.enableHighAccuracy);
        ok(opt.enableHighAccuracy ? fix(9) : fix(acc, age));
      },
      async () => {
        assert.equal((await locate({ forCenter: true })).accuracy, 9);
        assert.deepEqual(calls, [false, true]);
      },
    );
  }
  let count = 0;
  await withLocation(
    (ok, err) => {
      count++;
      err({ code: 1 });
    },
    async () => {
      await assert.rejects(locate({ forCenter: true }), /定位权限/);
      assert.equal(count, 1);
    },
  );
});
test("navigation requests a recent high accuracy position; leaving the screen cancels a pending request", async () => {
  await withLocation(
    (ok, e, o) => {
      assert.equal(o.enableHighAccuracy, true);
      ok(fix(7, 60000));
    },
    async () => {
      await assert.rejects(locate(), /过期/);
    },
  );
  await withLocation(
    () => {},
    async () => {
      const c = new AbortController();
      const task = locate({ forCenter: true, signal: c.signal });
      c.abort();
      await assert.rejects(task, { name: "AbortError" });
    },
  );
});

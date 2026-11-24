import { turnJunction } from "./recognition/places.js";
import { useEffect, useRef, useState } from "react";
import {
  locate,
  fromGPS,
  gpsProblem,
  beep,
  speak,
  enableAudio,
  quiet,
  getRoute,
} from "./services.js";
import { meters, navigationFix, newTracker, distanceText } from "./geo.js";
const empty = {
  phase: "idle",
  route: null,
  target: null,
  mode: "foot",
  fix: null,
  guide: null,
  error: "",
  origin: "center",
};
export function useNavigation(center, voice, mapRef) {
  const [state, set] = useState(empty),
    control = useRef(null),
    watch = useRef(null),
    lock = useRef(null),
    token = useRef(0),
    voiceRef = useRef(voice),
    visibleWatch = useRef(false);
  voiceRef.current = voice;
  async function keepAwake() {
    if (
      !visibleWatch.current ||
      document.visibilityState !== "visible" ||
      !navigator.wakeLock
    )
      return;
    try {
      const acquired = await navigator.wakeLock.request("screen");
      if (visibleWatch.current) {
        lock.current = acquired;
      } else await acquired.release();
    } catch {
      /* platform may decline */
    }
  }
  function clear() {
    token.current++;
    control.current?.abort();
    control.current = null;
    if (watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
    visibleWatch.current = false;
    lock.current?.release().catch(() => {});
    lock.current = null;
    quiet();
  }
  function end() {
    clear();
    set(empty);
  }
  useEffect(() => {
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      document.removeEventListener("visibilitychange", keepAwake);
      clear();
    };
  }, []);
  async function plan(target, mode = "foot") {
    clear();
    const id = token.current;
    control.current = new AbortController();
    set({ ...empty, phase: "loading", target, mode });
    if (meters(center, target) < 18) {
      set({ ...empty, phase: "preview", target, mode });
      return;
    }
    try {
      const route = await getRoute(
        center,
        target,
        mode,
        control.current.signal,
      );
      if (id !== token.current) return;
      set({ ...empty, phase: "preview", target, mode, route });
      mapRef.current?.fitRoute(route.coords);
    } catch (e) {
      if (id === token.current)
        set({ ...empty, phase: "preview", target, mode, error: e.message });
    }
  }
  async function start(target = state.target, mode = state.mode) {
    enableAudio();
    clear();
    const id = token.current;
    control.current = new AbortController();
    set((prev) => ({
      ...prev,
      target,
      mode,
      phase: "locating",
      guide: null,
      fix: null,
      error: "",
      origin: "gps",
      route: null,
    }));
    try {
      const initial = await locate({ signal: control.current.signal });
      if (id !== token.current) return;
      if (initial.accuracy > 45)
        throw Error(
          `目前定位误差约 ${Math.round(initial.accuracy)} 米，请到开阔处再试。`,
        );
      if (meters(initial, target) < 18) {
        set({
          ...empty,
          target,
          mode,
          phase: "arrived",
          fix: initial,
          origin: "gps",
        });
        if (voiceRef.current) speak("您已在目的地附近");
        return;
      }
      set((prev) => ({ ...prev, fix: initial, phase: "routing" }));
      const route = await getRoute(
        initial,
        target,
        mode,
        control.current.signal,
      );
      if (id !== token.current) return;
      const tracker = newTracker();
      let lastStep = "";
      let lastTravel = 0;
      const process = (fix) => {
        if (id !== token.current) return;
        if (fix.time <= tracker.lastTime) return;
        const guide = navigationFix(route, fix, tracker);
        if (guide.alarm) {
          beep();
          navigator.vibrate?.([150, 100, 150]);
          if (voiceRef.current)
            speak("您可能走偏了。请停在安全的地方，查看路线。");
        }
        if (guide.state === "arrived") {
          clear();
          if (voiceRef.current) speak("已到达目的地附近，请留意入口。");
          set({
            ...empty,
            phase: "arrived",
            target,
            mode,
            route,
            fix,
            guide,
            origin: "gps",
          });
          return;
        }
        if (
          guide.state === "onroute" &&
          guide.next &&
          guide.turnDistance < 65
        ) {
          const key = guide.next.text + guide.next.at;
          if (lastStep !== key) {
            lastStep = key;
            if (voiceRef.current)
              speak(
                [
                  `${distanceText(guide.turnDistance)}后`,
                  turnJunction(guide.next)?.name,
                  guide.next.text,
                ]
                  .filter(Boolean)
                  .join("，"),
              );
          }
        }
        if (
          guide.state !== "weak" &&
          (!lastTravel || meters(fix, lastTravel) > 35)
        ) {
          lastTravel = fix;
          mapRef.current?.focus(fix, 480);
        }
        set({
          ...empty,
          phase: "running",
          target,
          mode,
          route,
          fix: guide.state === "weak" ? tracker.lastGood : fix,
          guide,
          origin: "gps",
        });
      };
      visibleWatch.current = true;
      keepAwake();
      if (voiceRef.current)
        speak(
          `开始${mode === "bike" ? "骑行" : "步行"}导航，前往${target.name}`,
        );
      process(initial);
      watch.current = navigator.geolocation.watchPosition(
        (p) => process(fromGPS(p)),
        (e) => {
          if (id !== token.current) return;
          if (e.code === 1) {
            clear();
            set({
              ...empty,
              phase: "preview",
              target,
              mode,
              origin: "gps",
              error: gpsProblem(e),
            });
          } else {
            tracker.outside = 0;
            tracker.arrival = 0;
            set((prev) => ({
              ...prev,
              guide: { state: "weak" },
              error: gpsProblem(e),
            }));
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch (e) {
      if (id === token.current) {
        clear();
        set({
          ...empty,
          phase: "preview",
          target,
          mode,
          error: e.message,
          origin: "gps",
        });
      }
    }
  }
  return { ...state, plan, start, end };
}

// Cross-platform bridge for Web & Capacitor Android native capabilities.
// Dynamically accesses Capacitor plugins when running inside the Android shell,
// while keeping zero overhead and 100% compatibility in standard browsers & unit tests.

export function getCapacitor() {
  return typeof window !== "undefined" ? window.Capacitor || null : null;
}

export function isNativeApp() {
  try {
    const cap = getCapacitor();
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function getClientPlatform() {
  try {
    const cap = getCapacitor();
    if (cap?.isNativePlatform?.()) {
      return `${cap.getPlatform?.() || "android"}-app`;
    }
  } catch {
    /* ignore */
  }
  return "web";
}

export async function prefGet(key) {
  try {
    const prefs = getCapacitor()?.Plugins?.Preferences;
    if (prefs) {
      const res = await prefs.get({ key });
      if (res?.value !== null && res?.value !== undefined) return res.value;
    }
  } catch {
    /* fall back to localStorage */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function prefSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  try {
    const prefs = getCapacitor()?.Plugins?.Preferences;
    if (prefs) await prefs.set({ key, value: String(value) });
  } catch {
    /* ignore */
  }
}

export async function prefRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    const prefs = getCapacitor()?.Plugins?.Preferences;
    if (prefs) await prefs.remove({ key });
  } catch {
    /* ignore */
  }
}

export async function getNativeGeoPosition(options) {
  const geo = getCapacitor()?.Plugins?.Geolocation;
  if (!isNativeApp() || !geo) return null;
  try {
    const perms = await geo.checkPermissions();
    if (perms?.location !== "granted" && perms?.coarseLocation !== "granted") {
      const asked = await geo.requestPermissions();
      if (asked?.location !== "granted" && asked?.coarseLocation !== "granted") {
        const err = new Error("定位权限已关闭");
        err.code = 1;
        throw err;
      }
    }
    return await geo.getCurrentPosition({
      enableHighAccuracy: Boolean(options?.enableHighAccuracy),
      timeout: options?.timeout || 13500,
      maximumAge: options?.maximumAge || 0,
    });
  } catch (err) {
    if (err?.code === 1) throw err;
    return null;
  }
}

export function initNativeShell({ onBackButton } = {}) {
  if (!isNativeApp()) return () => {};
  const cleanups = [];
  const cap = getCapacitor();
  try {
    const statusBar = cap?.Plugins?.StatusBar;
    statusBar?.setBackgroundColor?.({ color: "#fffefa" }).catch?.(() => {});
    statusBar?.setStyle?.({ style: "LIGHT" }).catch?.(() => {});
  } catch {
    /* ignore */
  }
  try {
    const splash = cap?.Plugins?.SplashScreen;
    splash?.hide?.().catch?.(() => {});
  } catch {
    /* ignore */
  }
  try {
    const appPlugin = cap?.Plugins?.App;
    if (appPlugin?.addListener && onBackButton) {
      const handlePromise = appPlugin.addListener("backButton", ({ canGoBack }) => {
        const handled = onBackButton();
        if (!handled) {
          if (canGoBack) window.history.back();
          else appPlugin.exitApp?.();
        }
      });
      cleanups.push(() => {
        Promise.resolve(handlePromise)
          .then((h) => h?.remove?.())
          .catch(() => {});
      });
    }
  } catch {
    /* ignore */
  }
  return () => {
    for (const fn of cleanups) fn();
  };
}

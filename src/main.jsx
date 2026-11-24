import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { isNativeApp } from "./platform/native.js";

createRoot(document.getElementById("root")).render(<App />);

if (
  !isNativeApp() &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  window.isSecureContext
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

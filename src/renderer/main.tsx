// Polyfill crypto.randomUUID for non-secure contexts (plain HTTP)
// Must run before any other imports that might use it
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = function () {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] & 0x0f
      const v = c === "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    }) as `${string}-${string}-${string}-${string}-${string}`
  }
}

import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { consoleStore } from "./stores/ConsoleStore"
import { httpBackend } from "./backend/http"
import "../../src/styles/globals.css"

// In a browser (not Tauri), forward captured errors to the server log so a
// mobile crash is readable off-device.
if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  consoleStore.setRemoteSink((entry) => {
    httpBackend.logClient(entry.level, entry.message)
  })
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

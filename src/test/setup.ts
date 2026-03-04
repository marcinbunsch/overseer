import { vi } from "vitest"
import "@testing-library/jest-dom/vitest"

// Set __TAURI_INTERNALS__ to make backend use tauriBackend (which we mock)
// This must be set before any imports that check for Tauri
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__TAURI_INTERNALS__ = {}
// Set on window only if it exists (jsdom environment)
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__TAURI_INTERNALS__ = {}
}

// Mock Tauri core API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

// Mock Tauri event API
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(),
}))

// Mock Tauri path API
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => Promise.resolve("/home/testuser")),
}))

// Mock Tauri FS plugin
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(false)),
  mkdir: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
}))

// Mock Tauri OS plugin
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}))

// Mock Tauri app API
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.1.2")),
}))

// Mock Tauri updater plugin
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}))

// Mock Tauri process plugin
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(() => Promise.resolve()),
}))

// Native/desktop packages (tauri-pty, xterm, etc.) are aliased in vite.config.ts
// to stub modules under src/test/mocks/, so no vi.mock() needed here.

// Mock localStorage
const localStorageMock: Record<string, string> = {}
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock[key]
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(localStorageMock)) {
      delete localStorageMock[key]
    }
  }),
})

// Mock crypto.randomUUID
let uuidCounter = 0
vi.stubGlobal("crypto", {
  randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
})

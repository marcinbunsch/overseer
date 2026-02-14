import { vi } from "vitest"
import "@testing-library/jest-dom/vitest"

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

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

type MediaListener = (event: MediaQueryListEvent) => void

// Installs a controllable matchMedia so we can flip the "OS" theme at runtime.
function installMatchMedia(prefersDark: boolean) {
  const listeners = new Set<MediaListener>()
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, cb: MediaListener) => listeners.add(cb),
    removeEventListener: (_type: string, cb: MediaListener) => listeners.delete(cb),
  }
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql)
  )
  return {
    emit(matches: boolean) {
      mql.matches = matches
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent))
    },
    listenerCount: () => listeners.size,
  }
}

async function loadFresh(prefersDark: boolean) {
  const media = installMatchMedia(prefersDark)
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_home_dir") return Promise.resolve("/home/testuser")
    if (cmd === "config_file_exists") return Promise.resolve(true)
    if (cmd === "load_json_config") return Promise.resolve({ claudePath: "claude" })
    return Promise.resolve(undefined)
  })

  vi.resetModules()
  const { configStore } = await import("../../stores/ConfigStore")
  await vi.waitFor(() => {
    expect(configStore.loaded).toBe(true)
  })
  const { themeController } = await import("../themeController")
  return { media, configStore, themeController }
}

describe("ThemeController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.removeAttribute("data-theme")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("auto preference + OS dark resolves to dark", async () => {
    const { configStore, themeController } = await loadFresh(true)
    configStore.themePreference = "auto"

    themeController.init()

    expect(themeController.effectiveTheme).toBe("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    themeController.dispose()
  })

  it("auto preference + OS light resolves to light", async () => {
    const { configStore, themeController } = await loadFresh(false)
    configStore.themePreference = "auto"

    themeController.init()

    expect(themeController.effectiveTheme).toBe("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    themeController.dispose()
  })

  it("explicit light preference overrides an OS dark setting", async () => {
    const { configStore, themeController } = await loadFresh(true)

    themeController.init()
    configStore.themePreference = "light"

    expect(themeController.effectiveTheme).toBe("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    themeController.dispose()
  })

  it("follows OS changes at runtime when set to auto", async () => {
    const { configStore, media, themeController } = await loadFresh(true)
    configStore.themePreference = "auto"

    themeController.init()
    expect(document.documentElement.dataset.theme).toBe("dark")

    media.emit(false)

    expect(themeController.effectiveTheme).toBe("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    themeController.dispose()
  })

  it("ignores OS changes when a concrete theme is chosen", async () => {
    const { configStore, media, themeController } = await loadFresh(true)
    configStore.themePreference = "dark"

    themeController.init()
    media.emit(false)

    expect(themeController.effectiveTheme).toBe("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    themeController.dispose()
  })

  it("dispose removes the OS media listener", async () => {
    const { media, themeController } = await loadFresh(true)

    themeController.init()
    expect(media.listenerCount()).toBe(1)

    themeController.dispose()
    expect(media.listenerCount()).toBe(0)
  })
})

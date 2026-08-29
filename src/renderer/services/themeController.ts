import { observable, computed, action, makeObservable, autorun } from "mobx"
import { configStore } from "../stores/ConfigStore"
import { terminalService } from "./terminal"

export type EffectiveTheme = "light" | "dark"

/**
 * Resolves the user's theme preference (auto/light/dark) into a concrete
 * light or dark theme and applies it everywhere:
 *   - sets `data-theme` on <html>, which flips the CSS variables in theme.css
 *   - updates every live terminal via terminalService
 *
 * For "auto" it follows the OS setting and reacts to OS changes at runtime.
 * `effectiveTheme` is observable so React components that need the concrete
 * theme (e.g. code highlighting) can read it directly.
 */
class ThemeController {
  // OS preference. Defaults to dark so the app keeps its original look before
  // matchMedia is read (and in environments without matchMedia, e.g. tests).
  @observable private systemPrefersDark: boolean = true

  private mediaQuery: MediaQueryList | null = null
  private disposeAutorun: (() => void) | null = null

  constructor() {
    makeObservable(this)
  }

  @computed get effectiveTheme(): EffectiveTheme {
    const preference = configStore.themePreference
    if (preference === "light") return "light"
    if (preference === "dark") return "dark"
    return this.systemPrefersDark ? "dark" : "light"
  }

  /**
   * Start watching the OS theme and applying the effective theme. Call once at
   * app boot. Safe to skip in environments without matchMedia (web/tests),
   * where the effective theme still falls back to the saved preference.
   */
  init(): void {
    const canMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function"
    if (canMatchMedia) {
      this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      this.setSystemPrefersDark(this.mediaQuery.matches)
      this.mediaQuery.addEventListener("change", this.onSystemThemeChange)
    }
    // Re-applies whenever the preference or the OS setting changes.
    this.disposeAutorun = autorun(() => this.applyTheme(this.effectiveTheme))
  }

  private onSystemThemeChange = (event: MediaQueryListEvent): void => {
    this.setSystemPrefersDark(event.matches)
  }

  @action private setSystemPrefersDark(prefersDark: boolean): void {
    this.systemPrefersDark = prefersDark
  }

  private applyTheme(theme: EffectiveTheme): void {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme
    }
    terminalService.setTheme(theme)
  }

  dispose(): void {
    this.mediaQuery?.removeEventListener("change", this.onSystemThemeChange)
    this.disposeAutorun?.()
    this.mediaQuery = null
    this.disposeAutorun = null
  }
}

export const themeController = new ThemeController()

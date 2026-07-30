import { platform } from "@tauri-apps/plugin-os"

// navigator.userAgentData is not in the DOM lib yet; declare the one field we read.
declare global {
  interface Navigator {
    userAgentData?: { platform?: string }
  }
}

// Computed lazily (not at import) so Tauri's OS plugin is ready, then memoized.
let _isMacOS: boolean | null = null

export function isMacOS(): boolean {
  if (_isMacOS === null) {
    try {
      _isMacOS = platform() === "macos"
    } catch {
      // Web mode (pnpm vite-dev) / plugin unavailable: fall back to browser detection so
      // Mac-only shortcuts still work instead of silently treating the platform as non-mac.
      const hint =
        navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent ?? ""
      _isMacOS = /mac|iphone|ipad|ipod/i.test(hint)
    }
  }
  return _isMacOS
}

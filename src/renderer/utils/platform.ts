import { platform } from "@tauri-apps/plugin-os"

// Computed lazily (not at import) so Tauri's OS plugin is ready, then memoized.
// platform() throws in web mode, where it's treated as non-macOS.
let _isMacOS: boolean | null = null

export function isMacOS(): boolean {
  if (_isMacOS === null) {
    try {
      _isMacOS = platform() === "macos"
    } catch {
      _isMacOS = false
    }
  }
  return _isMacOS
}

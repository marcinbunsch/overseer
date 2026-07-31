/**
 * Notification service — plays sounds and sends OS notifications on agent completion.
 *
 * Sound: Web Audio API synthesized two-tone chime (no assets needed).
 * OS notification: Tauri notification plugin (requires permission).
 */

export function playCompletionSound(): void {
  const AudioCtx =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!AudioCtx) return

  const ctx = new AudioCtx()
  console.log(`[notifications] AudioContext state before resume: ${ctx.state}`)
  void ctx
    .resume()
    .then(() => {
      console.log(`[notifications] AudioContext state after resume: ${ctx.state}`)
    })
    .catch((err) => {
      console.warn("[notifications] AudioContext resume failed:", err)
    })
  const now = ctx.currentTime

  // Two-tone chime: high then slightly lower, soft and short
  const notes = [880, 660] // A5 then E5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    osc.frequency.value = freq
    const startTime = now + i * 0.18
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)
    osc.start(startTime)
    osc.stop(startTime + 0.35)
  })

  // Clean up the context after sounds finish
  setTimeout(() => ctx.close(), 1200)
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification")
    let granted = await isPermissionGranted()
    if (!granted) {
      const permission = await requestPermission()
      granted = permission === "granted"
    }
    return granted
  } catch {
    return false
  }
}

export async function sendSystemNotification(
  label: string,
  workspaceId: string,
  chatId: string
): Promise<void> {
  // Post through the Rust `send_completion_notification` command rather than the
  // notification plugin: on macOS the plugin never reports clicks back to JS, so the
  // Rust side posts natively and emits a `notification://clicked` event on click
  // (see initNotificationClickHandler).
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    console.log(`[notifications] Sending OS notification for: ${label}`)
    await invoke("send_completion_notification", {
      title: "Overseer",
      body: `Task complete in ${label}`,
      workspaceId,
      chatId,
    })
  } catch (err) {
    console.warn("[notifications] System notification unavailable:", err)
  }
}

/**
 * Set up the notification click handler. Call once at app startup.
 * Returns an unsubscribe function.
 *
 * The Rust side already shows and focuses the window on click; this listener only
 * navigates the frontend to the chat that finished.
 */
export async function initNotificationClickHandler(
  onNavigate: (workspaceId: string, chatId: string) => void
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")

  const unlisten = await listen<{ workspaceId?: string; chatId?: string }>(
    "notification://clicked",
    (event) => {
      const { workspaceId, chatId } = event.payload
      if (typeof workspaceId === "string" && typeof chatId === "string") {
        onNavigate(workspaceId, chatId)
      }
    }
  )

  return () => unlisten()
}

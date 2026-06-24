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
  workspaceName: string,
  workspaceId: string,
  chatId: string
): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification")

    let granted = await isPermissionGranted()
    console.log(`[notifications] Permission granted: ${granted}`)
    if (!granted) {
      const permission = await requestPermission()
      granted = permission === "granted"
      console.log(`[notifications] Permission after request: ${permission}`)
    }
    if (!granted) {
      console.log("[notifications] Permission denied — skipping notification")
      return
    }

    console.log(`[notifications] Sending OS notification for workspace: ${workspaceName}`)
    sendNotification({
      title: "Overseer",
      body: `Task complete in ${workspaceName}`,
      extra: { workspaceId, chatId },
    })
  } catch (err) {
    console.warn("[notifications] System notification unavailable:", err)
  }
}

/**
 * Set up the notification click handler. Call once at app startup.
 * Returns an unsubscribe function.
 */
export async function initNotificationClickHandler(
  onNavigate: (workspaceId: string, chatId: string) => void
): Promise<() => void> {
  const { onAction } = await import("@tauri-apps/plugin-notification")
  const { invoke } = await import("@tauri-apps/api/core")

  const listener = await onAction((notification) => {
    const extra = notification.extra
    if (extra && typeof extra.workspaceId === "string" && typeof extra.chatId === "string") {
      void invoke("show_main_window")
      onNavigate(extra.workspaceId, extra.chatId)
    }
  })

  return () => void listener.unregister()
}

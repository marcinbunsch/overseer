# Notification click routing (native, no CPU burn)

Status: **planned, not started.** This picks up after commit `c2e6dc7`.

## Context — why we're doing this

Overseer shows a "task complete" OS notification when an agent finishes and you're
not watching. We want clicking that notification to **focus the window and open the
exact workspace/chat that finished**.

We had this working (PR #24, commit `6813bb5`) by posting through `mac-notification-sys`
and blocking on its `send()` to capture the click. That blocking call busy-spins an
NSRunLoop on a background thread — one pegged CPU core per unclicked notification. After
a ~13h session, 8 notifications had piled up = ~600% CPU. Commit `c2e6dc7` reverted to
`tauri-plugin-notification` (display-only, no click routing) to stop the burn.

So today: notifications show, but clicking one does nothing useful. This plan restores
click routing using an API that **cannot** reintroduce the busy-loop.

## Decision — Option B: UNUserNotificationCenter

Three options were weighed:

- **A — Patch the spin, keep the old API.** Keep `mac-notification-sys`, but attach an
  input source to the posting thread's run loop so `runUntilDate:` sleeps (~10Hz) instead
  of spinning. Smaller, but stays on Apple's deprecated `NSUserNotification`, still parks a
  thread per notification, needs a lifetime cap, and leans on the crate's internal loop.
- **B — Move to `UNUserNotificationCenter`** (the modern `UserNotifications.framework`).
  Event-driven: set a delegate once, post notifications carrying `workspaceId`/`chatId`,
  a delegate callback fires on click. No loop to spin, no thread per notification. **Chosen.**
- **C — Coarse routing** (focus last-completed chat on window refocus). Imprecise with
  multiple notifications. Rejected.

B was chosen because it removes the bug *class*, not just this instance, and it's the
non-deprecated API with exact routing plus optional action buttons later.

## The one big risk — verify BEFORE building

`UNUserNotificationCenter` only delivers from a **properly code-signed app bundle run from
a stable location**. Our `tauri.conf.json` has `"signingIdentity": null` (unsigned / ad-hoc).
Reported failure modes on unsigned or Gatekeeper-translocated apps:

- `requestAuthorization` returns "Notifications are not allowed" (UNErrorDomain code 1)
- `bundleProxyForCurrentProcess is nil` exception when the bundle identity can't resolve
- notifications silently not delivered even after authorization is granted

The *old* NSUserNotification path worked in this exact app, but UNUserNotificationCenter is
stricter. **Do a spike first** (see Phase 0). If it won't deliver from our build, fall back
to Option A rather than shipping something that silently no-ops.

Also flagged in the wild: people building a `UNUserNotificationCenterDelegate` in Rust with
objc2 have hit "callback never fires" and occasional segfaults — the delegate wiring and
object lifetime need care (keep the delegate alive for the whole process; don't let it drop).

## How it will work (plain English, in order)

1. At app startup we ask macOS for permission to show notifications (once).
2. We register one long-lived "responder" object with the system notification center.
3. When an agent finishes and you're not watching, the frontend calls a Rust command with
   the finished chat's label, workspace id, and chat id.
4. Rust posts a notification and tucks the workspace id + chat id into the notification's
   hidden data bag (`userInfo`).
5. You click the notification. macOS calls our responder object, handing back that data bag.
6. The responder shows/focuses the main window and emits a `notification://clicked` event
   carrying the two ids.
7. The frontend hears that event, selects the workspace, and switches to the chat.

No polling, no blocking, no thread parked per notification.

## Implementation

### Rust — new module `src-tauri/src/notifications_macos.rs`

- **Dep:** add `objc2-user-notifications = "0.3"` (0.3.2 seen) under
  `[target.'cfg(target_os = "macos")'.dependencies]` in `src-tauri/Cargo.toml` (sits next to
  the existing `objc2 = "0.6.3"`, `objc2-app-kit`, `objc2-foundation`). Enable the features
  for the types used: `UNUserNotificationCenter`, `UNMutableNotificationContent`,
  `UNNotificationRequest`, `UNNotificationResponse`, `UNNotificationContent`,
  `UNUserNotificationCenterDelegate`, `UNNotificationTrigger` (nil trigger = deliver now).
  Confirm exact feature-flag names against docs.rs when implementing.

- **Delegate class** via objc2 `define_class!` (objc2 0.6 uses `define_class!`, not the older
  `declare_class!`). It implements `UNUserNotificationCenterDelegate`:
  - `userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:` — read
    `response.notification().request().content().userInfo()`, pull `workspaceId`/`chatId`,
    show+focus the main window, `app_handle.emit("notification://clicked", payload)`, then
    call the completion handler.
  - `userNotificationCenter:willPresentNotification:withCompletionHandler:` — optional; return
    presentation options so a notification can show even while the app is frontmost.
  - The delegate holds a cloned `tauri::AppHandle` (an Ivar) so it can emit + focus. Store the
    delegate in a `static`/`OnceLock` or in Tauri managed state so it lives for the whole
    process (dropping it kills the callback).

- **Init function** `init_notification_delegate(app: &AppHandle)`:
  - `UNUserNotificationCenter::currentNotificationCenter()`, `setDelegate(Some(&delegate))`.
  - `requestAuthorizationWithOptions:` for `.Alert | .Sound`, log the grant/deny in the
    completion block.
  - Follow the existing `MainThreadMarker` pattern from `set_macos_dev_icon()`
    (`src-tauri/src/lib.rs:748`) for anything that must run on the main thread.

- **Post function** `post_completion_notification(title, body, workspace_id, chat_id)`:
  - Build `UNMutableNotificationContent` (setTitle/setBody), `setUserInfo` an `NSDictionary`
    with the two ids, wrap in a `UNNotificationRequest` with a unique identifier and a nil
    trigger, `center.addNotificationRequest(request, ...)`.

- **Wire into `src-tauri/src/lib.rs`:**
  - Call `init_notification_delegate(&app.handle())` from the `.setup(...)` closure
    (`lib.rs:469`) or the `RunEvent::Ready` arm (`lib.rs:684`, guarded by
    `#[cfg(target_os = "macos")]` like `set_macos_dev_icon`).
  - Rewrite `send_completion_notification` (`lib.rs:43-52`, registered at `lib.rs:620`) so on
    macOS it calls `post_completion_notification` with `workspace_id`/`chat_id`; keep the
    `tauri-plugin-notification` path for non-macOS. Command signature regains
    `workspace_id: String, chat_id: String`.

### Config — signing / entitlements

- `tauri.conf.json` `macOS` block (`src-tauri/tauri.conf.json:54`) currently:
  `signingIdentity: null`, `hardenedRuntime: true`, `infoPlist: "Info.plist"`.
- `src-tauri/Info.plist` already sets `NSUserNotificationAlertStyle=alert` (legacy key,
  harmless). No `.entitlements` file exists.
- Determine during Phase 0 whether delivery needs a real signing identity and/or an
  entitlements file. If yes, add an entitlements plist and reference it; decide whether prod
  builds must be signed (`signingIdentity`). Keep the `xattr -d com.apple.quarantine` /
  run-from-/Applications caveat in mind for local testing to avoid App Translocation.

### Dev-mode behavior

- `cfg!(debug_assertions)` distinguishes dev from prod (`lib.rs:473`, `lib.rs:687`).
- If Phase 0 shows UNUserNotificationCenter won't deliver from `pnpm dev` (raw binary, no
  proper bundle), **gate it**: in dev fall back to the plain `tauri-plugin-notification`
  display-only path so devs still see notifications; use the native path only in the packaged,
  signed build. Log which path is taken.

### Frontend — restore what `c2e6dc7` removed

- `src/renderer/services/notificationService.ts`:
  - `sendSystemNotification(label, workspaceId, chatId)` — pass `workspaceId`/`chatId` back
    into the `invoke("send_completion_notification", { title, body, workspaceId, chatId })`.
  - Re-add `initNotificationClickHandler(onNavigate)` — `listen("notification://clicked", ...)`,
    validate the two ids are strings, call `onNavigate`, return the unsubscribe.
- `src/renderer/App.tsx` — in the startup `useEffect` (`~line 105`, under
  `backend.type === "tauri"`), re-add the `initNotificationClickHandler` call that does
  `projectRegistry.selectWorkspace(workspaceId)` then
  `projectRegistry.selectedWorkspaceStore?.switchChat(chatId)` (wrapped in `runInAction`), and
  push its unsubscribe into the `cleanupFns` cleanup. Re-import `projectRegistry` and
  `runInAction`.
- `src/renderer/stores/ChatStore.ts` — at the `turnComplete` call site (`~line 1290`) pass
  `this.chat.workspaceId` and `this.chat.id` to `sendSystemNotification`.

Navigation primitives confirmed to exist:
- `ProjectRegistry.selectWorkspace(id: string)` — `src/renderer/stores/ProjectRegistry.ts:295`
- `ProjectRegistry.selectedWorkspaceStore` getter — `ProjectRegistry.ts:103`
- `WorkspaceStore.switchChat(chatId: string)` — `src/renderer/stores/WorkspaceStore.ts:378`

### Tests

- `src/renderer/services/__tests__/notificationService.test.ts` — restore the 3-arg
  `sendSystemNotification` assertion and the `initNotificationClickHandler` suite (navigate on
  valid payload, ignore missing ids, unsubscribe on cleanup). `invoke`/`listen` are globally
  mocked in `src/test/setup.ts`.
- `src/renderer/stores/__tests__/ChatStore.test.ts` — the `mockSendSystemNotification` and the
  two completion-notification tests go back to the 3-arg form.
- Rust delegate logic is objc/framework glue — verify manually via the Phase 0 spike + the
  end-to-end run, not unit tests.

## Verification

- **Phase 0 spike (do first):** minimal build that requests authorization and posts one
  notification from the packaged, signed `.app` (moved to `/Applications`, quarantine cleared).
  Confirm (a) it appears, (b) the delegate `didReceive` callback fires on click. If either
  fails on our signing setup, stop and reconsider Option A.
- End-to-end: run an agent to completion in a non-focused window with system notifications on;
  click the notification; the app focuses and opens that workspace/chat.
- Multiple outstanding notifications route to the correct chat each.
- `pnpm test`, `pnpm checks:ui`, `pnpm rustcheck` (note: rustcheck needs `../dist`, so run
  `pnpm vite-build` first).
- Confirm CPU is idle with several notifications outstanding (the whole point).

## Reference — API + objc2 notes

- Crate: `objc2-user-notifications` 0.3.2 — https://docs.rs/objc2-user-notifications
  - `UNUserNotificationCenter`: `currentNotificationCenter()`,
    `requestAuthorizationWithOptions:completionHandler:`, `addNotificationRequest:withCompletionHandler:`,
    `setDelegate:`
  - `UNMutableNotificationContent`: `setTitle:`, `setBody:`, `setUserInfo:`
  - `UNNotificationRequest`: `requestWithIdentifier:content:trigger:`
  - `UNNotificationResponse` → `.notification().request().content().userInfo()`
  - `UNAuthorizationOptions` bitflags (Alert, Sound, Badge)
- objc2 0.6 delegate: use `define_class!`; implement `NSObjectProtocol` + the delegate
  protocol; keep the instance alive for the process. Existing objc2 usage to mirror:
  `set_macos_dev_icon()` at `src-tauri/src/lib.rs:748` (MainThreadMarker pattern).
- Sources: [objc2-user-notifications](https://crates.io/crates/objc2-user-notifications),
  [objc2 delegate issue #606](https://github.com/madsmtm/objc2/issues/606),
  [Apple: UNUserNotificationCenterDelegate](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate),
  [bundleProxyForCurrentProcess nil discussion](https://github.com/progrium/darwinkit/discussions/258).

## What NOT to do

- Don't reintroduce `mac-notification-sys` or any blocking `send()`/`wait_for_click` — that's
  the exact busy-loop we removed in `c2e6dc7`.
- Don't park a thread per notification.

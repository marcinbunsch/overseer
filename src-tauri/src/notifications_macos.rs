//! Native macOS completion notifications with click routing.
//!
//! Posts "task complete" notifications through `UNUserNotificationCenter`
//! (UserNotifications.framework) instead of `tauri-plugin-notification`, so that
//! clicking a notification can focus the window and open the exact chat that finished.
//!
//! This replaces the old `mac-notification-sys` path, which captured clicks by blocking
//! on `send()` — that busy-spun an NSRunLoop on a background thread (one pegged core per
//! outstanding notification). `UNUserNotificationCenter` is event-driven: we register a
//! delegate once and macOS calls it on click. No thread is parked, nothing spins.
//!
//! Delivery caveat: `UNUserNotificationCenter` only delivers from a properly code-signed
//! app bundle run from a stable location. It may refuse to deliver from `pnpm dev` (a raw
//! binary with no bundle identity), so `lib.rs` only wires this in for release builds and
//! keeps the display-only plugin path for dev.

use std::sync::OnceLock;

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{ns_string, NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Payload emitted to the frontend when the user clicks a completion notification,
/// telling it which chat to open.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationClicked {
    workspace_id: String,
    chat_id: String,
}

/// Instance variables for the notification delegate: a clone of the Tauri app handle so
/// the delegate can focus the window and emit the click event.
struct Ivars {
    app: AppHandle,
}

define_class!(
    // SAFETY:
    // - The superclass NSObject has no subclassing requirements.
    // - `NotificationDelegate` does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[name = "OverseerNotificationDelegate"]
    #[ivars = Ivars]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        // Fired when the user clicks (or otherwise responds to) a notification.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_response(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            self.handle_response(response);
            // Tell the system we're done handling the response.
            completion_handler.call(());
        }

        // Fired when a notification would arrive while the app is frontmost. Returning
        // presentation options makes it show anyway (matches the plugin's behaviour).
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let options =
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::Sound;
            completion_handler.call((options,));
        }
    }
);

impl NotificationDelegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { app });
        // SAFETY: calling the superclass (NSObject) designated initializer once.
        unsafe { msg_send![super(this), init] }
    }

    /// Pull `workspaceId`/`chatId` out of the clicked notification's `userInfo`, focus the
    /// main window, and emit `notification://clicked` for the frontend to navigate.
    fn handle_response(&self, response: &UNNotificationResponse) {
        let user_info = response.notification().request().content().userInfo();
        // The dictionary is typed as <AnyObject, AnyObject>; we only ever store NSString
        // keys and values in it (see post_completion_notification), so re-type it.
        // SAFETY: the layout is identical — the generic parameters are phantom.
        let user_info: Retained<NSDictionary<NSString, NSString>> =
            unsafe { Retained::cast_unchecked(user_info) };

        let workspace_id = user_info
            .objectForKey(ns_string!("workspaceId"))
            .map(|s| s.to_string());
        let chat_id = user_info
            .objectForKey(ns_string!("chatId"))
            .map(|s| s.to_string());

        let (Some(workspace_id), Some(chat_id)) = (workspace_id, chat_id) else {
            log::warn!("clicked notification missing workspaceId/chatId in userInfo");
            return;
        };

        let app = &self.ivars().app;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = app.emit(
            "notification://clicked",
            NotificationClicked {
                workspace_id,
                chat_id,
            },
        );
    }
}

// The system notification center keeps only a WEAK reference to the delegate. Hold a
// strong one for the whole process so the click callback keeps firing; dropping it would
// deallocate the delegate and silently break routing.
static DELEGATE: OnceLock<Retained<NotificationDelegate>> = OnceLock::new();

/// Register the notification delegate and request permission to show notifications.
/// Call once at startup (release builds only — see the module docs).
pub fn init_notification_delegate(app: &AppHandle) {
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let delegate = NotificationDelegate::new(app.clone());
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    if DELEGATE.set(delegate).is_err() {
        log::warn!("notification delegate already initialised");
    }

    // Ask for permission to show alerts and play sounds. The completion block just logs
    // the outcome; it fires on a system queue, does no work, and parks no thread.
    let handler = RcBlock::new(|granted: Bool, error: *mut NSError| {
        if granted.as_bool() {
            log::info!("notification authorization granted");
        } else {
            log::warn!("notification authorization denied (error: {})", !error.is_null());
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &handler,
    );
}

/// Post a completion notification carrying the workspace/chat ids so a click can route
/// back to the finished chat.
pub fn post_completion_notification(title: &str, body: &str, workspace_id: &str, chat_id: &str) {
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));

    // Tuck the ids into userInfo so the delegate can read them back on click.
    let workspace_value = NSString::from_str(workspace_id);
    let chat_value = NSString::from_str(chat_id);
    let user_info = NSDictionary::<NSString, NSString>::from_slices(
        &[ns_string!("workspaceId"), ns_string!("chatId")],
        &[&*workspace_value, &*chat_value],
    );
    // setUserInfo wants the erased <AnyObject, AnyObject> dictionary type.
    // SAFETY: identical layout; generic parameters are phantom.
    let user_info: Retained<NSDictionary> = unsafe { Retained::cast_unchecked(user_info) };
    // SAFETY: userInfo values (NSString) are of a valid property-list type.
    unsafe { content.setUserInfo(&user_info) };

    // A unique identifier per request so notifications don't replace each other; a nil
    // trigger delivers immediately.
    let identifier = NSString::from_str(&Uuid::new_v4().to_string());
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);
    center.addNotificationRequest_withCompletionHandler(&request, None);
}

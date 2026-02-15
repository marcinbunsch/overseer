//! Session management for agent conversations.
//!
//! Sessions are shareable across interfaces - start a chat in Tauri,
//! continue from your phone via web.

mod manager;
mod state;

pub use manager::{SessionConfig, SessionHandle, SessionManager, SubscriberId};
pub use state::{Session, SessionId};

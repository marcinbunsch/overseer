//! WebSocket handler for real-time event streaming.
//!
//! This module implements the WebSocket endpoint at `/ws/events` that streams
//! events from the OverseerContext's EventBus to connected browser clients.
//!
//! # Protocol
//!
//! ## Server → Client (Events)
//!
//! Events are sent as JSON messages:
//! ```json
//! {
//!   "event_type": "agent:event:abc123",
//!   "payload": { "kind": "text", "text": "Hello" }
//! }
//! ```
//!
//! ## Client → Server (Subscriptions)
//!
//! Clients can filter events by sending subscription messages:
//!
//! **Subscribe:**
//! ```json
//! { "subscribe": "agent:event:*" }
//! ```
//!
//! **Unsubscribe:**
//! ```json
//! { "unsubscribe": "agent:event:*" }
//! ```
//!
//! # Pattern Matching
//!
//! Subscription patterns support wildcards:
//! - `agent:event:abc123` - exact match
//! - `agent:event:*` - matches `agent:event:anything`
//! - `agent:*:abc` - matches `agent:event:abc`, `agent:stdout:abc`, etc.
//!
//! If no subscriptions are registered, ALL events are sent (useful for debugging).
//!
//! # Connection Lifecycle
//!
//! 1. Client connects via WebSocket upgrade
//! 2. Server subscribes to EventBus
//! 3. Two concurrent tasks run:
//!    - **Receive task**: Listens for subscription/unsubscription messages from client
//!    - **Send task**: Forwards matching events from EventBus to client
//! 4. Connection closes when client disconnects or EventBus closes
//!
//! # Reconnection
//!
//! The client (HttpBackend in TypeScript) is responsible for reconnection logic.
//! On reconnect, the client must re-send subscription messages - the server does
//! not persist subscriptions across connections.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use super::HttpSharedState;

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Subscription request from client.
///
/// Sent by the client to start receiving events matching the pattern.
/// Multiple subscriptions can be active simultaneously.
#[derive(Deserialize)]
struct SubscriptionRequest {
    /// Event pattern to subscribe to.
    ///
    /// Examples:
    /// - `"agent:event:abc123"` - specific session
    /// - `"agent:event:*"` - all agent events
    /// - `"agent:*:abc123"` - all event types for session abc123
    subscribe: String,
}

/// Unsubscription request from client.
///
/// Sent by the client to stop receiving events matching the pattern.
/// Must exactly match a previous subscription pattern.
#[derive(Deserialize)]
struct UnsubscriptionRequest {
    /// Event pattern to unsubscribe from (must match a previous subscribe exactly).
    unsubscribe: String,
}

/// WebSocket event message sent to client.
///
/// This is the format for all events pushed from server to client.
#[derive(Serialize)]
struct WsEvent {
    /// Event type identifier (e.g., "agent:event:abc123", "pty:data:xyz").
    event_type: String,
    /// Event payload - structure depends on event_type.
    payload: serde_json::Value,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Handler for GET /ws/events
///
/// This is the Axum route handler that initiates the WebSocket upgrade.
/// Authentication (if enabled) is checked by the auth middleware before this runs.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<HttpSharedState>>,
) -> impl IntoResponse {
    // Perform the WebSocket upgrade and hand off to handle_socket
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle an individual WebSocket connection.
///
/// This function runs for the lifetime of the connection. It spawns two concurrent
/// tasks that communicate via shared state:
///
/// ```text
/// ┌─────────────────────────────────────────────────────────────────┐
/// │                    WebSocket Connection                         │
/// ├───────────────────────┬─────────────────────────────────────────┤
/// │     Receive Task      │              Send Task                  │
/// │                       │                                         │
/// │  Client → Server      │         EventBus → Client               │
/// │                       │                                         │
/// │  Parses JSON msgs:    │  For each event from EventBus:          │
/// │  • subscribe: add     │  1. Check if matches any subscription   │
/// │  • unsubscribe: rm    │  2. If yes (or no subs), send to client │
/// │                       │                                         │
/// │  Updates shared       │  Reads shared subscription set          │
/// │  subscription set     │                                         │
/// └───────────────────────┴─────────────────────────────────────────┘
/// ```
async fn handle_socket(socket: WebSocket, state: Arc<HttpSharedState>) {
    // Split the WebSocket into send/receive halves for concurrent handling
    let (mut sender, mut receiver) = socket.split();

    // Subscription patterns for this connection.
    // Shared between receive task (writes) and send task (reads).
    // Using Mutex because we need interior mutability across tasks.
    let subscriptions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    // Subscribe to the EventBus to receive all application events.
    // We filter on the client side based on subscription patterns.
    let mut event_rx = state.context.event_bus.subscribe();

    // ═══════════════════════════════════════════════════════════════════
    // RECEIVE TASK: Handle incoming messages from client
    // ═══════════════════════════════════════════════════════════════════

    let subs_clone = Arc::clone(&subscriptions);
    let recv_task = tokio::spawn(async move {
        // Process messages until client disconnects
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                // Try parsing as subscription request: {"subscribe": "pattern"}
                if let Ok(req) = serde_json::from_str::<SubscriptionRequest>(&text) {
                    let mut subs = subs_clone.lock().unwrap();
                    subs.insert(req.subscribe);
                    log::debug!("WebSocket subscribed to pattern");
                }
                // Try parsing as unsubscription request: {"unsubscribe": "pattern"}
                else if let Ok(req) = serde_json::from_str::<UnsubscriptionRequest>(&text) {
                    let mut subs = subs_clone.lock().unwrap();
                    subs.remove(&req.unsubscribe);
                    log::debug!("WebSocket unsubscribed from pattern");
                }
                // Unknown message format - silently ignore
            }
            // Non-text messages (Binary, Ping, Pong, Close) are handled by axum automatically
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // SEND TASK: Forward events from EventBus to client
    // ═══════════════════════════════════════════════════════════════════

    let send_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    // Determine if this event should be sent to the client
                    let should_send = {
                        let subs = subscriptions.lock().unwrap();
                        // No subscriptions = send everything (useful for debugging)
                        // With subscriptions = only send matching events
                        subs.is_empty() || subs.iter().any(|pattern| matches_pattern(&event.event_type, pattern))
                    };

                    if should_send {
                        // Convert to wire format
                        let ws_event = WsEvent {
                            event_type: event.event_type,
                            payload: event.payload,
                        };

                        if let Ok(json) = serde_json::to_string(&ws_event) {
                            // Send to client - if this fails, client has disconnected
                            if sender.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    // Client is too slow to keep up with events.
                    // The broadcast channel has a fixed capacity; old events are dropped.
                    // We log and continue - the client should handle missing events.
                    log::warn!("WebSocket client lagged by {} events", count);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    // EventBus was dropped (application shutting down)
                    break;
                }
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // WAIT FOR CONNECTION END
    // ═══════════════════════════════════════════════════════════════════

    // Run both tasks concurrently; exit when either completes.
    // This happens when:
    // - Client disconnects (recv_task ends)
    // - Client disconnects or send fails (send_task ends)
    // - EventBus closes (send_task ends)
    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }

    log::debug!("WebSocket connection closed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if an event type matches a subscription pattern.
///
/// Event types and patterns use colon-separated segments (e.g., "agent:event:abc123").
///
/// # Pattern Types
///
/// 1. **Exact match**: `"agent:event:abc123"` matches only `"agent:event:abc123"`
///
/// 2. **Suffix wildcard**: `"agent:event:*"` matches any event starting with `"agent:event:"`
///    - ✓ matches `"agent:event:abc123"`
///    - ✓ matches `"agent:event:xyz"`
///    - ✗ doesn't match `"agent:stdout:abc123"`
///
/// 3. **Segment wildcard**: `"agent:*:abc"` matches any middle segment
///    - ✓ matches `"agent:event:abc"`
///    - ✓ matches `"agent:stdout:abc"`
///    - ✗ doesn't match `"agent:event:xyz"` (last segment differs)
///
/// # Arguments
///
/// * `event_type` - The actual event type being checked
/// * `pattern` - The subscription pattern to match against
///
/// # Returns
///
/// `true` if the event matches the pattern, `false` otherwise.
fn matches_pattern(event_type: &str, pattern: &str) -> bool {
    // Case 1: Exact match
    if event_type == pattern {
        return true;
    }

    // Case 2: Suffix wildcard (e.g., "agent:event:*" matches "agent:event:abc123")
    // The wildcard must be after a colon to prevent matching partial segments.
    if let Some(prefix) = pattern.strip_suffix(":*") {
        // Check that event starts with prefix AND has a colon after
        // This prevents "agent:event" from matching "agent:events:foo"
        if event_type.starts_with(prefix) && event_type[prefix.len()..].starts_with(':') {
            return true;
        }
    }

    // Case 3: Segment wildcard (e.g., "agent:*:abc" matches "agent:event:abc")
    // Split both into segments and compare piece by piece
    if pattern.contains('*') {
        let pattern_parts: Vec<&str> = pattern.split(':').collect();
        let event_parts: Vec<&str> = event_type.split(':').collect();

        // Segment counts must match (no variable-length wildcards)
        if pattern_parts.len() != event_parts.len() {
            return false;
        }

        // Each segment must either match exactly or be a wildcard
        for (p, e) in pattern_parts.iter().zip(event_parts.iter()) {
            if *p != "*" && p != e {
                return false;
            }
        }
        return true;
    }

    false
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match() {
        assert!(matches_pattern("agent:event:abc123", "agent:event:abc123"));
        assert!(!matches_pattern("agent:event:abc123", "agent:event:xyz"));
    }

    #[test]
    fn wildcard_suffix() {
        assert!(matches_pattern("agent:event:abc123", "agent:event:*"));
        assert!(matches_pattern("agent:event:xyz", "agent:event:*"));
        assert!(!matches_pattern("agent:stdout:abc123", "agent:event:*"));
    }

    #[test]
    fn single_wildcard() {
        assert!(matches_pattern("agent:event:abc", "agent:*:abc"));
        assert!(matches_pattern("agent:stdout:abc", "agent:*:abc"));
        assert!(!matches_pattern("agent:event:xyz", "agent:*:abc"));
    }

    #[test]
    fn no_match() {
        assert!(!matches_pattern("pty:data:123", "agent:event:*"));
        assert!(!matches_pattern("agent:event:abc", "agent:close:abc"));
    }

    #[test]
    fn ws_event_serialization() {
        let event = WsEvent {
            event_type: "agent:event:abc".to_string(),
            payload: serde_json::json!({"kind": "text", "text": "Hello"}),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("agent:event:abc"));
        assert!(json.contains("Hello"));
    }

    #[test]
    fn subscription_request_deserialization() {
        let json = r#"{"subscribe": "agent:event:*"}"#;
        let req: SubscriptionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.subscribe, "agent:event:*");
    }

    #[test]
    fn unsubscription_request_deserialization() {
        let json = r#"{"unsubscribe": "agent:event:*"}"#;
        let req: UnsubscriptionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.unsubscribe, "agent:event:*");
    }
}

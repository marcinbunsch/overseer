//! WebSocket handler for real-time event streaming.
//!
//! Clients connect to `/ws/events` and receive events from the EventBus.
//! Clients can optionally send subscription filters.

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

use super::SharedState;

/// Subscription request from client.
#[derive(Deserialize)]
struct SubscriptionRequest {
    /// Event pattern to subscribe to (supports wildcards like "agent:event:*").
    subscribe: String,
}

/// Unsubscription request from client.
#[derive(Deserialize)]
struct UnsubscriptionRequest {
    /// Event pattern to unsubscribe from.
    unsubscribe: String,
}

/// WebSocket event message sent to client.
#[derive(Serialize)]
struct WsEvent {
    /// Event type (e.g., "agent:event:abc123").
    event_type: String,
    /// Event payload.
    payload: serde_json::Value,
}

/// Handler for GET /ws/events
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<SharedState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle an individual WebSocket connection.
async fn handle_socket(socket: WebSocket, state: Arc<SharedState>) {
    let (mut sender, mut receiver) = socket.split();

    // Subscriptions are patterns like "agent:event:*" or specific event types
    let subscriptions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    // Subscribe to the event bus
    let mut event_rx = state.context.event_bus.subscribe();

    // Spawn task to handle incoming messages (subscription requests)
    let subs_clone = Arc::clone(&subscriptions);
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                // Try to parse as subscription request
                if let Ok(req) = serde_json::from_str::<SubscriptionRequest>(&text) {
                    let mut subs = subs_clone.lock().unwrap();
                    subs.insert(req.subscribe);
                    log::debug!("WebSocket subscribed to pattern");
                }
                // Try to parse as unsubscription request
                else if let Ok(req) = serde_json::from_str::<UnsubscriptionRequest>(&text) {
                    let mut subs = subs_clone.lock().unwrap();
                    subs.remove(&req.unsubscribe);
                    log::debug!("WebSocket unsubscribed from pattern");
                }
            }
        }
    });

    // Forward matching events to the client
    let send_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    // Check if event matches any subscription pattern
                    let should_send = {
                        let subs = subscriptions.lock().unwrap();
                        // If no subscriptions, send all events
                        // If subscriptions exist, check if event matches any pattern
                        subs.is_empty() || subs.iter().any(|pattern| matches_pattern(&event.event_type, pattern))
                    };

                    if should_send {
                        let ws_event = WsEvent {
                            event_type: event.event_type,
                            payload: event.payload,
                        };

                        if let Ok(json) = serde_json::to_string(&ws_event) {
                            if sender.send(Message::Text(json.into())).await.is_err() {
                                break; // Client disconnected
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    log::warn!("WebSocket client lagged by {} events", count);
                    // Continue receiving
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break; // EventBus closed
                }
            }
        }
    });

    // Wait for either task to complete (client disconnect or bus closed)
    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }

    log::debug!("WebSocket connection closed");
}

/// Check if an event type matches a subscription pattern.
///
/// Supports wildcards:
/// - `*` matches any single segment
/// - Pattern ending with `:*` matches any suffix
fn matches_pattern(event_type: &str, pattern: &str) -> bool {
    // Exact match
    if event_type == pattern {
        return true;
    }

    // Wildcard suffix match (e.g., "agent:event:*" matches "agent:event:abc123")
    if let Some(prefix) = pattern.strip_suffix(":*") {
        if event_type.starts_with(prefix) && event_type[prefix.len()..].starts_with(':') {
            return true;
        }
    }

    // Single wildcard match (e.g., "agent:*:abc" matches "agent:event:abc")
    if pattern.contains('*') {
        let pattern_parts: Vec<&str> = pattern.split(':').collect();
        let event_parts: Vec<&str> = event_type.split(':').collect();

        if pattern_parts.len() != event_parts.len() {
            return false;
        }

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

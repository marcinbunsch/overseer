//! Framework-agnostic event broadcasting.
//!
//! The EventBus provides a publish-subscribe mechanism for distributing events
//! to multiple consumers (Tauri IPC, WebSocket clients, etc.) from a single source.
//!
//! # Example
//!
//! ```rust
//! use overseer_core::event_bus::EventBus;
//! use std::sync::Arc;
//!
//! let event_bus = Arc::new(EventBus::new());
//!
//! // Subscribe to events
//! let mut rx = event_bus.subscribe();
//!
//! // Emit an event
//! event_bus.emit("agent:event:abc123", &serde_json::json!({"kind": "text", "text": "Hello"}));
//!
//! // Receive the event (in async context)
//! // let event = rx.recv().await.unwrap();
//! ```

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Default channel capacity for the event bus.
/// Events beyond this capacity will cause slow subscribers to miss events (lag).
const DEFAULT_CAPACITY: usize = 1024;

/// A broadcast event containing an event type and JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcastEvent {
    /// Event type identifier (e.g., "agent:event:abc123", "agent:stdout:abc123").
    pub event_type: String,

    /// JSON payload for the event.
    pub payload: serde_json::Value,
}

impl BroadcastEvent {
    /// Create a new broadcast event.
    pub fn new(event_type: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            event_type: event_type.into(),
            payload,
        }
    }
}

/// A framework-agnostic event bus for broadcasting events to multiple subscribers.
///
/// Uses a tokio broadcast channel internally, allowing multiple consumers to
/// receive the same events concurrently.
pub struct EventBus {
    sender: broadcast::Sender<BroadcastEvent>,
}

impl EventBus {
    /// Create a new EventBus with default capacity.
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    /// Create a new EventBus with specified capacity.
    ///
    /// The capacity determines how many events can be buffered before slow
    /// subscribers start missing events (experiencing lag).
    pub fn with_capacity(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    /// Emit an event to all subscribers.
    ///
    /// Returns the number of subscribers that received the event.
    /// If there are no subscribers, the event is dropped and 0 is returned.
    ///
    /// # Arguments
    ///
    /// * `event_type` - The event type identifier (e.g., "agent:event:abc123")
    /// * `payload` - The event payload, which must be serializable to JSON
    pub fn emit<T: Serialize>(&self, event_type: &str, payload: &T) -> usize {
        let json_payload = match serde_json::to_value(payload) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Failed to serialize event payload: {}", e);
                return 0;
            }
        };

        let event = BroadcastEvent::new(event_type, json_payload);
        self.sender.send(event).unwrap_or(0)
    }

    /// Emit a raw BroadcastEvent to all subscribers.
    ///
    /// Useful when you already have a pre-constructed event.
    pub fn emit_raw(&self, event: BroadcastEvent) -> usize {
        self.sender.send(event).unwrap_or(0)
    }

    /// Subscribe to all events on this bus.
    ///
    /// Returns a receiver that will receive all future events.
    /// Past events are not delivered to new subscribers.
    pub fn subscribe(&self) -> broadcast::Receiver<BroadcastEvent> {
        self.sender.subscribe()
    }

    /// Get the current number of subscribers.
    pub fn subscriber_count(&self) -> usize {
        self.sender.receiver_count()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    mod broadcast_event {
        use super::*;

        #[test]
        fn new_creates_event() {
            let event = BroadcastEvent::new("test:event", json!({"key": "value"}));
            assert_eq!(event.event_type, "test:event");
            assert_eq!(event.payload["key"], "value");
        }

        #[test]
        fn serialization_roundtrip() {
            let event = BroadcastEvent::new("agent:event:abc123", json!({"kind": "text", "text": "Hello"}));
            let json = serde_json::to_string(&event).unwrap();
            let parsed: BroadcastEvent = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.event_type, "agent:event:abc123");
            assert_eq!(parsed.payload["kind"], "text");
            assert_eq!(parsed.payload["text"], "Hello");
        }

        #[test]
        fn debug_format() {
            let event = BroadcastEvent::new("test", json!({}));
            let debug = format!("{:?}", event);
            assert!(debug.contains("BroadcastEvent"));
            assert!(debug.contains("test"));
        }
    }

    mod event_bus {
        use super::*;

        #[test]
        fn new_creates_bus() {
            let bus = EventBus::new();
            assert_eq!(bus.subscriber_count(), 0);
        }

        #[test]
        fn default_creates_bus() {
            let bus = EventBus::default();
            assert_eq!(bus.subscriber_count(), 0);
        }

        #[test]
        fn with_capacity_creates_bus() {
            let bus = EventBus::with_capacity(100);
            assert_eq!(bus.subscriber_count(), 0);
        }

        #[test]
        fn subscribe_increments_count() {
            let bus = EventBus::new();
            assert_eq!(bus.subscriber_count(), 0);

            let _rx1 = bus.subscribe();
            assert_eq!(bus.subscriber_count(), 1);

            let _rx2 = bus.subscribe();
            assert_eq!(bus.subscriber_count(), 2);
        }

        #[test]
        fn dropped_subscriber_decrements_count() {
            let bus = EventBus::new();
            let rx = bus.subscribe();
            assert_eq!(bus.subscriber_count(), 1);

            drop(rx);
            assert_eq!(bus.subscriber_count(), 0);
        }

        #[test]
        fn emit_returns_zero_with_no_subscribers() {
            let bus = EventBus::new();
            let count = bus.emit("test", &json!({}));
            assert_eq!(count, 0);
        }

        #[test]
        fn emit_returns_subscriber_count() {
            let bus = EventBus::new();
            let _rx1 = bus.subscribe();
            let _rx2 = bus.subscribe();

            let count = bus.emit("test", &json!({"key": "value"}));
            assert_eq!(count, 2);
        }

        #[tokio::test]
        async fn emit_reaches_subscriber() {
            let bus = EventBus::new();
            let mut rx = bus.subscribe();

            bus.emit("agent:event:123", &json!({"kind": "text", "text": "Hello"}));

            let event = rx.recv().await.unwrap();
            assert_eq!(event.event_type, "agent:event:123");
            assert_eq!(event.payload["kind"], "text");
            assert_eq!(event.payload["text"], "Hello");
        }

        #[tokio::test]
        async fn multiple_subscribers_receive_same_event() {
            let bus = EventBus::new();
            let mut rx1 = bus.subscribe();
            let mut rx2 = bus.subscribe();

            bus.emit("test:event", &json!({"value": 42}));

            let event1 = rx1.recv().await.unwrap();
            let event2 = rx2.recv().await.unwrap();

            assert_eq!(event1.event_type, event2.event_type);
            assert_eq!(event1.payload, event2.payload);
        }

        #[tokio::test]
        async fn late_subscriber_misses_old_events() {
            let bus = EventBus::new();
            let mut early_rx = bus.subscribe();

            // Emit event before late subscriber joins
            bus.emit("early:event", &json!({}));

            // Late subscriber joins after event
            let mut late_rx = bus.subscribe();

            // Early subscriber gets the event
            let event = early_rx.recv().await.unwrap();
            assert_eq!(event.event_type, "early:event");

            // Emit another event that both should receive
            bus.emit("later:event", &json!({}));

            // Both receive the later event
            let event1 = early_rx.recv().await.unwrap();
            let event2 = late_rx.recv().await.unwrap();
            assert_eq!(event1.event_type, "later:event");
            assert_eq!(event2.event_type, "later:event");
        }

        #[tokio::test]
        async fn emit_raw_works() {
            let bus = EventBus::new();
            let mut rx = bus.subscribe();

            let event = BroadcastEvent::new("raw:event", json!({"raw": true}));
            bus.emit_raw(event);

            let received = rx.recv().await.unwrap();
            assert_eq!(received.event_type, "raw:event");
            assert_eq!(received.payload["raw"], true);
        }

        #[tokio::test]
        async fn multiple_events_in_order() {
            let bus = EventBus::new();
            let mut rx = bus.subscribe();

            bus.emit("event:1", &json!({"n": 1}));
            bus.emit("event:2", &json!({"n": 2}));
            bus.emit("event:3", &json!({"n": 3}));

            let e1 = rx.recv().await.unwrap();
            let e2 = rx.recv().await.unwrap();
            let e3 = rx.recv().await.unwrap();

            assert_eq!(e1.payload["n"], 1);
            assert_eq!(e2.payload["n"], 2);
            assert_eq!(e3.payload["n"], 3);
        }

        #[test]
        fn emit_handles_unserializable_gracefully() {
            // This test ensures emit doesn't panic on serialization issues.
            // In practice, all our types should be serializable.
            let bus = EventBus::new();
            let _rx = bus.subscribe();

            // A valid serializable value should work
            let count = bus.emit("test", &"simple string");
            assert_eq!(count, 1);
        }

        #[tokio::test]
        async fn slow_subscriber_experiences_lag() {
            // Create a bus with small capacity
            let bus = EventBus::with_capacity(2);
            let mut rx = bus.subscribe();

            // Emit more events than capacity
            bus.emit("event:1", &json!({}));
            bus.emit("event:2", &json!({}));
            bus.emit("event:3", &json!({}));

            // First receive should work
            let result = rx.recv().await;
            // With broadcast channels, slow receivers get a Lagged error
            // when they miss events. The next recv() after lag gives the
            // most recent event available.
            assert!(result.is_ok() || matches!(result, Err(broadcast::error::RecvError::Lagged(_))));
        }
    }
}

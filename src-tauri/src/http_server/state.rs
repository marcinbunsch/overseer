//! Shared state for the HTTP server.
//!
//! Wraps the EventBus and any other state needed by HTTP handlers.

use overseer_core::event_bus::EventBus;
use std::sync::Arc;

/// Shared state available to all HTTP handlers.
#[derive(Clone)]
pub struct SharedState {
    /// The event bus for publishing/subscribing to events.
    pub event_bus: Arc<EventBus>,
}

impl SharedState {
    /// Create a new shared state with the given event bus.
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self { event_bus }
    }
}

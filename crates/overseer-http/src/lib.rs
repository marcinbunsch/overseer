//! HTTP server for browser-based access to Overseer.
//!
//! This crate provides an HTTP/WebSocket server that allows Overseer to be accessed
//! from a web browser instead of only through the Tauri desktop app. This is useful for:
//! - Accessing Overseer from mobile devices (iOS/Android)
//! - Remote access over a local network (e.g., via Tailscale)
//! - Headless server use (overseer-daemon)
//! - Development and debugging without the full Tauri app
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                      HTTP Server (Axum)                         │
//! ├─────────────────────────────────────────────────────────────────┤
//! │  POST /api/invoke/{command}  →  routes.rs  →  Tauri commands   │
//! │  GET  /ws/events             →  websocket.rs  →  Event stream  │
//! │  GET  /*                     →  Static files (SPA) - optional  │
//! ├─────────────────────────────────────────────────────────────────┤
//! │                     Auth Middleware (auth.rs)                   │
//! │           Bearer token in header or query param                 │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Modules
//!
//! - [`auth`] - Bearer token authentication middleware
//! - [`routes`] - REST API handlers that dispatch to core commands
//! - [`websocket`] - WebSocket handler for real-time event streaming
//! - [`state`] - Shared state (OverseerContext + auth token)
//!
//! # Threading Model
//!
//! The server runs in a **separate thread** with its own Tokio runtime. This is
//! necessary because Tauri's main thread runs its own async runtime, and we can't
//! nest Tokio runtimes. The separate thread/runtime allows the HTTP server to
//! operate independently without blocking Tauri's event loop.

mod auth;
mod routes;
mod state;
mod websocket;

use axum::{middleware, routing::get, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

// Re-export for callers that need to build static file fallback routers
pub use tower_http::services::{ServeDir, ServeFile};

pub use state::HttpSharedState;

/// Handle to a running HTTP server.
///
/// This handle is returned by [`start`] and provides control over the server lifecycle.
/// The server runs in a background thread and can be stopped gracefully using [`stop`].
///
/// # Ownership
///
/// The handle owns both the shutdown channel and the thread handle. When the handle
/// is dropped without calling `stop()`, the server thread will continue running until
/// the process exits (but won't receive a graceful shutdown signal).
pub struct HttpServerHandle {
    /// Oneshot channel to signal shutdown. Sending () triggers graceful shutdown.
    /// None after stop() is called.
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Handle to the background thread running the Tokio runtime + Axum server.
    /// None after stop() is called and joined.
    task: Option<std::thread::JoinHandle<()>>,
}

impl HttpServerHandle {
    /// Check if the server is running.
    pub fn is_running(&self) -> bool {
        self.shutdown_tx.is_some()
    }

    /// Stop the server gracefully.
    ///
    /// Sends a shutdown signal and waits for the server thread to terminate.
    /// Safe to call multiple times — subsequent calls are no-ops.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = task.join();
        }
    }
}

impl Default for HttpServerHandle {
    fn default() -> Self {
        Self {
            shutdown_tx: None,
            task: None,
        }
    }
}

/// Start the HTTP server on the given host and port.
///
/// # Arguments
///
/// * `state` - Shared state containing OverseerContext and optional auth token
/// * `host` - Host address to bind to (e.g., "127.0.0.1" for local, "0.0.0.0" for all interfaces)
/// * `port` - Port number to listen on
/// * `fallback` - Optional router to use as a fallback for unmatched routes (e.g., static file serving).
///   The Tauri app passes a `ServeDir`-based router; the daemon passes an embedded-assets router.
///
/// # Returns
///
/// A handle that can be used to check status and stop the server.
///
/// # Authentication
///
/// If `state.auth_token` is Some, all requests must include the token:
/// - REST API: `Authorization: Bearer <token>` header
/// - WebSocket: `?token=<token>` query parameter
pub fn start(
    state: Arc<HttpSharedState>,
    host: String,
    port: u16,
    fallback: Option<Router>,
) -> Result<HttpServerHandle, String> {
    let auth_enabled = state.auth_token.is_some();
    if auth_enabled {
        log::info!("HTTP server authentication enabled");
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    let task = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime");

        rt.block_on(async move {
            let protected_routes = Router::new()
                .route(
                    "/api/invoke/{command}",
                    axum::routing::post(routes::invoke_handler),
                )
                .route("/ws/events", get(websocket::ws_handler))
                .layer(middleware::from_fn_with_state(
                    Arc::clone(&state),
                    auth::auth_middleware,
                ));

            let mut app = protected_routes
                .layer(
                    CorsLayer::new()
                        .allow_origin(Any)
                        .allow_methods(Any)
                        .allow_headers(Any),
                )
                .with_state(state);

            if let Some(fallback_router) = fallback {
                app = app.fallback_service(fallback_router);
            } else {
                log::info!("HTTP server: no static files configured");
            }

            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind HTTP server to {}: {}", addr, e);
                    return;
                }
            };

            log::info!("HTTP server listening on http://{}", addr);

            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    shutdown_rx.await.ok();
                    log::info!("HTTP server shutting down");
                })
                .await
                .ok();
        });
    });

    Ok(HttpServerHandle {
        shutdown_tx: Some(shutdown_tx),
        task: Some(task),
    })
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use overseer_core::OverseerContext;

    #[test]
    fn http_server_handle_default() {
        let handle = HttpServerHandle::default();
        assert!(!handle.is_running());
    }

    #[test]
    fn server_starts_and_stops() {
        let context = Arc::new(OverseerContext::builder().build());
        let state = Arc::new(HttpSharedState::new(context));

        let port = 19876;
        let mut handle = start(state, "127.0.0.1".to_string(), port, None).unwrap();

        assert!(handle.is_running());

        std::thread::sleep(std::time::Duration::from_millis(100));

        handle.stop();
        assert!(!handle.is_running());
    }
}

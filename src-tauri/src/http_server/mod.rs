//! HTTP server for browser-based access to Overseer.
//!
//! This module provides an HTTP/WebSocket server that allows Overseer to be accessed
//! from a web browser instead of only through the Tauri desktop app. This is useful for:
//! - Accessing Overseer from mobile devices (iOS/Android)
//! - Remote access over a local network (e.g., via Tailscale)
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
//! │  GET  /*                     →  Static files (SPA)             │
//! ├─────────────────────────────────────────────────────────────────┤
//! │                     Auth Middleware (auth.rs)                   │
//! │           Bearer token in header or query param                 │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Modules
//!
//! - [`auth`] - Bearer token authentication middleware
//! - [`routes`] - REST API handlers that dispatch to Tauri commands
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
use tower_http::services::ServeDir;

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
    ///
    /// Returns true if the server hasn't been stopped yet. Note that this checks
    /// whether we still have the shutdown channel, not whether the server is actually
    /// accepting connections (which happens asynchronously after start).
    pub fn is_running(&self) -> bool {
        self.shutdown_tx.is_some()
    }

    /// Stop the server gracefully.
    ///
    /// This sends a shutdown signal to the server and waits for it to finish
    /// processing any in-flight requests. The method blocks until the server
    /// thread has fully terminated.
    ///
    /// Safe to call multiple times - subsequent calls are no-ops.
    pub fn stop(&mut self) {
        // Send shutdown signal through the oneshot channel
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()); // Ignore error if receiver dropped
        }
        // Wait for the server thread to finish
        if let Some(task) = self.task.take() {
            let _ = task.join(); // Ignore thread panic (already logged)
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
/// * `static_dir` - Optional directory to serve static files from (for SPA hosting)
///
/// # Returns
///
/// A handle that can be used to check status and stop the server.
///
/// # Threading
///
/// The server runs in a **separate OS thread** with its own Tokio runtime. This is required
/// because Tauri already runs a Tokio runtime on the main thread, and Tokio runtimes cannot
/// be nested. The separate thread allows both to coexist.
///
/// # Authentication
///
/// If `state.auth_token` is Some, all requests must include the token:
/// - REST API: `Authorization: Bearer <token>` header
/// - WebSocket: `?token=<token>` query parameter
///
/// # Example
///
/// ```ignore
/// let state = Arc::new(HttpSharedState::from_context_with_auth(&context, Some("secret".into())));
/// let mut handle = http_server::start(state, "0.0.0.0".into(), 3210, None)?;
///
/// // Later, to stop:
/// handle.stop();
/// ```
pub fn start(
    state: Arc<HttpSharedState>,
    host: String,
    port: u16,
    static_dir: Option<String>,
) -> Result<HttpServerHandle, String> {
    let auth_enabled = state.auth_token.is_some();
    if auth_enabled {
        log::info!("HTTP server authentication enabled");
    }

    // Create a oneshot channel for graceful shutdown signaling.
    // When we send () through shutdown_tx, the server will finish current requests and exit.
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    // Parse the address early so we can return an error before spawning the thread
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    // Spawn the server in a new OS thread with its own Tokio runtime
    let task = std::thread::spawn(move || {
        // Create a multi-threaded Tokio runtime for handling concurrent requests.
        // We use multi-threaded because WebSocket connections are long-lived.
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime");

        rt.block_on(async move {
            // ═══════════════════════════════════════════════════════════════════
            // ROUTER SETUP
            // ═══════════════════════════════════════════════════════════════════

            // Protected routes that require authentication (if enabled)
            // The auth middleware runs on every request to these routes
            let protected_routes = Router::new()
                // REST API: POST /api/invoke/{command} - dispatches to Tauri commands
                .route("/api/invoke/{command}", axum::routing::post(routes::invoke_handler))
                // WebSocket: GET /ws/events - real-time event streaming
                .route("/ws/events", get(websocket::ws_handler))
                // Apply auth middleware to all routes above
                .layer(middleware::from_fn_with_state(
                    Arc::clone(&state),
                    auth::auth_middleware,
                ));

            // Add CORS layer to allow cross-origin requests.
            // This is permissive (allows any origin) because the server is intended
            // for local network use with optional auth. For public deployment,
            // you'd want to restrict origins.
            let mut app = protected_routes
                .layer(
                    CorsLayer::new()
                        .allow_origin(Any)
                        .allow_methods(Any)
                        .allow_headers(Any),
                )
                .with_state(state);

            // ═══════════════════════════════════════════════════════════════════
            // STATIC FILE SERVING (Optional)
            // ═══════════════════════════════════════════════════════════════════

            if let Some(ref dir) = static_dir {
                log::info!("HTTP server serving static files from: {}", dir);
                // Serve static files with SPA fallback:
                // - Known files (*.js, *.css, etc.) are served directly
                // - Unknown paths fall back to index.html (for client-side routing)
                let serve_dir = ServeDir::new(dir)
                    .not_found_service(tower_http::services::ServeFile::new(format!(
                        "{}/index.html",
                        dir
                    )));
                app = app.fallback_service(serve_dir);
            } else {
                log::info!("HTTP server: no static directory configured");
            }

            // ═══════════════════════════════════════════════════════════════════
            // SERVER BINDING & STARTUP
            // ═══════════════════════════════════════════════════════════════════

            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind HTTP server to {}: {}", addr, e);
                    return;
                }
            };

            log::info!("HTTP server listening on http://{}", addr);

            // Run the server with graceful shutdown support.
            // When shutdown_rx receives a message, the server will:
            // 1. Stop accepting new connections
            // 2. Wait for existing connections to complete (with timeout)
            // 3. Exit cleanly
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

        // Use a random high port to avoid conflicts
        let port = 19876;
        let mut handle = start(state, "127.0.0.1".to_string(), port, None).unwrap();

        assert!(handle.is_running());

        // Give the server a moment to start
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Stop it
        handle.stop();
        assert!(!handle.is_running());
    }
}

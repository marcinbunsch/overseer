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

mod api_v1;
mod auth;
mod client_log;
mod mcp;
mod routes;
mod state;
mod websocket;

use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::{middleware, routing::get, Router};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpService,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::catch_panic::CatchPanicLayer;
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
/// Middleware that logs one line per request: method, path, response status, and
/// how long it took. Server errors log at `error`, client errors at `warn`,
/// everything else at `info`.
async fn log_requests(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = std::time::Instant::now();

    let response = next.run(req).await;

    let status = response.status();
    let ms = start.elapsed().as_millis();
    if status.is_server_error() {
        log::error!("{method} {uri} -> {status} ({ms}ms)");
    } else if status.is_client_error() {
        log::warn!("{method} {uri} -> {status} ({ms}ms)");
    } else {
        log::info!("{method} {uri} -> {status} ({ms}ms)");
    }

    response
}

/// Panic handler for [`CatchPanicLayer`]. Logs the panic payload through the
/// `log` facade (so it reaches the log file) and returns a 500 so the
/// connection isn't dropped without a trace.
fn handle_panic(err: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let details = if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else if let Some(s) = err.downcast_ref::<&str>() {
        s.to_string()
    } else {
        "unknown panic".to_string()
    };
    log::error!("HTTP handler panicked: {details}");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
}

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
            // MCP server at /mcp — exposes the driving verbs as MCP tools. A fresh
            // handler is built per request; it only holds an Arc to shared state.
            // json_response mode: our tools are request/response, no SSE needed.
            let mcp_state = Arc::clone(&state);
            let mcp_service = StreamableHttpService::new(
                move || Ok(mcp::OverseerMcp::new(Arc::clone(&mcp_state))),
                Arc::new(LocalSessionManager::default()),
                Default::default(),
            );

            let protected_routes = Router::new()
                .route(
                    "/api/invoke/{command}",
                    axum::routing::post(routes::invoke_handler),
                )
                .route("/ws/events", get(websocket::ws_handler))
                .route(
                    "/api/client-log",
                    axum::routing::post(client_log::client_log_handler),
                )
                .merge(api_v1::router())
                // /mcp sits inside the protected group, so the same bearer-token
                // auth (and outer CORS) guards it — no MCP-specific auth needed.
                .nest_service("/mcp", mcp_service)
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
                // Log every request (method, path, status, latency) through the
                // `log` facade so it lands in the daemon's log file.
                .layer(middleware::from_fn(log_requests))
                // Turn a panicking handler into a logged 500 instead of a
                // silently dropped connection.
                .layer(CatchPanicLayer::custom(handle_panic))
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

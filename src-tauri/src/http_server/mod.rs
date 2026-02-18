//! HTTP server for browser-based access to Overseer.
//!
//! Exposes all Tauri commands via REST and events via WebSocket.

mod routes;
mod state;
mod websocket;

use axum::{routing::get, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

pub use state::SharedState;

/// Handle to a running HTTP server.
pub struct HttpServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: Option<std::thread::JoinHandle<()>>,
}

impl HttpServerHandle {
    /// Check if the server is running.
    pub fn is_running(&self) -> bool {
        self.shutdown_tx.is_some()
    }

    /// Stop the server gracefully.
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
/// The server runs in a separate thread with its own tokio runtime.
/// Returns a handle that can be used to stop the server.
pub fn start(
    state: Arc<SharedState>,
    host: String,
    port: u16,
    static_dir: Option<String>,
) -> Result<HttpServerHandle, String> {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    let task = std::thread::spawn(move || {
        // Create a new tokio runtime for the HTTP server
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime");

        rt.block_on(async move {
            // Build the router
            let mut app = Router::new()
                .route("/api/invoke/{command}", axum::routing::post(routes::invoke_handler))
                .route("/ws/events", get(websocket::ws_handler))
                .layer(
                    CorsLayer::new()
                        .allow_origin(Any)
                        .allow_methods(Any)
                        .allow_headers(Any),
                )
                .with_state(state);

            // Serve static files if directory provided
            if let Some(dir) = static_dir {
                app = app.fallback_service(ServeDir::new(dir));
            }

            // Bind the server
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind HTTP server to {}: {}", addr, e);
                    return;
                }
            };

            log::info!("HTTP server listening on http://{}", addr);

            // Run with graceful shutdown
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
    use overseer_core::event_bus::EventBus;

    #[test]
    fn http_server_handle_default() {
        let handle = HttpServerHandle::default();
        assert!(!handle.is_running());
    }

    #[test]
    fn server_starts_and_stops() {
        let event_bus = Arc::new(EventBus::new());
        let state = Arc::new(SharedState::new(event_bus));

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

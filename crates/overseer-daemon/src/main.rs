//! Overseer Daemon — standalone HTTP server binary.
//!
//! Starts the Overseer HTTP server without the Tauri desktop app. Useful for
//! headless servers, remote access via Tailscale, NAS devices, etc.
//!
//! # Usage
//!
//! ```
//! overseer-daemon [OPTIONS]
//!
//! Options:
//!   -H, --host <HOST>         Host to bind to [default: 127.0.0.1]
//!   -p, --port <PORT>         Port to listen on [default: 6767]
//!       --auth                Enable bearer token authentication (auto-generates token)
//!       --token <TOKEN>       Use a specific auth token (implies --auth)
//!       --config-dir <DIR>    Config directory (overrides default)
//!       --dev                 Use dev config paths (~/.config/overseer-dev/)
//! ```

use axum::{
    body::Body,
    http::{header, Response, StatusCode},
    response::IntoResponse,
};
use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;

/// Overseer Daemon — standalone HTTP server for headless/remote use.
#[derive(Parser, Debug)]
#[command(name = "overseer-daemon", about = "Overseer HTTP server daemon")]
struct Args {
    /// Host address to bind to
    #[arg(short = 'H', long, default_value = "127.0.0.1")]
    host: String,

    /// Port to listen on
    #[arg(short = 'p', long, default_value_t = 6767)]
    port: u16,

    /// Enable bearer token authentication (auto-generates token, prints to stdout)
    #[arg(long)]
    auth: bool,

    /// Use a specific auth token instead of generating one (implies --auth)
    #[arg(long, value_name = "TOKEN")]
    token: Option<String>,

    /// Override the config directory (e.g., ~/.config/overseer)
    #[arg(long, value_name = "DIR")]
    config_dir: Option<PathBuf>,

    /// Use dev config paths (~/.config/overseer-dev/ and ~/overseer/workspaces-dev/)
    #[arg(long)]
    dev: bool,
}

// Embed the compiled frontend from the dist/ directory at build time.
// The daemon is built after `pnpm vite-build` which populates dist/.
#[derive(rust_embed::RustEmbed)]
#[folder = "../../dist/"]
#[allow_missing = true]
struct FrontendAsset;

/// Axum handler that serves embedded frontend assets.
///
/// - Known asset paths (e.g., `/assets/index.js`) are served with the correct MIME type.
/// - Unknown paths fall back to `index.html` (enabling client-side SPA routing).
async fn serve_embedded_asset(req: axum::extract::Request) -> impl IntoResponse {
    let path = req.uri().path().trim_start_matches('/');

    // Try to serve the exact path first
    if let Some(asset) = FrontendAsset::get(path) {
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .body(Body::from(asset.data.into_owned()))
            .unwrap()
            .into_response();
    }

    // Fall back to index.html for SPA client-side routing
    if let Some(asset) = FrontendAsset::get("index.html") {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html")
            .body(Body::from(asset.data.into_owned()))
            .unwrap()
            .into_response();
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

fn generate_auth_token() -> String {
    use std::io::Read;
    // Read 16 random bytes from the OS and encode as hex (32 hex chars)
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut buf);
    } else {
        // Fallback: spread timestamp nanos across bytes (weak, but better than nothing)
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((t >> (i % 16 * 8)) & 0xff) as u8;
        }
    }
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn determine_config_dir(args: &Args) -> PathBuf {
    // Explicit --config-dir takes highest priority
    if let Some(ref dir) = args.config_dir {
        return dir.clone();
    }

    // Fall back to home-based paths
    let home = dirs_or_home();
    let dir_name = if args.dev { "overseer-dev" } else { "overseer" };
    home.join(".config").join(dir_name)
}

fn dirs_or_home() -> PathBuf {
    // Use HOME env var since we don't want a deps on the dirs crate
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home);
    }
    // Fallback: current directory
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Initialize logging
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .init();

    // Determine config directory
    let config_dir = determine_config_dir(&args);
    log::info!("Using config directory: {}", config_dir.display());

    // Create logs directory
    let log_dir = config_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    // Create OverseerContext (the central shared state)
    let context = Arc::new(
        overseer_core::OverseerContext::builder()
            .config_dir(config_dir.clone())
            .build(),
    );

    // Configure managers with the config directory for persistence
    context.approval_manager.set_config_dir(config_dir.clone());
    context.chat_sessions.set_config_dir(config_dir.clone());

    // Determine auth token: explicit --token takes priority, --auth auto-generates
    let auth_token = if let Some(token) = args.token.clone() {
        Some(token)
    } else if args.auth {
        Some(generate_auth_token())
    } else {
        None
    };

    // Create HTTP shared state
    let shared_state = Arc::new(
        overseer_http::HttpSharedState::from_context_with_auth(&context, auth_token.clone()),
    );

    // Build the embedded frontend fallback router
    let fallback = axum::Router::new().fallback(serve_embedded_asset);

    // Start the HTTP server
    let mut handle = match overseer_http::start(
        shared_state,
        args.host.clone(),
        args.port,
        Some(fallback),
    ) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to start server: {}", e);
            std::process::exit(1);
        }
    };

    println!(
        "Overseer daemon listening on http://{}:{}",
        args.host, args.port
    );

    if let Some(token) = auth_token {
        println!("Auth token: {}", token);
    }

    // Wait for Ctrl+C
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for Ctrl+C");

    println!("\nShutting down...");
    handle.stop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // --- generate_auth_token ---

    #[test]
    fn token_is_32_hex_chars() {
        let token = generate_auth_token();
        assert_eq!(token.len(), 32, "token should be 32 chars");
        assert!(
            token.chars().all(|c| c.is_ascii_hexdigit()),
            "token should only contain hex digits, got: {token}"
        );
    }

    #[test]
    fn token_is_unique() {
        let t1 = generate_auth_token();
        let t2 = generate_auth_token();
        assert_ne!(t1, t2, "successive tokens should differ");
    }

    // --- auth token selection ---

    #[test]
    fn explicit_token_is_used_as_is() {
        let args = Args {
            host: "127.0.0.1".to_string(),
            port: 6767,
            auth: false,
            token: Some("my-secret-token".to_string()),
            config_dir: None,
            dev: false,
        };
        let auth_token = if let Some(token) = args.token.clone() {
            Some(token)
        } else if args.auth {
            Some(generate_auth_token())
        } else {
            None
        };
        assert_eq!(auth_token, Some("my-secret-token".to_string()));
    }

    #[test]
    fn auth_flag_without_token_generates_random() {
        let args = Args {
            host: "127.0.0.1".to_string(),
            port: 6767,
            auth: true,
            token: None,
            config_dir: None,
            dev: false,
        };
        let auth_token = if let Some(token) = args.token.clone() {
            Some(token)
        } else if args.auth {
            Some(generate_auth_token())
        } else {
            None
        };
        assert!(auth_token.is_some());
        assert_ne!(auth_token.unwrap(), "my-secret-token");
    }

    // --- determine_config_dir ---

    fn make_args(config_dir: Option<PathBuf>, dev: bool) -> Args {
        Args {
            host: "127.0.0.1".to_string(),
            port: 6767,
            auth: false,
            token: None,
            config_dir,
            dev,
        }
    }

    #[test]
    fn explicit_config_dir_takes_priority() {
        let args = make_args(Some(PathBuf::from("/tmp/custom")), false);
        assert_eq!(determine_config_dir(&args), PathBuf::from("/tmp/custom"));
    }

    #[test]
    fn dev_flag_uses_overseer_dev() {
        let args = make_args(None, true);
        let dir = determine_config_dir(&args);
        let s = dir.to_string_lossy();
        assert!(s.contains(".config"), "should be under .config: {s}");
        assert!(s.contains("overseer-dev"), "should use overseer-dev: {s}");
    }

    #[test]
    fn default_uses_overseer_not_dev() {
        let args = make_args(None, false);
        let dir = determine_config_dir(&args);
        let s = dir.to_string_lossy();
        assert!(s.contains(".config"), "should be under .config: {s}");
        assert!(s.contains("overseer"), "should contain overseer: {s}");
        assert!(!s.contains("overseer-dev"), "should not use overseer-dev: {s}");
    }

    // --- dirs_or_home ---

    #[test]
    fn dirs_or_home_uses_home_env() {
        std::env::set_var("HOME", "/tmp/testhome");
        let dir = dirs_or_home();
        assert_eq!(dir, PathBuf::from("/tmp/testhome"));
    }

    // --- serve_embedded_asset ---

    #[tokio::test]
    async fn serve_embedded_asset_unknown_path_spa_fallback() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        let has_dist = FrontendAsset::get("index.html").is_some();

        let app = axum::Router::new().fallback(serve_embedded_asset);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/nonexistent-page")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        if has_dist {
            // dist/ is embedded: unknown paths fall back to index.html (SPA routing)
            assert_eq!(response.status(), axum::http::StatusCode::OK);
            assert_eq!(
                response.headers().get("content-type").unwrap(),
                "text/html"
            );
        } else {
            // dist/ absent (#[allow_missing = true]): no assets → 404
            assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn serve_embedded_asset_known_file_served_with_correct_mime() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;

        // Only meaningful when dist/ exists
        if FrontendAsset::get("index.html").is_none() {
            return;
        }

        let app = axum::Router::new().fallback(serve_embedded_asset);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/index.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "text/html"
        );
    }
}

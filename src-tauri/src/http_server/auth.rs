//! Authentication middleware for the HTTP server.
//!
//! Provides bearer token authentication for API and WebSocket routes.

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::Arc;

use super::SharedState;

/// Extract bearer token from Authorization header.
fn extract_bearer_token(req: &Request) -> Option<&str> {
    req.headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

/// Extract token from query parameter (for WebSocket connections).
fn extract_query_token(req: &Request) -> Option<String> {
    req.uri()
        .query()
        .and_then(|query| {
            query
                .split('&')
                .find_map(|pair| {
                    let mut parts = pair.splitn(2, '=');
                    let key = parts.next()?;
                    let value = parts.next()?;
                    if key == "token" {
                        Some(value.to_string())
                    } else {
                        None
                    }
                })
        })
}

/// Authentication middleware.
///
/// Checks for a valid bearer token in the Authorization header.
/// For WebSocket upgrade requests, also checks for token in query params.
pub async fn auth_middleware(
    State(state): State<Arc<SharedState>>,
    req: Request,
    next: Next,
) -> Response {
    // If no auth is configured, allow all requests
    if state.auth_token.is_none() {
        return next.run(req).await;
    }

    // Try to extract token from Authorization header first
    let header_token = extract_bearer_token(&req);

    // For WebSocket requests, also check query params
    let query_token = extract_query_token(&req);

    let token = header_token.or(query_token.as_deref());

    if state.validate_token(token) {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "Invalid or missing authentication token").into_response()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_bearer_token_valid() {
        let req = Request::builder()
            .header("Authorization", "Bearer test-token-123")
            .body(())
            .unwrap();
        assert_eq!(extract_bearer_token(&req), Some("test-token-123"));
    }

    #[test]
    fn extract_bearer_token_missing() {
        let req = Request::builder().body(()).unwrap();
        assert_eq!(extract_bearer_token(&req), None);
    }

    #[test]
    fn extract_bearer_token_wrong_scheme() {
        let req = Request::builder()
            .header("Authorization", "Basic dXNlcjpwYXNz")
            .body(())
            .unwrap();
        assert_eq!(extract_bearer_token(&req), None);
    }

    #[test]
    fn extract_query_token_valid() {
        let req = Request::builder()
            .uri("/ws/events?token=test-token-456")
            .body(())
            .unwrap();
        assert_eq!(extract_query_token(&req), Some("test-token-456".to_string()));
    }

    #[test]
    fn extract_query_token_with_other_params() {
        let req = Request::builder()
            .uri("/ws/events?foo=bar&token=my-token&baz=qux")
            .body(())
            .unwrap();
        assert_eq!(extract_query_token(&req), Some("my-token".to_string()));
    }

    #[test]
    fn extract_query_token_missing() {
        let req = Request::builder()
            .uri("/ws/events?foo=bar")
            .body(())
            .unwrap();
        assert_eq!(extract_query_token(&req), None);
    }
}

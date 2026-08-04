//! Internal, localhost-only API for running privileged host commands on behalf
//! of sandboxed agents.
//!
//! # Why this exists
//!
//! A sandboxed agent runs with a scrubbed environment: `SSH_AUTH_SOCK`,
//! `GH_TOKEN`, and `GITHUB_TOKEN` are gone (see `overseer-core`'s sandbox env
//! allow-list), and it can't reach host state outside its workspace. The sandbox
//! *allows* network, but with no credentials the agent can't do things like
//! `git push` or `gh pr create`. Rather than widen the sandbox, this service is a
//! narrow, controlled channel: the agent asks Overseer to run a fixed, whitelisted
//! operation on the host — where the credentials live — and gets the result back
//! synchronously, so it knows the outcome of each call. Git push / PR are the
//! first such operations; the same channel is how any future privileged host
//! command should be exposed.
//!
//! # Shape
//!
//! A small axum server bound to `127.0.0.1:0` (random port), started once at app
//! launch. Every request carries a Bearer token. Each token is registered when a
//! sandboxed agent starts and maps to exactly one session's workspace + branch,
//! so an agent can only act on its own repo. The token lives only in that one
//! agent's scrubbed environment, so no other process on the host can call in.
//!
//! Operations exposed today (all `POST`, all under `/api/service/`):
//! - `git/push`  — push the session's current branch to `origin`
//! - `git/pull`  — pull the session's branch from `origin` into the workspace
//! - `pr/open`   — push, then `gh pr create`; returns the PR URL
//! - `pr/status` — read-only: does a PR already exist for this branch?

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use overseer_core::shell::build_login_shell_command;
use serde::{Deserialize, Serialize};

/// What a single token is allowed to act on: one session's workspace.
#[derive(Debug, Clone)]
pub struct SessionScope {
    /// The conversation that owns this token — used to revoke on close.
    pub conversation_id: String,
    /// The workspace directory git commands run in.
    pub workspace_path: String,
    /// The branch to push / open a PR for.
    pub branch: String,
    /// The login-shell prefix to run host commands under (matches how the agent
    /// itself was launched, so `git`/`gh` resolve the same way).
    pub agent_shell: Option<String>,
}

/// Maps Bearer tokens to the session each is scoped to. Shared between the axum
/// handlers and the Tauri command that registers tokens at spawn time.
#[derive(Clone, Default)]
pub struct TokenRegistry {
    inner: Arc<Mutex<HashMap<String, SessionScope>>>,
}

impl TokenRegistry {
    /// Return the token for `scope.conversation_id`, minting `new_token` only when
    /// the conversation has none yet. When a token already exists it is returned
    /// unchanged and its scope is refreshed in place (the branch may have moved).
    ///
    /// Reuse matters because a sandboxed agent's process is spawned once and holds
    /// its original `OVERSEER_API_TOKEN` for its whole life — follow-up messages go
    /// in over stdin, so the env is never re-applied. An earlier version minted a
    /// fresh token on every message and dropped the previous one, which revoked the
    /// token the live process still held; its next `git push` then got a 401.
    pub fn ensure_token(&self, new_token: String, scope: SessionScope) -> String {
        let mut map = self.inner.lock().unwrap();
        if let Some((token, existing)) = map
            .iter_mut()
            .find(|(_, s)| s.conversation_id == scope.conversation_id)
        {
            *existing = scope;
            return token.clone();
        }
        map.insert(new_token.clone(), scope);
        new_token
    }

    /// Revoke every token belonging to a conversation. Called when the agent
    /// process exits so its token can't be reused.
    pub fn remove_by_conversation(&self, conversation_id: &str) {
        let mut map = self.inner.lock().unwrap();
        map.retain(|_, s| s.conversation_id != conversation_id);
    }

    /// Look up the scope for a token, cloning it out so we don't hold the lock
    /// across the git command.
    fn lookup(&self, token: &str) -> Option<SessionScope> {
        self.inner.lock().unwrap().get(token).cloned()
    }
}

/// Managed Tauri state: the running service's base URL plus the token registry.
#[derive(Clone, Default)]
pub struct AgentApiState {
    /// `http://127.0.0.1:<port>`, filled in once the server binds. `None` until
    /// [`start`] runs.
    pub base_url: Arc<Mutex<Option<String>>>,
    pub registry: TokenRegistry,
}

impl AgentApiState {
    /// The base URL the service bound to, if it has started.
    pub fn base_url(&self) -> Option<String> {
        self.base_url.lock().unwrap().clone()
    }
}

/// Bind the service to `127.0.0.1:0`, record its address on `state`, and serve on
/// a background thread. Returns after the socket is bound so the caller can read
/// `state.base_url()`.
pub fn start(state: &AgentApiState) -> Result<(), String> {
    let registry = state.registry.clone();
    // The serving thread owns the tokio runtime and the listener. It reports the
    // bound address back here so we can record the base URL before returning.
    let (addr_tx, addr_rx) = std::sync::mpsc::channel::<Result<std::net::SocketAddr, String>>();

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                let _ = addr_tx.send(Err(format!("Failed to build agent-api runtime: {e}")));
                return;
            }
        };

        runtime.block_on(async move {
            let listener = match tokio::net::TcpListener::bind(("127.0.0.1", 0)).await {
                Ok(l) => l,
                Err(e) => {
                    let _ = addr_tx.send(Err(format!("Failed to bind agent-api service: {e}")));
                    return;
                }
            };
            match listener.local_addr() {
                Ok(addr) => {
                    let _ = addr_tx.send(Ok(addr));
                }
                Err(e) => {
                    let _ = addr_tx.send(Err(format!("Failed to read agent-api address: {e}")));
                    return;
                }
            }

            let app = router(registry);
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("agent-api service stopped: {e}");
            }
        });
    });

    let addr = addr_rx
        .recv()
        .map_err(|_| "agent-api service thread exited before binding".to_string())??;
    let base_url = format!("http://{addr}");
    *state.base_url.lock().unwrap() = Some(base_url.clone());

    log::info!("agent-api service listening on {base_url}");
    Ok(())
}

fn router(registry: TokenRegistry) -> Router {
    Router::new()
        .route("/api/service/git/push", post(handle_push))
        .route("/api/service/git/pull", post(handle_pull))
        .route("/api/service/pr/open", post(handle_pr_open))
        .route("/api/service/pr/status", post(handle_pr_status))
        .with_state(registry)
}

// ============================================================================
// AUTH
// ============================================================================

/// JSON body for a failed request. Mirrors the `success: false` shape of the
/// command results so a client can parse every response the same way instead of
/// throwing on a bare plain-text error.
#[derive(Debug, Serialize)]
struct ErrorResult {
    success: bool,
    error: String,
}

impl ErrorResult {
    fn new(error: &str) -> Self {
        Self {
            success: false,
            error: error.to_string(),
        }
    }
}

/// Resolve the Bearer token to a session scope, or reject with a 401 carrying a
/// JSON error envelope.
fn authorize(registry: &TokenRegistry, headers: &HeaderMap) -> Result<SessionScope, Response> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v.trim());

    match token.and_then(|t| registry.lookup(t)) {
        Some(scope) => Ok(scope),
        None => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResult::new("invalid or missing token")),
        )
            .into_response()),
    }
}

// ============================================================================
// HANDLERS
// ============================================================================

/// Result of a single host command, returned to the agent as JSON.
#[derive(Debug, Serialize)]
struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
struct PrOpenRequest {
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
}

/// Response for `pr/open`. `url` is the created PR's URL when `success` is true.
#[derive(Debug, Serialize)]
struct PrOpenResult {
    success: bool,
    /// Which step failed / ran: "push" or "create". Helps the agent react.
    stage: String,
    url: Option<String>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct PrStatusResult {
    exists: bool,
    /// Set when the query itself failed (not authed, offline, gh missing,
    /// unparseable output) so the agent doesn't read a broken call as "no PR".
    /// `None` for both a real hit and a genuine "no PR for this branch".
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    number: Option<i64>,
    state: Option<String>,
    url: Option<String>,
    is_draft: Option<bool>,
}

async fn handle_push(State(registry): State<TokenRegistry>, headers: HeaderMap) -> Response {
    let scope = match authorize(&registry, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let output = git_push(&scope).await;
    Json(output).into_response()
}

async fn handle_pull(State(registry): State<TokenRegistry>, headers: HeaderMap) -> Response {
    let scope = match authorize(&registry, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let output = git_pull(&scope).await;
    Json(output).into_response()
}

async fn handle_pr_open(
    State(registry): State<TokenRegistry>,
    headers: HeaderMap,
    Json(req): Json<PrOpenRequest>,
) -> Response {
    let scope = match authorize(&registry, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    // Push first — a PR can't be opened for a branch the remote hasn't seen.
    let push = git_push(&scope).await;
    if !push.success {
        return Json(PrOpenResult {
            success: false,
            stage: "push".to_string(),
            url: None,
            stdout: push.stdout,
            stderr: push.stderr,
        })
        .into_response();
    }

    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--head".to_string(),
        scope.branch.clone(),
        "--title".to_string(),
        req.title.clone(),
        "--body".to_string(),
        req.body.clone().unwrap_or_default(),
    ];
    if req.draft {
        args.push("--draft".to_string());
    }

    let create = run_host_command("gh", args, &scope).await;
    let url = if create.success {
        // gh prints the PR URL as the last line of stdout.
        create
            .stdout
            .lines()
            .rev()
            .find(|l| l.starts_with("http"))
            .map(|l| l.trim().to_string())
    } else {
        None
    };

    Json(PrOpenResult {
        success: create.success,
        stage: "create".to_string(),
        url,
        stdout: create.stdout,
        stderr: create.stderr,
    })
    .into_response()
}

async fn handle_pr_status(State(registry): State<TokenRegistry>, headers: HeaderMap) -> Response {
    let scope = match authorize(&registry, &headers) {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let args = vec![
        "pr".to_string(),
        "view".to_string(),
        scope.branch.clone(),
        "--json".to_string(),
        "number,state,url,isDraft".to_string(),
    ];
    let output = run_host_command("gh", args, &scope).await;

    // gh exits non-zero both when no PR exists for the branch (expected) and on
    // real failures (not authed, offline, gh missing). Only the former is
    // "not found"; surface the rest as an error so the agent doesn't act on a
    // broken call as if there were simply no PR.
    if !output.success {
        let no_pr = output.stderr.contains("no pull requests found")
            || output.stderr.contains("no open pull requests");
        return Json(PrStatusResult {
            exists: false,
            error: if no_pr {
                None
            } else {
                Some(output.stderr.trim().to_string())
            },
            number: None,
            state: None,
            url: None,
            is_draft: None,
        })
        .into_response();
    }

    match serde_json::from_str::<serde_json::Value>(&output.stdout) {
        Ok(parsed) => Json(PrStatusResult {
            exists: true,
            error: None,
            number: parsed["number"].as_i64(),
            state: parsed["state"].as_str().map(|s| s.to_string()),
            url: parsed["url"].as_str().map(|s| s.to_string()),
            is_draft: parsed["isDraft"].as_bool(),
        })
        .into_response(),
        Err(e) => Json(PrStatusResult {
            exists: false,
            error: Some(format!("failed to parse gh output: {e}")),
            number: None,
            state: None,
            url: None,
            is_draft: None,
        })
        .into_response(),
    }
}

// ============================================================================
// HOST EXECUTION
// ============================================================================

/// Push the session's current branch to `origin`, setting upstream. Idempotent:
/// re-pushing an up-to-date branch just reports "Everything up-to-date".
async fn git_push(scope: &SessionScope) -> CommandResult {
    let args = vec![
        "push".to_string(),
        "-u".to_string(),
        "origin".to_string(),
        "HEAD".to_string(),
    ];
    run_host_command("git", args, scope).await
}

/// Pull the session's branch from `origin` (fetch + merge) into the workspace.
/// Merge conflicts surface in stdout/stderr so the agent can resolve them in its
/// own (writable) workspace.
async fn git_pull(scope: &SessionScope) -> CommandResult {
    let args = vec![
        "pull".to_string(),
        "origin".to_string(),
        scope.branch.clone(),
    ];
    run_host_command("git", args, scope).await
}

/// Run a binary on the host (outside the sandbox) in the session's workspace,
/// reusing the same login-shell wrapping the agent was launched with. Args are
/// shell-escaped by `build_login_shell_command`, so agent-supplied strings (PR
/// title/body) can't inject shell commands.
async fn run_host_command(binary: &str, args: Vec<String>, scope: &SessionScope) -> CommandResult {
    let binary = binary.to_string();
    let workspace = scope.workspace_path.clone();
    let shell = scope.agent_shell.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut cmd =
            build_login_shell_command(&binary, &args, Some(&workspace), shell.as_deref())?;
        cmd.output()
            .map_err(|e| format!("Failed to run {binary}: {e}"))
    })
    .await;

    match result {
        Ok(Ok(output)) => CommandResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Ok(Err(e)) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: e,
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("host command task failed: {e}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(conversation_id: &str, branch: &str) -> SessionScope {
        SessionScope {
            conversation_id: conversation_id.to_string(),
            workspace_path: "/tmp/workspace".to_string(),
            branch: branch.to_string(),
            agent_shell: None,
        }
    }

    #[test]
    fn ensure_token_then_lookup_returns_scope() {
        let registry = TokenRegistry::default();
        registry.ensure_token("token-abc".to_string(), scope("conv-1", "feature-x"));

        let found = registry.lookup("token-abc").expect("token should resolve");
        assert_eq!(found.conversation_id, "conv-1");
        assert_eq!(found.branch, "feature-x");
    }

    #[test]
    fn lookup_unknown_token_is_none() {
        let registry = TokenRegistry::default();
        registry.ensure_token("token-abc".to_string(), scope("conv-1", "feature-x"));
        assert!(registry.lookup("some-other-token").is_none());
    }

    #[test]
    fn ensure_token_reuses_live_token_and_refreshes_scope() {
        // A follow-up message must keep the token the running process already holds
        // — regenerating it would 401 the process's next call. The offered token is
        // ignored; the branch on the existing scope is refreshed in place.
        let registry = TokenRegistry::default();
        let first = registry.ensure_token("first-token".to_string(), scope("conv-1", "feature-x"));
        assert_eq!(first, "first-token");

        let second =
            registry.ensure_token("second-token".to_string(), scope("conv-1", "feature-y"));
        assert_eq!(second, "first-token", "the live token must be reused");

        assert!(
            registry.lookup("second-token").is_none(),
            "the offered token is discarded when one already exists"
        );
        let found = registry
            .lookup("first-token")
            .expect("original token still valid");
        assert_eq!(
            found.branch, "feature-y",
            "scope refreshed to the new branch"
        );
    }

    #[test]
    fn ensure_token_mints_when_conversation_absent() {
        let registry = TokenRegistry::default();
        let a = registry.ensure_token("token-1".to_string(), scope("conv-1", "feature-x"));
        let b = registry.ensure_token("token-2".to_string(), scope("conv-2", "feature-y"));

        assert_eq!(a, "token-1");
        assert_eq!(b, "token-2");
        assert!(registry.lookup("token-1").is_some());
        assert!(registry.lookup("token-2").is_some());
    }

    #[test]
    fn remove_by_conversation_revokes_only_that_conversation() {
        let registry = TokenRegistry::default();
        registry.ensure_token("token-1".to_string(), scope("conv-1", "feature-x"));
        registry.ensure_token("token-2".to_string(), scope("conv-2", "feature-y"));

        registry.remove_by_conversation("conv-1");

        assert!(registry.lookup("token-1").is_none());
        assert!(
            registry.lookup("token-2").is_some(),
            "another conversation's token must survive"
        );
    }
}

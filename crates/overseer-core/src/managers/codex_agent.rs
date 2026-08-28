//! Codex agent process manager.
//!
//! Manages Codex CLI processes, including spawning, stdin/stdout handling,
//! event parsing, auto-approval, and lifecycle management.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::agents::codex::{CodexConfig, CodexParser};
use crate::agents::event::AgentEvent;
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::{ChatSessionManager, ProjectApprovalManager};
use crate::sandbox::{AgentKind, SandboxSpec};
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Build the sandbox spec for a Codex spawn from the workspace and the
/// caller-resolved git common dir. Mirrors the Claude builder but uses
/// `AgentKind::Codex` and has no `CLAUDE_CONFIG_DIR` override. Returns an error
/// (rather than silently skipping the sandbox) if the git dir or `$HOME` is
/// missing.
fn build_codex_sandbox_spec(
    working_dir: &str,
    git_common_dir: Option<&str>,
    extra_env: Vec<(String, String)>,
) -> Result<SandboxSpec, String> {
    let git = git_common_dir
        .ok_or_else(|| "Sandboxed Codex requires a resolved git directory".to_string())?;
    let home = std::env::var("HOME").map_err(|_| "HOME is not set; cannot sandbox".to_string())?;
    Ok(SandboxSpec::new(
        AgentKind::Codex,
        std::path::Path::new(working_dir),
        std::path::Path::new(git),
        std::path::Path::new(&home),
        Vec::new(),
    )
    .with_extra_env(extra_env))
}

/// Entry for a single Codex process.
struct CodexProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<CodexParser>>,
}

impl Default for CodexProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(CodexParser::new())),
        }
    }
}

/// Configuration for starting a Codex agent.
pub struct CodexStartConfig {
    pub server_id: String,
    pub project_name: String,
    pub codex_path: String,
    pub model_version: Option<String>,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
    /// Workspace directory the app-server runs against. Needed to grant the
    /// Seatbelt profile write access when `sandboxed`.
    pub working_dir: String,
    /// When true, wrap the app-server in a macOS Seatbelt sandbox with a scrubbed
    /// environment (see [`crate::sandbox`]).
    pub sandboxed: bool,
    /// The shared git directory (`git rev-parse --git-common-dir`). Required when
    /// `sandboxed` so the profile can grant write access to the worktree's git
    /// state, which lives in the main repo's `.git`. Resolved by the caller.
    pub git_common_dir: Option<String>,
    /// Extra environment variables injected into the scrubbed sandbox env (only
    /// applied when `sandboxed`). Carries the internal git API address + token so
    /// the agent can push / open PRs on the host. Empty by default.
    pub extra_env: Vec<(String, String)>,
}

/// Manages Codex CLI processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdin/stdout communication
/// - Event parsing and emission
/// - Auto-approval of safe commands
#[derive(Default)]
pub struct CodexAgentManager {
    servers: Mutex<HashMap<String, CodexProcessEntry>>,
}

impl CodexAgentManager {
    /// Create a new CodexAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Codex CLI process for a server.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: CodexStartConfig,
        event_bus: Arc<EventBus>,
        approval_manager: Arc<ProjectApprovalManager>,
        chat_sessions: Arc<ChatSessionManager>,
    ) -> Result<(), String> {
        // Stop any existing server for this id first.
        {
            let map = self.servers.lock().unwrap();
            if let Some(entry) = map.get(&config.server_id) {
                if let Some(process) = entry.process.lock().unwrap().take() {
                    process.kill();
                }
            }
        }

        // Open log file
        let lid = config.log_id.as_deref().unwrap_or(&config.server_id);
        let log_handle = open_log_file(config.log_dir.as_deref(), lid);

        // Build config using core
        let codex_config = CodexConfig {
            binary_path: config.codex_path,
            model: config.model_version,
            shell_prefix: config.agent_shell,
        };

        let mut spawn_config = codex_config.build();

        // Non-sandboxed spawns apply extra env here. Sandboxed spawns scrub the
        // host env and re-inject via the SandboxSpec below, so this field is
        // ignored on that path.
        let sandbox_extra_env = config.extra_env.clone();
        spawn_config.extra_env = config.extra_env;

        // When requested, wrap the spawn in a Seatbelt sandbox. Fail loudly if the
        // spec can't be built — never silently run an agent unsandboxed.
        if config.sandboxed {
            let spec = build_codex_sandbox_spec(
                &config.working_dir,
                config.git_common_dir.as_deref(),
                sandbox_extra_env,
            )?;
            spawn_config = spawn_config.sandbox(spec);
        }

        // Spawn the process
        let mut process = AgentProcess::spawn(spawn_config)?;

        // Take the event receiver out so we can do blocking receives
        // without holding the lock on the process
        let event_receiver = process
            .take_receiver()
            .ok_or_else(|| "Failed to take event receiver".to_string())?;

        // Store the process entry
        let mut entry = CodexProcessEntry::default();
        entry.log_file = Arc::clone(&log_handle);
        *entry.process.lock().unwrap() = Some(process);

        let process_arc = Arc::clone(&entry.process);
        let parser_arc = Arc::clone(&entry.parser);

        {
            let mut map = self.servers.lock().unwrap();
            map.insert(config.server_id.clone(), entry);
        }

        // Pre-load approval context
        log::info!(
            "Pre-loading approval context for project: '{}' (len={})",
            config.project_name,
            config.project_name.len()
        );
        let _ = approval_manager.get_or_load(&config.project_name);
        let project_name = config.project_name;

        // Spawn event forwarding thread
        let sid = config.server_id;
        let log_file = Arc::clone(&log_handle);
        std::thread::spawn(move || {
            // Helper to flush parser and emit remaining events
            let flush_and_emit =
                |parser_arc: &Arc<Mutex<CodexParser>>,
                 chat_sessions: &Arc<ChatSessionManager>,
                 event_bus: &Arc<EventBus>,
                 sid: &str,
                 process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                    let (parsed_events, _) = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.flush()
                    };
                    for event in parsed_events {
                        if let Err(err) = chat_sessions.append_event(sid, event.clone()) {
                            log::warn!("Failed to persist Codex event for {}: {}", sid, err);
                        }
                        event_bus.emit(&format!("codex:event:{}", sid), &event);
                    }
                    process_arc.lock().unwrap().take();
                };

            // Use blocking receive - no polling needed
            while let Ok(event) = event_receiver.recv() {
                match event {
                    ProcessEvent::Stdout(line) => {
                        log::debug!("codex stdout [{}]: {}", sid, line);
                        log_line(&log_file, "STDOUT", &line);

                        // Also emit raw stdout for JSON-RPC response handling in frontend
                        event_bus.emit(&format!("codex:stdout:{}", sid), &line);

                        // Parse through CodexParser
                        let (parsed_events, pending_requests) = {
                            let mut parser = parser_arc.lock().unwrap();
                            parser.feed(&format!("{line}\n"))
                        };

                        // Handle parsed events
                        for event in parsed_events {
                            // Check if this is a ToolApproval that we can auto-approve
                            let event_to_emit = check_auto_approval(
                                &approval_manager,
                                &project_name,
                                event,
                                &process_arc,
                                &log_file,
                            );

                            if let Err(err) =
                                chat_sessions.append_event(&sid, event_to_emit.clone())
                            {
                                log::warn!("Failed to persist Codex event for {}: {}", sid, err);
                            }
                            event_bus.emit(&format!("codex:event:{}", sid), &event_to_emit);
                        }

                        // Handle pending requests that weren't ToolApproval events
                        for pending in pending_requests {
                            let known_methods = [
                                "item/commandExecution/requestApproval",
                                "item/fileChange/requestApproval",
                                "item/tool/requestUserInput",
                            ];
                            if !known_methods.contains(&pending.method.as_str()) {
                                log::warn!(
                                    "Auto-accepting unknown Codex request: {}",
                                    pending.method
                                );
                                let response = build_approval_response(&pending.id.to_string());
                                log_line(&log_file, "STDIN", &response);
                                if let Ok(guard) = process_arc.lock() {
                                    if let Some(ref process) = *guard {
                                        let _ = process.write_stdin(&response);
                                    }
                                }
                            }
                        }
                    }
                    ProcessEvent::Stderr(line) => {
                        log::warn!("codex stderr [{}]: {}", sid, line);
                        log_line(&log_file, "STDERR", &line);
                        event_bus.emit(&format!("codex:stderr:{}", sid), &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
                        event_bus.emit(&format!("codex:close:{}", sid), &exit);
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close anyway
            flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
            event_bus.emit(
                &format!("codex:close:{}", sid),
                &AgentExit {
                    code: 0,
                    signal: None,
                },
            );
        });

        Ok(())
    }

    /// Write data to stdin of a running process.
    pub fn write_stdin(&self, server_id: &str, data: &str) -> Result<(), String> {
        let map = self.servers.lock().unwrap();
        let entry = map
            .get(server_id)
            .ok_or_else(|| format!("No codex server for {}", server_id))?;
        log_line(&entry.log_file, "STDIN", data);

        let guard = entry.process.lock().unwrap();
        if let Some(ref process) = *guard {
            process.write_stdin(data)
        } else {
            Err(format!("No active stdin for codex server {}", server_id))
        }
    }

    /// Stop a running process.
    pub fn stop(&self, server_id: &str) {
        let map = self.servers.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }
}

/// Build a JSON-RPC response to send approval to the Codex agent.
fn build_approval_response(request_id: &str) -> String {
    let id_value: serde_json::Value = if request_id.chars().all(|c| c.is_ascii_digit()) {
        serde_json::Value::Number(request_id.parse::<i64>().unwrap_or(0).into())
    } else {
        serde_json::Value::String(request_id.to_string())
    };

    let response = serde_json::json!({
        "id": id_value,
        "result": { "decision": "accept" }
    });
    response.to_string()
}

/// Check if a ToolApproval event should be auto-approved based on project settings.
fn check_auto_approval(
    approval_manager: &Arc<ProjectApprovalManager>,
    project_name: &str,
    event: AgentEvent,
    process_arc: &Arc<Mutex<Option<AgentProcess>>>,
    log_file: &LogHandle,
) -> AgentEvent {
    match &event {
        AgentEvent::ToolApproval {
            request_id,
            name,
            input,
            display_input,
            prefixes,
            ..
        } => {
            let prefixes_vec: Vec<String> = prefixes.as_ref().cloned().unwrap_or_default();

            let should_approve =
                approval_manager.should_auto_approve(project_name, name, &prefixes_vec);

            log::info!(
                "Checking approval for {} with prefixes {:?} -> {}",
                name,
                prefixes_vec,
                should_approve
            );

            if should_approve {
                let response = build_approval_response(request_id);
                log_line(log_file, "STDIN", &response);
                log::info!(
                    "Auto-approving {} for project {} (prefixes: {:?})",
                    name,
                    project_name,
                    prefixes_vec
                );

                if let Ok(guard) = process_arc.lock() {
                    if let Some(ref process) = *guard {
                        let _ = process.write_stdin(&response);
                    }
                }

                AgentEvent::ToolApproval {
                    request_id: request_id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                    display_input: display_input.clone(),
                    prefixes: prefixes.clone(),
                    auto_approved: true,
                    is_processed: None,
                }
            } else {
                event
            }
        }
        _ => event,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_sandbox_spec_uses_codex_agent_kind_and_paths() {
        let spec = build_codex_sandbox_spec(
            "/tmp/ws",
            Some("/tmp/repo/.git"),
            vec![("OVERSEER_API_TOKEN".to_string(), "tok".to_string())],
        )
        .expect("spec builds with a git dir");

        assert!(matches!(spec.agent, AgentKind::Codex));
        assert!(spec.workspace_path.ends_with("ws"));
        assert!(spec.git_common_dir.ends_with(".git"));
        // The git-API env is carried through to the scrubbed sandbox env.
        assert_eq!(
            spec.extra_env,
            vec![("OVERSEER_API_TOKEN".to_string(), "tok".to_string())]
        );
        // Codex has no CLAUDE_CONFIG_DIR override.
        assert!(spec.claude_config_dir.is_none());
    }

    #[test]
    fn codex_sandbox_spec_requires_git_dir() {
        let err = build_codex_sandbox_spec("/tmp/ws", None, vec![]).unwrap_err();
        assert!(err.contains("git directory"), "unexpected error: {err}");
    }
}

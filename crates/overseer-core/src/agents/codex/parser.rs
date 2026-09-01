//! Codex stream parser.
//!
//! Parses line-by-line JSON-RPC output from Codex and emits AgentEvents.
//!
//! # How Codex Differs from Claude
//!
//! Codex uses JSON-RPC 2.0 protocol instead of custom streaming JSON:
//! - **Notifications**: One-way messages (no response expected)
//! - **Requests**: Two-way messages (response required)
//! - **Responses**: Replies to our requests
//!
//! This parser handles notifications and server-initiated requests.
//! The caller is responsible for sending responses to requests.
//!
//! # JSON-RPC 2.0 Basics
//!
//! Notification (no `id` field):
//! ```json
//! {"method": "item/agentMessage/delta", "params": {"delta": "Hello"}}
//! ```
//!
//! Request (has `id` field, expects response):
//! ```json
//! {"method": "item/commandExecution/requestApproval", "id": 5, "params": {"command": "rm -rf"}}
//! ```
//!
//! Response (has `id` field, no `method`):
//! ```json
//! {"id": 5, "result": {"approved": true}}
//! ```

use crate::agents::event::{AgentEvent, ToolMeta, TurnMetadata};
use crate::approval::parse_command_prefixes;

use super::types::{CodexItem, JsonRpcMessage, JsonRpcNotification, JsonRpcServerRequest};

/// Shell basenames whose `-c` wrapper we unwrap for display.
const WRAPPER_SHELLS: [&str; 5] = ["bash", "zsh", "sh", "dash", "ksh"];

/// Strip the login-shell wrapper Codex puts around every command.
///
/// Codex runs shell commands as `/bin/zsh -lc '<command>'` so they inherit the
/// user's PATH. That prefix is noise in the UI, so we unwrap it for display.
///
/// Returns the inner command, or the input unchanged if it isn't a shell wrapper.
///
/// ```ignore
/// strip_shell_wrapper("/bin/zsh -lc 'git status'") == "git status"
/// strip_shell_wrapper("git status") == "git status"
/// ```
pub fn strip_shell_wrapper(command: &str) -> String {
    let trimmed = command.trim();

    // shlex::split handles the quoting, so `-lc 'echo "a b"'` comes back as
    // three tokens with the inner command intact.
    let Some(tokens) = shlex::split(trimmed) else {
        return trimmed.to_string();
    };

    // Need at least: shell, flags, command
    if tokens.len() < 3 {
        return trimmed.to_string();
    }

    let shell_name = std::path::Path::new(&tokens[0])
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if !WRAPPER_SHELLS.contains(&shell_name) {
        return trimmed.to_string();
    }

    // Everything between the shell and the last token must be flags built from
    // -l (login), -i (interactive) and -c (command), and one of them must be -c.
    let flags = &tokens[1..tokens.len() - 1];
    let all_flags = flags
        .iter()
        .all(|f| f.starts_with('-') && f.len() > 1 && f[1..].chars().all(|c| "lic".contains(c)));
    let has_command_flag = flags.iter().any(|f| f.contains('c'));
    if !all_flags || !has_command_flag {
        return trimmed.to_string();
    }

    tokens[tokens.len() - 1].clone()
}

/// Pull a human-readable message out of a Codex `error` notification's params.
///
/// Codex builds have shipped the error under a few different shapes, so try
/// each in turn:
/// - `params.message` — the documented shape
/// - `params.error.message` (+ `codexErrorInfo`) — mirrors `turn.error`
/// - `params.error` as a plain string
///
/// If none match, fall back to the raw params JSON instead of a bare
/// "Unknown error", so the actual error is never hidden.
fn extract_error_message(params: &serde_json::Value) -> String {
    if let Some(msg) = params.get("message").and_then(|v| v.as_str()) {
        return msg.to_string();
    }

    if let Some(error) = params.get("error") {
        if let Some(msg) = error.get("message").and_then(|v| v.as_str()) {
            if let Some(info) = error.get("codexErrorInfo").and_then(|v| v.as_str()) {
                return format!("{msg} ({info})");
            }
            return msg.to_string();
        }
        if let Some(msg) = error.as_str() {
            return msg.to_string();
        }
    }

    // Empty params tells us nothing; anything else, show it verbatim.
    if params.as_object().is_some_and(|o| o.is_empty()) {
        return "Unknown error".to_string();
    }
    params.to_string()
}

/// Reconstruct before/after file contents from a unified diff.
///
/// Codex sends edits as a unified diff, but the diff viewer wants the old and
/// new file contents so it can render its own diff. We rebuild both from the
/// hunk lines: context lines (` `) go to both sides, `-` lines to the old side,
/// `+` lines to the new side. Header lines (`@@`, `---`/`+++`, `\ No newline`)
/// are skipped. Line numbers are relative to the changed region, not the whole
/// file, which is fine for a preview.
///
/// Returns `(old_contents, new_contents, lines_added, lines_removed)`.
fn reconstruct_edit(diff: &str) -> (String, String, usize, usize) {
    let mut old_lines: Vec<&str> = Vec::new();
    let mut new_lines: Vec<&str> = Vec::new();
    let mut added = 0usize;
    let mut removed = 0usize;

    for line in diff.lines() {
        // Skip hunk/file headers and the no-newline marker.
        if line.starts_with("@@")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with('\\')
        {
            continue;
        }

        match line.as_bytes().first() {
            Some(b'+') => {
                new_lines.push(&line[1..]);
                added += 1;
            }
            Some(b'-') => {
                old_lines.push(&line[1..]);
                removed += 1;
            }
            // Context line — leading space (or a blank line) belongs to both sides.
            _ => {
                let content = line.strip_prefix(' ').unwrap_or(line);
                old_lines.push(content);
                new_lines.push(content);
            }
        }
    }

    (old_lines.join("\n"), new_lines.join("\n"), added, removed)
}

/// Result type for server requests that need a response.
///
/// When Codex sends a request (not notification), it expects us to respond.
/// This struct captures the info needed to send that response later.
///
/// # Usage Pattern
///
/// 1. Parser returns `(events, pending_requests)`
/// 2. Caller displays events to user
/// 3. When user approves/denies, caller uses `pending.id` to send response
/// 4. Codex continues after receiving response
#[derive(Debug, Clone)]
pub struct ServerRequestPending {
    /// The request ID to use in the response.
    ///
    /// # Rust Concept: serde_json::Value for Dynamic IDs
    ///
    /// JSON-RPC allows IDs to be strings, numbers, or null.
    /// `serde_json::Value` handles all these cases dynamically.
    /// When responding, we echo back this exact value.
    pub id: serde_json::Value,

    /// The method name of the request.
    ///
    /// Examples:
    /// - "item/commandExecution/requestApproval"
    /// - "item/fileChange/requestApproval"
    pub method: String,
}

/// Parser state for a Codex conversation.
///
/// # Differences from ClaudeParser
///
/// 1. Returns `(Vec<AgentEvent>, Vec<ServerRequestPending>)` instead of just events
/// 2. Tracks command execution state (are we inside a command?)
/// 3. Uses JSON-RPC message types instead of custom event types
#[derive(Debug, Default)]
pub struct CodexParser {
    /// Thread ID (session ID) for this conversation.
    ///
    /// Codex calls it "thread_id", we map it to session_id for consistency.
    thread_id: Option<String>,

    /// Buffer for incomplete lines.
    ///
    /// Same buffering pattern as ClaudeParser — data arrives in chunks,
    /// we buffer until we have complete newline-terminated lines.
    buffer: String,

    /// Track whether we're currently streaming command output.
    ///
    /// When a command starts, we set this to true.
    /// When it completes, we set it back to false.
    /// This helps the UI know when to show the command output area.
    in_command_execution: bool,

    /// Usage reported for the active turn by `thread/tokenUsage/updated`.
    pending_turn_metadata: Option<TurnMetadata>,
}

/// # Rust Concept: Default Trait
///
/// `#[derive(Default)]` generates a `default()` function that creates
/// the struct with all fields set to their default values:
/// - `Option<T>` → `None`
/// - `String` → `""`
/// - `bool` → `false`
/// - `Vec<T>` → empty vector
impl CodexParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the thread ID (session ID) if one has been set.
    pub fn thread_id(&self) -> Option<&str> {
        self.thread_id.as_deref()
    }

    /// Set the thread ID (for session continuity).
    pub fn set_thread_id(&mut self, thread_id: Option<String>) {
        self.thread_id = thread_id;
    }

    /// Check if we're currently in a command execution.
    ///
    /// # Why This Matters
    ///
    /// The UI uses this to:
    /// - Show a "running command" indicator
    /// - Route output deltas to the terminal area
    /// - Know when to hide the command UI
    pub fn in_command_execution(&self) -> bool {
        self.in_command_execution
    }

    /// Feed data to the parser and collect emitted events.
    ///
    /// Returns a tuple of (events, pending_server_requests).
    /// Server requests need to be responded to by the caller.
    ///
    /// # Rust Concept: Returning Tuples
    ///
    /// `(Vec<AgentEvent>, Vec<ServerRequestPending>)` is a tuple type.
    /// Tuples group multiple values of different types.
    ///
    /// Access tuple elements by index: `result.0` and `result.1`
    /// Or destructure: `let (events, pending) = parser.feed(data);`
    pub fn feed(&mut self, data: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let mut events = Vec::new();
        let mut pending_requests = Vec::new();

        // Append data to buffer
        self.buffer.push_str(data);

        // Take ownership of buffer to avoid borrow issues
        // (Same pattern as ClaudeParser — see that file for detailed explanation)
        let buffer = std::mem::take(&mut self.buffer);
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        // Keep the last incomplete line in the buffer
        if let Some(incomplete) = lines.pop() {
            self.buffer = incomplete.to_string();
        }

        // Process each complete line
        for line in lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                // parse_line returns a tuple, we extend both vectors
                let (line_events, line_pending) = self.parse_line(trimmed);
                events.extend(line_events);
                pending_requests.extend(line_pending);
            }
        }

        (events, pending_requests)
    }

    /// Flush any remaining buffered content.
    pub fn flush(&mut self) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let remaining = std::mem::take(&mut self.buffer);
        let trimmed = remaining.trim();
        if !trimmed.is_empty() {
            self.parse_line(trimmed)
        } else {
            (Vec::new(), Vec::new())
        }
    }

    /// Parse a single complete line of JSON.
    ///
    /// # Rust Concept: Pattern Matching on Enums
    ///
    /// `JsonRpcMessage` is an enum with three variants:
    /// - `ServerRequest` — Codex asking us something
    /// - `Response` — Reply to something we asked
    /// - `Notification` — One-way message from Codex
    ///
    /// We use `match` to handle each variant differently.
    fn parse_line(&mut self, line: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        // Try to parse as a JSON-RPC message
        //
        // The `JsonRpcMessage` enum uses #[serde(untagged)] which means
        // serde will try each variant in order until one matches.
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => return (Vec::new(), Vec::new()), // Invalid JSON, skip
        };

        // Handle each message type
        match msg {
            // Responses are replies to requests WE sent (e.g., thread/start)
            // We don't emit events for these — the caller handles them directly
            JsonRpcMessage::Response(_resp) => (Vec::new(), Vec::new()),

            // Server requests need a response from us
            // Return both events (to show UI) and pending (to track response)
            JsonRpcMessage::ServerRequest(req) => self.handle_server_request(&req),

            // Notifications are fire-and-forget messages
            // We just emit events, no response needed
            JsonRpcMessage::Notification(notif) => (self.handle_notification(&notif), Vec::new()),
        }
    }

    /// Handle a server-initiated request.
    ///
    /// Server requests are Codex asking us for permission or input.
    /// We emit events for the UI and return pending requests for tracking.
    ///
    /// # Rust Concept: &self vs &mut self
    ///
    /// This method takes `&self` (immutable borrow) because it doesn't
    /// modify parser state. It just translates a request to events.
    /// Compare to `handle_notification` which takes `&mut self` because
    /// it updates `in_command_execution`.
    fn handle_server_request(
        &self,
        req: &JsonRpcServerRequest,
    ) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        // Get params, defaulting to empty object if missing
        //
        // .clone() creates a copy of the Option<Value>
        // .unwrap_or(...) extracts the value or uses the default
        // serde_json::json!({}) creates an empty JSON object
        let params = req.params.clone().unwrap_or(serde_json::json!({}));

        // Create pending request for caller to track
        let pending = ServerRequestPending {
            id: req.id.clone(),
            method: req.method.clone(),
        };

        // Match on the method name
        //
        // .as_str() converts String to &str for pattern matching
        match req.method.as_str() {
            // Command approval request (e.g., "rm -rf test")
            "item/commandExecution/requestApproval" => {
                // Extract the actual command from commandActions, not the shell-wrapped command.
                // Codex wraps commands in /bin/zsh -lc 'actual command', so we need to look at
                // commandActions[0].command for the real command to parse prefixes from.
                //
                // params.commandActions is an array like:
                // [{"type": "unknown", "command": "pnpm install"}]
                let actual_command = params
                    .get("commandActions")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.get("command"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // Fall back to the shell-wrapped command if commandActions is empty
                let command = if actual_command.is_empty() {
                    strip_shell_wrapper(
                        params.get("command").and_then(|v| v.as_str()).unwrap_or(""),
                    )
                } else {
                    actual_command
                };

                // Parse command into prefixes for auto-approval
                let prefixes = parse_command_prefixes(&command);

                let event = AgentEvent::ToolApproval {
                    // Convert JSON Value to string for request_id
                    request_id: req.id.to_string(),
                    name: "Bash".to_string(),
                    input: params,
                    display_input: command,
                    prefixes: Some(prefixes),
                    auto_approved: false,
                    is_processed: None,
                };

                (vec![event], vec![pending])
            }

            // File change approval request
            "item/fileChange/requestApproval" => {
                // Pretty-print params for display
                //
                // .unwrap_or_else(|_| ...) is like .unwrap_or() but lazily
                // evaluates the default. Useful when default is expensive.
                let display_input =
                    serde_json::to_string_pretty(&params).unwrap_or_else(|_| "{}".to_string());

                let event = AgentEvent::ToolApproval {
                    request_id: req.id.to_string(),
                    name: "Edit".to_string(),
                    input: params,
                    display_input,
                    prefixes: None, // No command prefixes for file changes
                    auto_approved: false,
                    is_processed: None,
                };

                (vec![event], vec![pending])
            }

            // User input request (custom tool)
            "item/tool/requestUserInput" => {
                let display_input =
                    serde_json::to_string_pretty(&params).unwrap_or_else(|_| "{}".to_string());

                let event = AgentEvent::ToolApproval {
                    request_id: req.id.to_string(),
                    name: "UserInput".to_string(),
                    input: params,
                    display_input,
                    prefixes: None,
                    auto_approved: false,
                    is_processed: None,
                };

                (vec![event], vec![pending])
            }

            // Unknown request — return pending so caller can auto-accept
            //
            // We don't emit events for unknown requests, but we still
            // need to respond to them. The caller should auto-approve.
            _ => (Vec::new(), vec![pending]),
        }
    }

    /// Handle a notification.
    ///
    /// Notifications are one-way messages from Codex. No response needed.
    /// We emit events for the UI to display.
    ///
    /// # Rust Concept: &mut self
    ///
    /// This method takes `&mut self` because it modifies
    /// `self.in_command_execution` when commands start/complete.
    fn handle_notification(&mut self, notif: &JsonRpcNotification) -> Vec<AgentEvent> {
        // Get params, defaulting to empty object
        let params = notif.params.clone().unwrap_or(serde_json::json!({}));

        match notif.method.as_str() {
            "turn/started" => {
                self.pending_turn_metadata = None;
                Vec::new()
            }

            // Streaming text delta from agent
            //
            // This is the main text output — like TypeScript's `text` in ChatStore
            "item/agentMessage/delta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    return vec![AgentEvent::Text {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Item started (command, file change, tool call)
            //
            // Different item types have different fields.
            // We parse into CodexItem struct to handle all cases.
            "item/started" => {
                // Try to extract and parse the item
                //
                // Rust Concept: Nested match with early return
                //
                // This pattern is common: try to parse, return empty if failed.
                // The `match` inside `match` handles nested Option/Result.
                let item: CodexItem = match params.get("item") {
                    Some(v) => match serde_json::from_value(v.clone()) {
                        Ok(i) => i,
                        Err(_) => return Vec::new(),
                    },
                    None => return Vec::new(),
                };

                // Handle different item types
                match item.item_type.as_str() {
                    // Command execution started
                    "commandExecution" => {
                        // Update state — we're now in a command
                        self.in_command_execution = true;

                        // Format command like Claude's Bash tool, without Codex's
                        // `/bin/zsh -lc '...'` wrapper.
                        let command = strip_shell_wrapper(item.command.as_deref().unwrap_or(""));
                        let input = serde_json::json!({ "command": command });
                        let input_str = serde_json::to_string_pretty(&input)
                            .unwrap_or_else(|_| "{}".to_string());

                        vec![AgentEvent::Message {
                            content: format!("[Bash]\n{input_str}"),
                            tool_meta: Some(ToolMeta {
                                tool_name: "Bash".to_string(),
                                lines_added: None,
                                lines_removed: None,
                            }),
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }]
                    }

                    // File change started. One apply_patch may touch several
                    // files, so emit one Edit message per changed file, each with
                    // the file path and reconstructed before/after contents so the
                    // UI can show a real diff.
                    "fileChange" => {
                        let changes = item.changes.unwrap_or_default();

                        changes
                            .into_iter()
                            .map(|change| {
                                let diff = change.diff.as_deref().unwrap_or("");
                                let (old_string, new_string, added, removed) =
                                    reconstruct_edit(diff);

                                let input = serde_json::json!({
                                    "file_path": change.path,
                                    "old_string": old_string,
                                    "new_string": new_string,
                                });
                                let input_str = serde_json::to_string_pretty(&input)
                                    .unwrap_or_else(|_| "{}".to_string());

                                AgentEvent::Message {
                                    content: format!("[Edit]\n{input_str}"),
                                    tool_meta: Some(ToolMeta {
                                        tool_name: "Edit".to_string(),
                                        lines_added: Some(added as u32),
                                        lines_removed: Some(removed as u32),
                                    }),
                                    parent_tool_use_id: None,
                                    tool_use_id: None,
                                    is_info: None,
                                }
                            })
                            .collect()
                    }

                    // MCP tool call (external tools)
                    "mcpToolCall" => {
                        let tool_name = item.tool_name.as_deref().unwrap_or("Tool");

                        // Format arguments as pretty JSON
                        //
                        // This shows a common pattern: transform Option contents
                        // with .map(), then unwrap with a default
                        let args_str = item
                            .arguments
                            .as_ref()
                            .map(|a| {
                                serde_json::to_string_pretty(a).unwrap_or_else(|_| "".to_string())
                            })
                            .unwrap_or_default();

                        let content = if args_str.is_empty() {
                            format!("[{tool_name}]")
                        } else {
                            format!("[{tool_name}]\n{args_str}")
                        };

                        vec![AgentEvent::Message {
                            content,
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }]
                    }

                    // Unknown item type — ignore
                    _ => Vec::new(),
                }
            }

            // Item completed
            "item/completed" => {
                let item: CodexItem = match params.get("item") {
                    Some(v) => match serde_json::from_value(v.clone()) {
                        Ok(i) => i,
                        Err(_) => return Vec::new(),
                    },
                    None => return Vec::new(),
                };

                match item.item_type.as_str() {
                    // Command finished — update state
                    "commandExecution" => {
                        self.in_command_execution = false;
                        Vec::new()
                    }

                    // Agent message completed — emit the final text
                    "agentMessage" => {
                        if let Some(text) = item.text {
                            if !text.is_empty() {
                                return vec![AgentEvent::Message {
                                    content: text,
                                    tool_meta: None,
                                    parent_tool_use_id: None,
                                    tool_use_id: None,
                                    is_info: None,
                                }];
                            }
                        }
                        Vec::new()
                    }

                    _ => Vec::new(),
                }
            }

            // Turn completed — agent is done responding
            "turn/completed" => {
                let mut metadata = self
                    .pending_turn_metadata
                    .take()
                    .unwrap_or_else(TurnMetadata::now);
                metadata.completed_at = Some(chrono::Utc::now());
                vec![AgentEvent::TurnComplete { metadata }]
            }

            // Token usage is cumulative for the thread and includes the most
            // recent turn separately. The latter is what belongs in the footer.
            "thread/tokenUsage/updated" => {
                let Some(usage) = params.get("tokenUsage").and_then(|usage| usage.get("last"))
                else {
                    return Vec::new();
                };
                let token = |field| usage.get(field).and_then(|value| value.as_u64());
                self.pending_turn_metadata = Some(TurnMetadata {
                    completed_at: None,
                    cost_usd: None,
                    duration_ms: None,
                    total_tokens: token("totalTokens"),
                    input_tokens: token("inputTokens"),
                    cache_read_tokens: token("cachedInputTokens"),
                    cache_write_tokens: token("cacheWriteInputTokens"),
                    output_tokens: token("outputTokens"),
                    reasoning_output_tokens: token("reasoningOutputTokens"),
                });
                Vec::new()
            }

            // Command output delta — streaming terminal output
            "item/commandExecution/outputDelta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    // Use BashOutput instead of Text so UI routes to terminal
                    return vec![AgentEvent::BashOutput {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Reasoning delta — agent's thinking
            "item/reasoning/summaryTextDelta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    return vec![AgentEvent::Text {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Error notification
            "error" => {
                let message = extract_error_message(&params);

                vec![AgentEvent::Message {
                    content: format!("Error: {message}"),
                    tool_meta: None,
                    parent_tool_use_id: None,
                    tool_use_id: None,
                    is_info: None,
                }]
            }

            // Informational notifications — ignore
            //
            // Rust Concept: Pattern OR
            //
            // `|` lets you match multiple patterns in one arm.
            // This is cleaner than having multiple arms with the same body.
            "thread/name/updated"
            | "thread/compacted"
            | "account/updated"
            | "account/rateLimits/updated"
            | "deprecationNotice" => Vec::new(),

            // Unknown notification — ignore
            _ => Vec::new(),
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_parser_has_no_thread_id() {
        let parser = CodexParser::new();
        assert!(parser.thread_id().is_none());
    }

    #[test]
    fn set_thread_id() {
        let mut parser = CodexParser::new();
        parser.set_thread_id(Some("thread-123".to_string()));
        assert_eq!(parser.thread_id(), Some("thread-123"));
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = CodexParser::new();
        let (events, pending) = parser.feed("\n");
        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_invalid_json() {
        let mut parser = CodexParser::new();
        let (events, pending) = parser.feed("not json\n");
        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_agent_message_delta() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/agentMessage/delta","params":{"delta":"Hello"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::Text { text } if text == "Hello")));
    }

    #[test]
    fn parse_turn_completed() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"turn/completed","params":{}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnComplete { .. })));
    }

    #[test]
    fn turn_complete_includes_last_turn_token_usage() {
        let mut parser = CodexParser::new();
        parser.feed(r#"{"method":"turn/started","params":{"turn":{"id":"turn-1"}}}
{"method":"thread/tokenUsage/updated","params":{"threadId":"thread-1","turnId":"turn-1","tokenUsage":{"total":{"totalTokens":300,"inputTokens":250,"cachedInputTokens":200,"cacheWriteInputTokens":4,"outputTokens":50,"reasoningOutputTokens":10},"last":{"totalTokens":150,"inputTokens":120,"cachedInputTokens":90,"cacheWriteInputTokens":2,"outputTokens":30,"reasoningOutputTokens":6},"modelContextWindow":258400}}}
"#);

        let (events, _) = parser.feed(r#"{"method":"turn/completed","params":{"turn":{"id":"turn-1"}}}
"#);
        let metadata = events.iter().find_map(|event| match event {
            AgentEvent::TurnComplete { metadata } => Some(metadata),
            _ => None,
        });
        let metadata = metadata.expect("turn should complete");
        assert_eq!(metadata.total_tokens, Some(150));
        assert_eq!(metadata.input_tokens, Some(120));
        assert_eq!(metadata.cache_read_tokens, Some(90));
        assert_eq!(metadata.cache_write_tokens, Some(2));
        assert_eq!(metadata.output_tokens, Some(30));
        assert_eq!(metadata.reasoning_output_tokens, Some(6));
    }

    #[test]
    fn parse_command_execution_started() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"git status"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(parser.in_command_execution());
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Bash]") && meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_command_execution_started_strips_shell_wrapper() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"/bin/zsh -lc 'git status'"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        let content = events
            .iter()
            .find_map(|e| match e {
                AgentEvent::Message { content, .. } => Some(content.clone()),
                _ => None,
            })
            .expect("expected a Bash message");

        assert!(content.contains("git status"), "got: {content}");
        assert!(!content.contains("zsh"), "got: {content}");
    }

    #[test]
    fn strip_shell_wrapper_unwraps_login_shell() {
        assert_eq!(
            strip_shell_wrapper("/bin/zsh -lc 'git status'"),
            "git status"
        );
        assert_eq!(strip_shell_wrapper("/bin/bash -l -c 'ls -la'"), "ls -la");
        assert_eq!(strip_shell_wrapper("bash -c \"echo hi\""), "echo hi");
    }

    #[test]
    fn strip_shell_wrapper_keeps_inner_quotes() {
        assert_eq!(
            strip_shell_wrapper(r#"/bin/zsh -lc 'grep -n "a b" file.txt'"#),
            r#"grep -n "a b" file.txt"#
        );
    }

    #[test]
    fn strip_shell_wrapper_leaves_plain_commands_alone() {
        assert_eq!(strip_shell_wrapper("git status"), "git status");
        assert_eq!(strip_shell_wrapper(""), "");
        // Not a -c invocation: running a script file, keep as-is.
        assert_eq!(
            strip_shell_wrapper("/bin/zsh -l script.sh"),
            "/bin/zsh -l script.sh"
        );
        // Not a shell.
        assert_eq!(
            strip_shell_wrapper("python -c 'print(1)'"),
            "python -c 'print(1)'"
        );
        // Trailing args after the command string — don't guess.
        assert_eq!(
            strip_shell_wrapper("/bin/sh -c 'echo $0' name"),
            "/bin/sh -c 'echo $0' name"
        );
        // Unbalanced quotes: shlex fails, return input untouched.
        assert_eq!(
            strip_shell_wrapper("/bin/zsh -lc 'echo"),
            "/bin/zsh -lc 'echo"
        );
    }

    #[test]
    fn parse_command_execution_completed() {
        let mut parser = CodexParser::new();

        // Start command
        let start = r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"ls"}}}"#;
        let _ = parser.feed(&format!("{start}\n"));
        assert!(parser.in_command_execution());

        // Complete command
        let complete =
            r#"{"method":"item/completed","params":{"item":{"type":"commandExecution"}}}"#;
        let _ = parser.feed(&format!("{complete}\n"));
        assert!(!parser.in_command_execution());
    }

    #[test]
    fn reconstruct_edit_add_and_delete() {
        // Pure addition: old side empty, new side is the content.
        let (old, new, added, removed) = reconstruct_edit("+first\n+second");
        assert_eq!(old, "");
        assert_eq!(new, "first\nsecond");
        assert_eq!((added, removed), (2, 0));

        // Pure deletion: new side empty, old side is the content.
        let (old, new, added, removed) = reconstruct_edit("-gone");
        assert_eq!(old, "gone");
        assert_eq!(new, "");
        assert_eq!((added, removed), (0, 1));
    }

    #[test]
    fn reconstruct_edit_skips_headers() {
        // Hunk headers and no-newline markers must not count as changes.
        let diff = "@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file";
        let (old, new, added, removed) = reconstruct_edit(diff);
        assert_eq!(old, "old");
        assert_eq!(new, "new");
        assert_eq!((added, removed), (1, 1));
    }

    #[test]
    fn parse_command_output_delta() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/commandExecution/outputDelta","params":{"delta":"file.txt\n"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::BashOutput { text } if text == "file.txt\n"
        )));
    }

    #[test]
    fn parse_file_change_started() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"fileChange","changes":[{"path":"test.txt","kind":{"type":"update","move_path":null},"diff":"@@ -1,2 +1,2 @@\n old\n-bye\n+hi"}],"status":"inProgress"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        // One Edit message, carrying the real path and line counts, with
        // before/after contents reconstructed from the unified diff.
        let msg = events
            .iter()
            .find_map(|e| match e {
                AgentEvent::Message {
                    content,
                    tool_meta: Some(meta),
                    ..
                } if meta.tool_name == "Edit" => Some((content, meta)),
                _ => None,
            })
            .expect("Edit message emitted");

        let (content, meta) = msg;
        assert!(content.contains("[Edit]"));
        assert!(content.contains("test.txt"));
        assert!(content.contains("\"old_string\""));
        assert!(content.contains("\"new_string\""));
        assert_eq!(meta.lines_added, Some(1));
        assert_eq!(meta.lines_removed, Some(1));

        // The reconstructed contents diff cleanly: context kept, bye->hi.
        let input: serde_json::Value = {
            let json = content.strip_prefix("[Edit]\n").unwrap();
            serde_json::from_str(json).unwrap()
        };
        assert_eq!(input["file_path"], "test.txt");
        assert_eq!(input["old_string"], "old\nbye");
        assert_eq!(input["new_string"], "old\nhi");
    }

    #[test]
    fn parse_file_change_emits_one_message_per_file() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"fileChange","changes":[{"path":"a.txt","kind":{"type":"add"},"diff":"+alpha"},{"path":"b.txt","kind":{"type":"delete"},"diff":"-beta"}],"status":"inProgress"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        let edits: Vec<&String> = events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::Message { content, .. } if content.contains("[Edit]") => Some(content),
                _ => None,
            })
            .collect();

        assert_eq!(edits.len(), 2);
        assert!(edits.iter().any(|c| c.contains("a.txt")));
        assert!(edits.iter().any(|c| c.contains("b.txt")));
    }

    #[test]
    fn parse_mcp_tool_call() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"mcpToolCall","toolName":"CustomTool","arguments":{"key":"value"}}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("[CustomTool]")
        )));
    }

    #[test]
    fn parse_agent_message_completed() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"Response text"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content == "Response text"
        )));
    }

    #[test]
    fn parse_command_approval_request() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/commandExecution/requestApproval","id":5,"params":{"command":"rm -rf test"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].method, "item/commandExecution/requestApproval");

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, prefixes, .. }
            if name == "Bash" && prefixes.as_ref().is_some_and(|p| p.contains(&"rm".to_string()))
        )));
    }

    #[test]
    fn parse_file_change_approval_request() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/fileChange/requestApproval","id":"req-1","params":{"file":"test.txt"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, .. } if name == "Edit"
        )));
    }

    #[test]
    fn parse_user_input_request() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/tool/requestUserInput","id":10,"params":{"prompt":"Enter value"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, .. } if name == "UserInput"
        )));
    }

    #[test]
    fn parse_error_notification() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"error","params":{"message":"Something went wrong"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("Something went wrong")
        )));
    }

    #[test]
    fn parse_reasoning_delta() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/reasoning/summaryTextDelta","params":{"delta":"thinking..."}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text == "thinking..."
        )));
    }

    #[test]
    fn ignore_informational_notifications() {
        let mut parser = CodexParser::new();

        let notifications = [
            r#"{"method":"thread/name/updated","params":{}}"#,
            r#"{"method":"thread/tokenUsage/updated","params":{}}"#,
            r#"{"method":"account/updated","params":{}}"#,
        ];

        for line in notifications {
            let (events, _) = parser.feed(&format!("{line}\n"));
            assert!(events.is_empty());
        }
    }

    #[test]
    fn unknown_server_request_returns_pending() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"unknown/request","id":99,"params":{}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].method, "unknown/request");
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = CodexParser::new();

        // Send partial data
        let (events1, _) = parser.feed(r#"{"method":"turn/"#);
        assert!(events1.is_empty());

        // Complete the line
        let (events2, _) = parser.feed(r#"completed","params":{}}"#);
        assert!(events2.is_empty()); // Still no newline

        // Send newline
        let (events3, _) = parser.feed("\n");
        assert!(events3
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnComplete { .. })));
    }

    #[test]
    fn response_messages_ignored() {
        let mut parser = CodexParser::new();
        let line = r#"{"id":1,"result":{"thread":{"id":"thread-123"}}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    fn error_content(line: &str) -> String {
        let mut parser = CodexParser::new();
        let (events, _) = parser.feed(&format!("{line}\n"));
        events
            .iter()
            .find_map(|e| match e {
                AgentEvent::Message { content, .. } => Some(content.clone()),
                _ => None,
            })
            .expect("expected a message event")
    }

    #[test]
    fn error_notification_uses_message_field() {
        let line = r#"{"method":"error","params":{"message":"boom"}}"#;
        assert_eq!(error_content(line), "Error: boom");
    }

    #[test]
    fn error_notification_reads_nested_error_object() {
        let line = r#"{"method":"error","params":{"error":{"message":"Context window exceeded","codexErrorInfo":"ContextWindowExceeded"}}}"#;
        assert_eq!(
            error_content(line),
            "Error: Context window exceeded (ContextWindowExceeded)"
        );
    }

    #[test]
    fn error_notification_reads_error_string() {
        let line = r#"{"method":"error","params":{"error":"nope"}}"#;
        assert_eq!(error_content(line), "Error: nope");
    }

    #[test]
    fn error_notification_falls_back_to_raw_params() {
        // No recognizable message field: show the payload rather than hide it.
        let line = r#"{"method":"error","params":{"detail":"weird shape"}}"#;
        assert_eq!(error_content(line), r#"Error: {"detail":"weird shape"}"#);
    }

    #[test]
    fn error_notification_empty_params_is_unknown() {
        let line = r#"{"method":"error","params":{}}"#;
        assert_eq!(error_content(line), "Error: Unknown error");
    }
}

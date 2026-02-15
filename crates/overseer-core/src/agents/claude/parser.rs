//! Claude stream parser.
//!
//! Parses line-by-line JSON output from Claude and emits AgentEvents.
//!
//! # How This Parser Works
//!
//! Claude outputs JSON objects, one per line. This parser:
//! 1. Buffers incoming data (which may arrive in chunks, not complete lines)
//! 2. Splits on newlines to get complete JSON lines
//! 3. Deserializes each line into a `ClaudeStreamEvent`
//! 4. Translates that into our unified `AgentEvent` type
//!
//! # Rust Concepts Used
//!
//! - **Structs with `#[derive]`**: Auto-generates common trait implementations
//! - **`Option<T>`**: Rust's way of handling nullable values (Some or None)
//! - **`Vec<T>`**: Growable array (like JavaScript's Array or TypeScript's T[])
//! - **`impl` blocks**: Define methods on a struct
//! - **`match` expressions**: Pattern matching (like switch but more powerful)
//! - **References (`&`)**: Borrow data without taking ownership
//! - **`String` vs `&str`**: Owned string vs borrowed string slice

use crate::agents::event::{AgentEvent, ToolMeta};
use crate::approval::parse_command_prefixes;

use super::types::{AskUserQuestionInput, ClaudeStreamEvent, ExitPlanModeInput};

/// Parser state for a Claude conversation.
///
/// # Rust Concept: Derive Macros
///
/// `#[derive(Debug, Default)]` automatically implements:
/// - `Debug`: Allows printing with `{:?}` for debugging
/// - `Default`: Provides a default constructor (all fields set to their defaults)
///
/// This saves us from writing boilerplate code manually.
#[derive(Debug, Default)]
pub struct ClaudeParser {
    /// Session ID extracted from events.
    ///
    /// # Rust Concept: Option<T>
    ///
    /// `Option<String>` means this field can be:
    /// - `Some("session-id")` — has a value
    /// - `None` — no value yet
    ///
    /// This is Rust's way of handling null/undefined safely.
    /// You MUST handle both cases; the compiler won't let you forget.
    session_id: Option<String>,

    /// Buffer for incomplete lines.
    ///
    /// # Why We Need This
    ///
    /// Data arrives in chunks from the process. A chunk might be:
    /// - Complete line: `{"type":"result"}\n`
    /// - Partial line: `{"type":"res` (rest comes in next chunk)
    /// - Multiple lines: `{"type":"a"}\n{"type":"b"}\n`
    ///
    /// We buffer incomplete data until we get the full line.
    buffer: String,
}

/// # Rust Concept: impl Blocks
///
/// `impl ClaudeParser` defines methods that belong to the ClaudeParser struct.
/// Think of it like defining methods on a class in TypeScript.
///
/// Methods can take:
/// - `&self` — read-only access to the struct (like `this` in JS, but immutable)
/// - `&mut self` — mutable access (can modify the struct)
/// - `self` — takes ownership (consumes the struct)
impl ClaudeParser {
    /// Create a new parser instance.
    ///
    /// # Rust Concept: Self
    ///
    /// `Self` refers to the type we're implementing (`ClaudeParser`).
    /// `Self::default()` calls the Default trait implementation.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the session ID if one has been received.
    ///
    /// # Rust Concept: as_deref()
    ///
    /// `self.session_id` is `Option<String>`.
    /// `.as_deref()` converts it to `Option<&str>`.
    ///
    /// Why? We want to return a reference (&str), not give away ownership.
    /// - `&String` → `&str` is automatic (deref coercion)
    /// - `Option<String>` → `Option<&str>` needs `.as_deref()`
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Set the session ID (for resuming sessions).
    ///
    /// # Rust Concept: &mut self
    ///
    /// `&mut self` means we're borrowing the struct mutably.
    /// This allows us to modify `self.session_id`.
    /// Only one mutable borrow can exist at a time (prevents data races).
    pub fn set_session_id(&mut self, session_id: Option<String>) {
        self.session_id = session_id;
    }

    /// Feed data to the parser and collect emitted events.
    ///
    /// The data may contain partial lines; these will be buffered until
    /// complete lines are received.
    ///
    /// # Rust Concept: String Ownership and std::mem::take
    ///
    /// The tricky part here is that we need to:
    /// 1. Append to the buffer (needs `&mut self`)
    /// 2. Split the buffer into lines (needs to borrow buffer)
    /// 3. Keep the last incomplete line in the buffer (needs to modify buffer)
    ///
    /// We can't do steps 2 and 3 together because you can't modify
    /// something while it's borrowed. Solution: `std::mem::take()`.
    ///
    /// `std::mem::take(&mut self.buffer)`:
    /// - Replaces `self.buffer` with an empty String
    /// - Returns the original buffer value
    /// - Now we own the data and can split it freely
    pub fn feed(&mut self, data: &str) -> Vec<AgentEvent> {
        // Create an empty vector to collect events
        // Vec::new() creates an empty growable array
        let mut events = Vec::new();

        // Append incoming data to our buffer
        // push_str() appends a string slice to an owned String
        self.buffer.push_str(data);

        // Take ownership of buffer to avoid borrow checker issues
        //
        // BEFORE: self.buffer contains all the data, we have &mut self
        // AFTER: self.buffer is empty String, `buffer` variable owns the data
        //
        // This is a common pattern when you need to process owned data
        // while also modifying the struct that held it.
        let buffer = std::mem::take(&mut self.buffer);

        // Split the buffer by newlines into a vector of string slices
        //
        // Rust Concept: Iterators and collect()
        //
        // .split('\n') returns an iterator over &str slices
        // .collect() consumes the iterator and builds a Vec<&str>
        //
        // The `: Vec<&str>` type annotation tells collect() what to build.
        // (Rust can often infer this, but it's clearer to be explicit)
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        // Keep the last incomplete line in the buffer
        //
        // Rust Concept: if let
        //
        // `if let Some(x) = expr` is pattern matching in an if.
        // If lines.pop() returns Some(string), bind it to `incomplete`.
        // If it returns None, skip the block entirely.
        //
        // .pop() removes and returns the last element (like JS array.pop())
        if let Some(incomplete) = lines.pop() {
            // .to_string() converts &str (borrowed) to String (owned)
            // We need owned data because self.buffer owns its contents
            self.buffer = incomplete.to_string();
        }

        // Process each complete line
        //
        // Rust Concept: for loops
        //
        // `for line in lines` consumes the vector, giving us each &str
        // This is called "into_iter" iteration — we take ownership of items
        for line in lines {
            // .trim() removes leading/trailing whitespace, returns &str
            let trimmed = line.trim();

            // Only parse non-empty lines
            // .is_empty() returns true if the string has zero length
            if !trimmed.is_empty() {
                // .extend() appends all elements from an iterator
                // parse_line() returns Vec<AgentEvent>, .extend() adds all
                events.extend(self.parse_line(trimmed));
            }
        }

        events
    }

    /// Flush any remaining buffered content.
    ///
    /// Call this when the stream ends to process any final partial line.
    ///
    /// # When To Use
    ///
    /// When the agent process exits, there might be a final line without
    /// a trailing newline. Call flush() to process it.
    pub fn flush(&mut self) -> Vec<AgentEvent> {
        let mut events = Vec::new();

        // Take the remaining buffer contents
        let remaining = std::mem::take(&mut self.buffer);
        let trimmed = remaining.trim();

        if !trimmed.is_empty() {
            events.extend(self.parse_line(trimmed));
        }

        events
    }

    /// Parse a single complete line of JSON.
    ///
    /// # Rust Concept: Result and match
    ///
    /// `serde_json::from_str` returns `Result<T, E>`:
    /// - `Ok(value)` — parsing succeeded
    /// - `Err(error)` — parsing failed
    ///
    /// We use `match` to handle both cases. Unlike exceptions in JS,
    /// Rust forces you to handle errors explicitly.
    fn parse_line(&mut self, line: &str) -> Vec<AgentEvent> {
        // Try to parse the JSON line
        //
        // serde_json::from_str::<ClaudeStreamEvent> tells Rust what type to parse into
        // The turbofish syntax ::<T> specifies type parameters explicitly
        let event: ClaudeStreamEvent = match serde_json::from_str(line) {
            Ok(e) => e,                  // Parsing succeeded, bind result to `e`
            Err(_) => return Vec::new(), // Parsing failed, return empty vec
        };

        let mut events = Vec::new();

        // Extract session_id if present (first time only)
        //
        // Rust Concept: if let with ref
        //
        // `if let Some(ref sid) = event.session_id`:
        // - `Some(...)` matches if session_id has a value
        // - `ref sid` borrows the inner value instead of moving it
        // - We need `ref` because we want to use event.session_id again later
        if let Some(ref sid) = event.session_id {
            // Only emit SessionId event once (when session_id is None)
            if self.session_id.is_none() {
                // .clone() creates a deep copy of the String
                // We need to clone because we're storing it in two places
                self.session_id = Some(sid.clone());

                events.push(AgentEvent::SessionId {
                    session_id: sid.clone(),
                });
            }
        }

        // Translate the event type to our AgentEvent format
        events.extend(self.translate_event(&event));

        events
    }

    /// Translate a Claude stream event into zero or more AgentEvents.
    ///
    /// # Rust Concept: Pattern Matching with match
    ///
    /// `match` is like a super-powered switch statement:
    /// - Must handle ALL possible cases (exhaustive)
    /// - Can match on patterns, not just values
    /// - Can destructure data while matching
    /// - Returns a value (it's an expression)
    fn translate_event(&self, event: &ClaudeStreamEvent) -> Vec<AgentEvent> {
        // Clone parent_tool_use_id for use in events
        // We clone here because we'll use it multiple times
        let parent_tool_use_id = event.parent_tool_use_id.clone();

        // Match on the event type string
        //
        // .as_str() converts String to &str for pattern matching
        // String literals like "assistant" are &str, so we need conversion
        match event.event_type.as_str() {
            // ================================================
            // "assistant" event — contains the full message
            // ================================================
            "assistant" => {
                let mut events = Vec::new();

                // If there's a message, process each content block
                //
                // Rust Concept: if let with ref again
                //
                // `if let Some(ref message) = event.message` checks if
                // message exists and borrows it if so.
                if let Some(ref message) = event.message {
                    // Iterate over content blocks (text, thinking, tool_use)
                    //
                    // .iter() creates an iterator that borrows items
                    // (vs .into_iter() which would move/consume items)
                    for block in &message.content {
                        // Match on the block type
                        match block.block_type.as_str() {
                            // "thinking" blocks are Claude's internal reasoning
                            "thinking" => {
                                if let Some(ref thinking) = block.thinking {
                                    events.push(AgentEvent::Message {
                                        content: thinking.clone(),
                                        // Some() wraps a value in Option
                                        tool_meta: Some(ToolMeta {
                                            tool_name: "Thinking".to_string(),
                                            lines_added: Some(0),
                                            lines_removed: Some(0),
                                        }),
                                        parent_tool_use_id: parent_tool_use_id.clone(),
                                        tool_use_id: None,
                                        is_info: None,
                                    });
                                }
                            }

                            // "text" blocks are Claude's text responses
                            "text" => {
                                if let Some(ref text) = block.text {
                                    let trimmed = text.trim();

                                    // Only emit non-empty text
                                    if !trimmed.is_empty() {
                                        events.push(AgentEvent::Message {
                                            content: trimmed.to_string(),
                                            tool_meta: None,
                                            parent_tool_use_id: parent_tool_use_id.clone(),
                                            tool_use_id: None,
                                            is_info: None,
                                        });
                                    }
                                }
                            }

                            // "tool_use" blocks are tool calls (Bash, Edit, etc.)
                            "tool_use" => {
                                // Get tool name, defaulting to "Unknown" if missing
                                //
                                // .as_deref() converts Option<String> to Option<&str>
                                // .unwrap_or("default") returns the value or a default
                                let tool_name = block.name.as_deref().unwrap_or("Unknown");

                                // Skip certain tools — they're handled via control_request
                                //
                                // `continue` skips to the next loop iteration
                                // (like `continue` in JavaScript for loops)
                                if tool_name == "AskUserQuestion" || tool_name == "ExitPlanMode" {
                                    continue;
                                }

                                // Serialize tool input as pretty JSON
                                //
                                // Rust Concept: Chained Option methods
                                //
                                // block.input.as_ref() — borrow the Option's contents
                                // .map(|v| ...) — transform if Some, pass through None
                                // .unwrap_or_default() — extract value or use default (empty string)
                                let input_str = block
                                    .input
                                    .as_ref()
                                    .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                                    .unwrap_or_default();

                                // Extract line counts for Edit tool
                                //
                                // This shows nested Option handling with .map()
                                let tool_meta = if tool_name == "Edit" {
                                    block.input.as_ref().map(|input| {
                                        // .get("key") returns Option<&Value>
                                        // .and_then(|v| v.as_str()) chains into Option<&str>
                                        let old_str = input
                                            .get("old_string")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        let new_str = input
                                            .get("new_string")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");

                                        ToolMeta {
                                            tool_name: tool_name.to_string(),
                                            // Count lines by splitting on newlines
                                            //
                                            // .split('\n').count() gives number of lines
                                            // `as u32` casts usize to u32
                                            lines_added: Some(if new_str.is_empty() {
                                                0
                                            } else {
                                                new_str.split('\n').count() as u32
                                            }),
                                            lines_removed: Some(if old_str.is_empty() {
                                                0
                                            } else {
                                                old_str.split('\n').count() as u32
                                            }),
                                        }
                                    })
                                } else {
                                    None
                                };

                                // For Task tools, include the block id for child grouping
                                let tool_use_id = if tool_name == "Task" {
                                    block.id.clone()
                                } else {
                                    None
                                };

                                // Format the content as [ToolName]\n{input}
                                //
                                // Rust Concept: format! macro
                                //
                                // format!() is like template strings in JS but type-safe.
                                // `{tool_name}` interpolates the variable into the string.
                                let content = if input_str.is_empty() {
                                    format!("[{tool_name}]")
                                } else {
                                    format!("[{tool_name}]\n{input_str}")
                                };

                                events.push(AgentEvent::Message {
                                    content,
                                    tool_meta,
                                    parent_tool_use_id: parent_tool_use_id.clone(),
                                    tool_use_id,
                                    is_info: None,
                                });
                            }

                            // Catch-all for unknown block types
                            //
                            // `_` is a wildcard pattern that matches anything
                            // `{}` is an empty block (do nothing)
                            _ => {}
                        }
                    }
                }
                events
            }

            // ================================================
            // "content_block_start" — tool is starting
            // ================================================
            //
            // Shows tool name while input is being streamed
            "content_block_start" => {
                if let Some(ref block) = event.content_block {
                    // == compares values, not references
                    // String comparison in Rust is by value
                    if block.block_type == "tool_use" {
                        if let Some(ref name) = block.name {
                            // Return early with vec![] macro
                            //
                            // vec![...] creates a Vec with the given elements
                            // Like [item] in JS but explicitly a vector
                            return vec![AgentEvent::Text {
                                text: format!("\n[{name}] ..."),
                            }];
                        }
                    }
                }
                Vec::new()
            }

            // ================================================
            // "content_block_delta" — streaming text chunk
            // ================================================
            "content_block_delta" => {
                if let Some(ref delta) = event.delta {
                    if let Some(ref text) = delta.text {
                        return vec![AgentEvent::Text { text: text.clone() }];
                    }
                }
                Vec::new()
            }

            // ================================================
            // "result" — turn is complete
            // ================================================
            //
            // Short form: when the match arm is simple, write it inline
            // `vec![...]` creates a single-element vector
            "result" => vec![AgentEvent::TurnComplete],

            // ================================================
            // "control_request" — tool approval or question
            // ================================================
            //
            // This is Claude asking permission to use a tool
            "control_request" => {
                // Extract request_id, returning empty if missing
                //
                // Rust Concept: Early return with match
                //
                // We match on the Option and either extract the value
                // or return early from the whole function
                let request_id = match &event.request_id {
                    Some(id) => id.clone(),
                    None => return Vec::new(),
                };

                // Match on request.subtype being "can_use_tool"
                //
                // This pattern extracts `r` only if:
                // 1. event.request is Some
                // 2. r.subtype == "can_use_tool"
                let request = match &event.request {
                    Some(r) if r.subtype == "can_use_tool" => r,
                    _ => return Vec::new(),
                };

                let tool_name = &request.tool_name;

                // Handle AskUserQuestion specially
                if tool_name == "AskUserQuestion" {
                    if let Some(ref input) = request.input {
                        // Try to deserialize the input as AskUserQuestionInput
                        //
                        // serde_json::from_value takes a Value (already parsed JSON)
                        // and deserializes it into a specific type
                        if let Ok(parsed) =
                            serde_json::from_value::<AskUserQuestionInput>(input.clone())
                        {
                            return vec![AgentEvent::Question {
                                request_id,
                                questions: parsed.questions,
                                raw_input: Some(input.clone()),
                            }];
                        }
                    }
                    return Vec::new();
                }

                // Handle ExitPlanMode specially
                if tool_name == "ExitPlanMode" {
                    // Chained Option operations
                    //
                    // This reads as:
                    // 1. Get reference to input if it exists
                    // 2. Try to deserialize it, returning Option
                    // 3. Get the plan field from the result
                    // 4. If any step failed, use empty string
                    let plan_content = request
                        .input
                        .as_ref()
                        .and_then(|input| {
                            serde_json::from_value::<ExitPlanModeInput>(input.clone()).ok()
                        })
                        .and_then(|p| p.plan)
                        .unwrap_or_default();

                    return vec![AgentEvent::PlanApproval {
                        request_id,
                        content: plan_content,
                    }];
                }

                // Regular tool approval
                //
                // serde_json::json! macro creates a serde_json::Value
                // (similar to JSON.parse('{}') in JS)
                let input = request.input.clone().unwrap_or(serde_json::json!({}));

                // Pretty-print the input if it's a non-empty object
                //
                // .as_object() tries to get the Value as a JSON object
                // .is_some_and(|o| ...) is true if Some AND the predicate passes
                let display_input = if input.as_object().is_some_and(|o| !o.is_empty()) {
                    serde_json::to_string_pretty(&input).unwrap_or_default()
                } else {
                    String::new()
                };

                // Extract command prefixes for Bash approval
                //
                // This enables auto-approval of safe command prefixes
                let prefixes = if tool_name == "Bash" {
                    input
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(parse_command_prefixes)
                } else {
                    None
                };

                vec![AgentEvent::ToolApproval {
                    request_id,
                    name: tool_name.clone(),
                    input,
                    display_input,
                    prefixes,
                    auto_approved: false,
                }]
            }

            // Catch-all for unknown event types
            _ => Vec::new(),
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================
//
// # Rust Concept: Test Modules
//
// `#[cfg(test)]` means this module is only compiled when running tests.
// `mod tests` creates a submodule for test functions.
// `use super::*` imports everything from the parent module.
//
// Run tests with: `cargo test -p overseer-core`

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_parser_has_no_session_id() {
        let parser = ClaudeParser::new();
        assert!(parser.session_id().is_none());
    }

    #[test]
    fn set_session_id() {
        let mut parser = ClaudeParser::new();
        parser.set_session_id(Some("test-session".to_string()));
        assert_eq!(parser.session_id(), Some("test-session"));
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = ClaudeParser::new();
        let events = parser.feed("\n");
        assert!(events.is_empty());
    }

    #[test]
    fn parse_invalid_json() {
        let mut parser = ClaudeParser::new();
        let events = parser.feed("not json\n");
        assert!(events.is_empty());
    }

    #[test]
    fn extract_session_id() {
        let mut parser = ClaudeParser::new();
        let _ = parser.feed(r#"{"type":"assistant","session_id":"sess-123","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}"#);
        let _ = parser.feed("\n");
        let _ = parser.flush();

        // Check that session ID was extracted
        assert_eq!(parser.session_id(), Some("sess-123"));
    }

    #[test]
    fn emit_session_id_event() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","session_id":"sess-456","message":{"role":"assistant","content":[]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::SessionId { session_id } if session_id == "sess-456"
        )));
    }

    #[test]
    fn session_id_only_emitted_once() {
        let mut parser = ClaudeParser::new();
        let line1 = r#"{"type":"assistant","session_id":"sess-789","message":{"role":"assistant","content":[]}}"#;
        let line2 = r#"{"type":"assistant","session_id":"sess-789","message":{"role":"assistant","content":[]}}"#;

        let events1 = parser.feed(&format!("{line1}\n"));
        let events2 = parser.feed(&format!("{line2}\n"));

        let session_events1: Vec<_> = events1
            .iter()
            .filter(|e| matches!(e, AgentEvent::SessionId { .. }))
            .collect();
        let session_events2: Vec<_> = events2
            .iter()
            .filter(|e| matches!(e, AgentEvent::SessionId { .. }))
            .collect();

        assert_eq!(session_events1.len(), 1);
        assert_eq!(session_events2.len(), 0);
    }

    #[test]
    fn parse_text_message() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello, world!"}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content == "Hello, world!"
        )));
    }

    #[test]
    fn parse_thinking_block() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Analyzing the problem..."}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content == "Analyzing the problem..." && meta.tool_name == "Thinking"
        )));
    }

    #[test]
    fn parse_tool_use_block() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/test.txt"}}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("[Read]")
        )));
    }

    #[test]
    fn parse_edit_tool_extracts_line_counts() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"test.txt","old_string":"line1\nline2","new_string":"new1\nnew2\nnew3"}}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        let edit_event = events.iter().find(|e| {
            matches!(
                e,
                AgentEvent::Message { tool_meta: Some(meta), .. }
                if meta.tool_name == "Edit"
            )
        });

        assert!(edit_event.is_some());
        if let Some(AgentEvent::Message {
            tool_meta: Some(meta),
            ..
        }) = edit_event
        {
            assert_eq!(meta.lines_removed, Some(2));
            assert_eq!(meta.lines_added, Some(3));
        }
    }

    #[test]
    fn parse_task_tool_includes_id() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Task","id":"task-123","input":{"prompt":"Do something"}}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { tool_use_id: Some(id), .. } if id == "task-123"
        )));
    }

    #[test]
    fn parse_content_block_start() {
        let mut parser = ClaudeParser::new();
        let line =
            r#"{"type":"content_block_start","content_block":{"type":"tool_use","name":"Bash"}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text.contains("[Bash]")
        )));
    }

    #[test]
    fn parse_content_block_delta() {
        let mut parser = ClaudeParser::new();
        let line =
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"streaming"}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text == "streaming"
        )));
    }

    #[test]
    fn parse_result_event() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"result","result":"success"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn parse_tool_approval_request() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"control_request","request_id":"req-123","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm -rf test"}}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { request_id, name, .. }
            if request_id == "req-123" && name == "Bash"
        )));
    }

    #[test]
    fn tool_approval_extracts_command_prefixes() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"control_request","request_id":"req-456","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"git status && npm test"}}}"#;
        let events = parser.feed(&format!("{line}\n"));

        let approval = events
            .iter()
            .find(|e| matches!(e, AgentEvent::ToolApproval { .. }));
        assert!(approval.is_some());
        if let Some(AgentEvent::ToolApproval { prefixes, .. }) = approval {
            let prefixes = prefixes.as_ref().unwrap();
            assert!(prefixes.contains(&"git status".to_string()));
            assert!(prefixes.contains(&"npm test".to_string()));
        }
    }

    #[test]
    fn parse_ask_user_question() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"control_request","request_id":"req-789","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which option?","header":"Choice","options":[{"label":"A","description":"First"}],"multi_select":false}]}}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Question {
                request_id,
                questions,
                ..
            }
            if request_id == "req-789" && questions.len() == 1
        )));
    }

    #[test]
    fn parse_exit_plan_mode() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"control_request","request_id":"req-plan","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"1. Step one\n2. Step two"}}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::PlanApproval { request_id, content }
            if request_id == "req-plan" && content.contains("Step one")
        )));
    }

    #[test]
    fn skip_ask_user_question_in_assistant_block() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"AskUserQuestion","input":{}}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        // Should not emit a Message event for AskUserQuestion
        assert!(!events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("AskUserQuestion")
        )));
    }

    #[test]
    fn skip_exit_plan_mode_in_assistant_block() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"ExitPlanMode","input":{}}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        // Should not emit a Message event for ExitPlanMode
        assert!(!events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("ExitPlanMode")
        )));
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = ClaudeParser::new();

        // Send partial data
        let events1 = parser.feed(r#"{"type":"result","#);
        assert!(events1.is_empty());

        // Complete the line
        let events2 = parser.feed(r#""result":"success"}"#);
        assert!(events2.is_empty()); // Still no newline

        // Send newline
        let events3 = parser.feed("\n");
        assert!(events3
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn flush_processes_remaining_buffer() {
        let mut parser = ClaudeParser::new();

        // Send data without trailing newline
        parser.feed(r#"{"type":"result","result":"success"}"#);

        // Flush should process it
        let events = parser.flush();
        assert!(events.iter().any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn parent_tool_use_id_propagated() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","parent_tool_use_id":"parent-task","message":{"role":"assistant","content":[{"type":"text","text":"Child message"}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { parent_tool_use_id: Some(id), .. }
            if id == "parent-task"
        )));
    }

    #[test]
    fn multiple_content_blocks_emit_multiple_events() {
        let mut parser = ClaudeParser::new();
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"First"},{"type":"text","text":"Second"}]}}"#;
        let events = parser.feed(&format!("{line}\n"));

        let messages: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, AgentEvent::Message { .. }))
            .collect();
        assert_eq!(messages.len(), 2);
    }
}

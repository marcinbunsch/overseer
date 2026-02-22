//! Test support utilities for overseer-core.
//!
//! This module provides shared test infrastructure for testing the core library.
//! It is only compiled when running tests (`#[cfg(test)]`).
//!
//! # Overview
//!
//! Testing the manager layer requires several pieces of infrastructure:
//!
//! 1. **Fixtures** - Pre-built test data (ChatMetadata, AgentEvent, etc.)
//! 2. **Mocks** - Fake implementations of external dependencies (EventBus, ApprovalManager)
//! 3. **Helpers** - Utilities for common test patterns (temp directories, waiting for events)
//!
//! # Design Principles
//!
//! - **Deterministic** - Tests should produce the same results every run
//! - **Isolated** - Each test gets its own temp directory and fresh state
//! - **Fast** - No real I/O, network, or process spawning unless absolutely necessary
//! - **Documented** - Every fixture and mock explains what it's for
//!
//! # Example Usage
//!
//! ```rust,ignore
//! use overseer_core::test_support::*;
//!
//! #[test]
//! fn test_chat_session() {
//!     // Create isolated temp directory that auto-cleans on drop
//!     let test_dir = TestChatDir::new();
//!
//!     // Get pre-built test fixtures
//!     let metadata = sample_chat_metadata("test-chat-1");
//!     let event = sample_user_message("Hello, world!");
//!
//!     // Use mock event bus to capture emitted events
//!     let event_bus = MockEventBus::new();
//!
//!     // ... run your test ...
//!
//!     // Assert on captured events
//!     assert_eq!(event_bus.events().len(), 1);
//! }
//! ```

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use tempfile::TempDir;
use uuid::Uuid;

use crate::agents::event::AgentEvent;
use crate::event_bus::BroadcastEvent;
use crate::persistence::types::ChatMetadata;

// ============================================================================
// FIXTURES - Pre-built test data
// ============================================================================
//
// Fixtures provide consistent, well-documented test data. Using fixtures
// instead of inline construction makes tests more readable and ensures
// consistency across the test suite.

/// Create a sample ChatMetadata for testing.
///
/// # Arguments
///
/// * `id` - The chat ID to use. Pass a unique value per test to avoid collisions.
///
/// # Returns
///
/// A fully-populated ChatMetadata with sensible defaults:
/// - workspace_id: "test-workspace"
/// - label: "Test Chat"
/// - agent_type: "claude"
/// - timestamps: current UTC time
///
/// # Example
///
/// ```rust,ignore
/// let meta = sample_chat_metadata("chat-123");
/// assert_eq!(meta.id, "chat-123");
/// assert_eq!(meta.agent_type, Some("claude".to_string()));
/// ```
pub fn sample_chat_metadata(id: &str) -> ChatMetadata {
    ChatMetadata {
        id: id.to_string(),
        workspace_id: "test-workspace".to_string(),
        label: "Test Chat".to_string(),
        agent_type: Some("claude".to_string()),
        agent_session_id: None,
        model_version: Some("opus".to_string()),
        permission_mode: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

/// Create a sample UserMessage event for testing.
///
/// # Arguments
///
/// * `content` - The message content
///
/// # Returns
///
/// An AgentEvent::UserMessage with:
/// - Unique UUID
/// - Current timestamp
/// - No metadata
///
/// # Example
///
/// ```rust,ignore
/// let event = sample_user_message("Hello, Claude!");
/// match event {
///     AgentEvent::UserMessage { content, .. } => {
///         assert_eq!(content, "Hello, Claude!");
///     }
///     _ => panic!("Expected UserMessage"),
/// }
/// ```
pub fn sample_user_message(content: &str) -> AgentEvent {
    AgentEvent::UserMessage {
        id: Uuid::new_v4().to_string(),
        content: content.to_string(),
        timestamp: Utc::now(),
        meta: None,
    }
}

/// Create a sample Text event for testing streaming output.
///
/// # Arguments
///
/// * `text` - The text content
///
/// # Example
///
/// ```rust,ignore
/// let event = sample_text_event("Thinking about your question...");
/// ```
pub fn sample_text_event(text: &str) -> AgentEvent {
    AgentEvent::Text {
        text: text.to_string(),
    }
}

/// Create a sample Message event (agent response with tool metadata).
///
/// # Arguments
///
/// * `content` - The message content
/// * `tool_name` - Optional tool name if this is tool-related output
///
/// # Example
///
/// ```rust,ignore
/// // Plain message
/// let msg = sample_message("Here's what I found:", None);
///
/// // Message with tool metadata
/// let tool_msg = sample_message("[Bash]\nls -la", Some("Bash"));
/// ```
pub fn sample_message(content: &str, tool_name: Option<&str>) -> AgentEvent {
    AgentEvent::Message {
        content: content.to_string(),
        tool_meta: tool_name.map(|name| crate::agents::event::ToolMeta {
            tool_name: name.to_string(),
            lines_added: None,
            lines_removed: None,
        }),
        parent_tool_use_id: None,
        tool_use_id: None,
        is_info: None,
    }
}

/// Create a sample ToolApproval event for testing auto-approval logic.
///
/// # Arguments
///
/// * `request_id` - The request ID (agent uses this to match responses)
/// * `tool_name` - The tool being requested (e.g., "Bash", "Edit")
/// * `prefixes` - Command prefixes for Bash tools (e.g., ["git", "status"])
///
/// # Returns
///
/// A ToolApproval event with:
/// - auto_approved: false (not yet approved)
/// - is_processed: None
/// - input: empty JSON object
/// - display_input: "{tool_name} command"
///
/// # Example
///
/// ```rust,ignore
/// // Bash command needing approval
/// let bash_approval = sample_tool_approval(
///     "req-123",
///     "Bash",
///     Some(vec!["git", "push"]),
/// );
///
/// // Non-Bash tool
/// let edit_approval = sample_tool_approval("req-456", "Edit", None);
/// ```
pub fn sample_tool_approval(
    request_id: &str,
    tool_name: &str,
    prefixes: Option<Vec<&str>>,
) -> AgentEvent {
    AgentEvent::ToolApproval {
        request_id: request_id.to_string(),
        name: tool_name.to_string(),
        input: serde_json::json!({}),
        display_input: format!("{} command", tool_name),
        prefixes: prefixes.map(|p| p.into_iter().map(String::from).collect()),
        auto_approved: false,
        is_processed: None,
    }
}

/// Create a sample TurnComplete event.
///
/// This event signals that the agent has finished responding to a user message.
pub fn sample_turn_complete() -> AgentEvent {
    AgentEvent::TurnComplete
}

/// Create a sample Done event.
///
/// This event signals that the agent process has exited.
pub fn sample_done() -> AgentEvent {
    AgentEvent::Done
}

/// Create a sample Error event.
///
/// # Arguments
///
/// * `message` - The error message
pub fn sample_error(message: &str) -> AgentEvent {
    AgentEvent::Error {
        message: message.to_string(),
    }
}

// ============================================================================
// TEST DIRECTORY - Isolated filesystem for tests
// ============================================================================
//
// Many tests need to write files (chat sessions, metadata, etc.). Using
// real filesystem paths would cause test interference and leave garbage.
// TestChatDir provides an isolated, auto-cleaning directory for each test.

/// An isolated test directory that auto-cleans on drop.
///
/// Use this whenever a test needs to write files. Each TestChatDir gets
/// a unique temporary directory that is automatically deleted when the
/// TestChatDir goes out of scope.
///
/// # Example
///
/// ```rust,ignore
/// #[test]
/// fn test_file_operations() {
///     let test_dir = TestChatDir::new();
///
///     // Get the path for your test files
///     let config_dir = test_dir.path();
///
///     // ... write files, run tests ...
///
///     // Directory is automatically cleaned up when test_dir is dropped
/// }
/// ```
///
/// # Thread Safety
///
/// Each test should create its own TestChatDir. Do not share TestChatDir
/// instances across tests, as this defeats the isolation purpose.
pub struct TestChatDir {
    /// The underlying tempdir. Dropping this cleans up the directory.
    _temp_dir: TempDir,
    /// Cached path to the temp directory.
    path: PathBuf,
}

impl TestChatDir {
    /// Create a new isolated test directory.
    ///
    /// # Panics
    ///
    /// Panics if the temp directory cannot be created (e.g., disk full).
    /// This is acceptable in tests - a failing test is better than silent corruption.
    pub fn new() -> Self {
        let temp_dir = TempDir::new().expect("Failed to create temp directory for test");
        let path = temp_dir.path().to_path_buf();
        Self {
            _temp_dir: temp_dir,
            path,
        }
    }

    /// Get the path to the test directory.
    ///
    /// Use this as the config_dir for ChatSessionManager or other
    /// components that need a filesystem path.
    pub fn path(&self) -> PathBuf {
        self.path.clone()
    }

    /// Create the standard chat directory structure for a project/workspace.
    ///
    /// Creates: `{path}/chats/{project_name}/{workspace_name}/`
    ///
    /// # Arguments
    ///
    /// * `project_name` - The project name (e.g., "test-project")
    /// * `workspace_name` - The workspace name (e.g., "main")
    ///
    /// # Returns
    ///
    /// The full path to the created directory.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let test_dir = TestChatDir::new();
    /// let chat_dir = test_dir.create_chat_dir("my-project", "feature-branch");
    /// // chat_dir is now: {temp}/chats/my-project/feature-branch/
    /// ```
    pub fn create_chat_dir(&self, project_name: &str, workspace_name: &str) -> PathBuf {
        let dir = self
            .path
            .join("chats")
            .join(project_name)
            .join(workspace_name);
        std::fs::create_dir_all(&dir).expect("Failed to create chat directory");
        dir
    }
}

impl Default for TestChatDir {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// MOCK EVENT BUS - Captures emitted events for assertions
// ============================================================================
//
// The real EventBus uses tokio broadcast channels which are async. For
// synchronous tests, we need a simpler mock that just collects events
// into a vector for later assertion.

/// A mock EventBus that captures all emitted events for testing.
///
/// Unlike the real EventBus which broadcasts to async subscribers, this
/// mock simply collects events into a vector. This makes it easy to
/// assert on what events were emitted during a test.
///
/// # Thread Safety
///
/// MockEventBus is thread-safe and can be shared across threads using Arc.
/// Events are collected in order of emission.
///
/// # Example
///
/// ```rust,ignore
/// let event_bus = Arc::new(MockEventBus::new());
///
/// // Pass to component under test
/// my_component.do_something(Arc::clone(&event_bus));
///
/// // Assert on emitted events
/// let events = event_bus.events();
/// assert_eq!(events.len(), 2);
/// assert_eq!(events[0].event_type, "agent:event:123");
/// ```
pub struct MockEventBus {
    /// Collected events, protected by mutex for thread safety.
    events: Mutex<Vec<BroadcastEvent>>,
}

impl MockEventBus {
    /// Create a new empty MockEventBus.
    pub fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
        }
    }

    /// Emit an event (stores it for later inspection).
    ///
    /// This mimics the real EventBus::emit signature but just stores
    /// the event instead of broadcasting it.
    ///
    /// # Arguments
    ///
    /// * `event_type` - The event type string (e.g., "agent:event:abc123")
    /// * `payload` - The event payload (must be serializable)
    ///
    /// # Returns
    ///
    /// Always returns 1 (simulating one subscriber received the event).
    pub fn emit<T: serde::Serialize>(&self, event_type: &str, payload: &T) -> usize {
        let json_payload = serde_json::to_value(payload).expect("Failed to serialize payload");
        let event = BroadcastEvent::new(event_type, json_payload);

        self.events
            .lock()
            .expect("MockEventBus mutex poisoned")
            .push(event);

        1 // Simulate one subscriber
    }

    /// Get all emitted events.
    ///
    /// Returns a clone of the events vector, so you can call this
    /// multiple times without affecting the stored events.
    pub fn events(&self) -> Vec<BroadcastEvent> {
        self.events
            .lock()
            .expect("MockEventBus mutex poisoned")
            .clone()
    }

    /// Get the number of emitted events.
    pub fn event_count(&self) -> usize {
        self.events
            .lock()
            .expect("MockEventBus mutex poisoned")
            .len()
    }

    /// Clear all collected events.
    ///
    /// Useful when a test has multiple phases and you want to check
    /// events from each phase separately.
    pub fn clear(&self) {
        self.events
            .lock()
            .expect("MockEventBus mutex poisoned")
            .clear();
    }

    /// Find events matching a specific event type.
    ///
    /// # Arguments
    ///
    /// * `event_type` - The event type to filter by (exact match)
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let events = event_bus.events_of_type("agent:event:123");
    /// assert_eq!(events.len(), 3);
    /// ```
    pub fn events_of_type(&self, event_type: &str) -> Vec<BroadcastEvent> {
        self.events()
            .into_iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }

    /// Find events whose type starts with a prefix.
    ///
    /// # Arguments
    ///
    /// * `prefix` - The event type prefix to match
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// // Find all agent events regardless of conversation ID
    /// let agent_events = event_bus.events_with_prefix("agent:");
    /// ```
    pub fn events_with_prefix(&self, prefix: &str) -> Vec<BroadcastEvent> {
        self.events()
            .into_iter()
            .filter(|e| e.event_type.starts_with(prefix))
            .collect()
    }
}

impl Default for MockEventBus {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// MOCK APPROVAL MANAGER - Configurable approval responses
// ============================================================================
//
// The real ProjectApprovalManager loads approvals from disk and has complex
// matching logic. For testing, we need a simple mock that returns whatever
// we configure it to return.

/// A mock approval manager with configurable behavior.
///
/// Use this to test auto-approval logic without touching the filesystem
/// or worrying about real approval configurations.
///
/// # Thread Safety
///
/// MockApprovalManager is thread-safe and can be shared across threads.
///
/// # Example
///
/// ```rust,ignore
/// let approvals = MockApprovalManager::new();
///
/// // Configure to approve "Bash" tool with "git" prefix
/// approvals.add_approval("Bash", vec!["git"]);
///
/// // Now should_auto_approve returns true for matching requests
/// assert!(approvals.should_auto_approve("test-project", "Bash", &["git".to_string()]));
/// assert!(!approvals.should_auto_approve("test-project", "Bash", &["rm".to_string()]));
/// ```
pub struct MockApprovalManager {
    /// Map of tool_name -> approved prefixes.
    /// Empty vec means the tool itself is approved (no prefix check).
    approvals: Mutex<std::collections::HashMap<String, Vec<String>>>,

    /// If true, approve everything regardless of configuration.
    approve_all: Mutex<bool>,
}

impl MockApprovalManager {
    /// Create a new MockApprovalManager that approves nothing by default.
    pub fn new() -> Self {
        Self {
            approvals: Mutex::new(std::collections::HashMap::new()),
            approve_all: Mutex::new(false),
        }
    }

    /// Create a MockApprovalManager that approves everything.
    ///
    /// Useful for tests that don't care about approval logic.
    pub fn approve_all() -> Self {
        Self {
            approvals: Mutex::new(std::collections::HashMap::new()),
            approve_all: Mutex::new(true),
        }
    }

    /// Add an approval rule.
    ///
    /// # Arguments
    ///
    /// * `tool_name` - The tool to approve (e.g., "Bash", "Edit")
    /// * `prefixes` - Command prefixes to approve. Empty vec approves the tool unconditionally.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let approvals = MockApprovalManager::new();
    ///
    /// // Approve all "Read" tool uses
    /// approvals.add_approval("Read", vec![]);
    ///
    /// // Approve "Bash" only for "git" commands
    /// approvals.add_approval("Bash", vec!["git".to_string()]);
    /// ```
    pub fn add_approval(&self, tool_name: &str, prefixes: Vec<String>) {
        self.approvals
            .lock()
            .expect("MockApprovalManager mutex poisoned")
            .insert(tool_name.to_string(), prefixes);
    }

    /// Check if a tool use should be auto-approved.
    ///
    /// This mimics the real ProjectApprovalManager::should_auto_approve signature.
    ///
    /// # Arguments
    ///
    /// * `_project_name` - Ignored in mock (real manager uses this for lookup)
    /// * `tool_name` - The tool being used
    /// * `prefixes` - The command prefixes (for Bash tools)
    ///
    /// # Returns
    ///
    /// true if the tool use should be auto-approved based on configuration.
    pub fn should_auto_approve(
        &self,
        _project_name: &str,
        tool_name: &str,
        prefixes: &[String],
    ) -> bool {
        // If approve_all is set, always approve
        if *self.approve_all.lock().unwrap() {
            return true;
        }

        let approvals = self
            .approvals
            .lock()
            .expect("MockApprovalManager mutex poisoned");

        match approvals.get(tool_name) {
            None => false, // Tool not in approval list
            Some(approved_prefixes) => {
                if approved_prefixes.is_empty() {
                    // Empty vec = approve all uses of this tool
                    true
                } else {
                    // Check if any approved prefix matches
                    prefixes
                        .iter()
                        .any(|p| approved_prefixes.iter().any(|ap| p.starts_with(ap)))
                }
            }
        }
    }
}

impl Default for MockApprovalManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// FAKE AGENT PROCESS - Controlled event emission for testing
// ============================================================================
//
// The real AgentProcess spawns actual OS processes, which is slow and
// non-deterministic. FakeAgentProcess provides a controlled alternative
// that emits events from a predefined script.
//
// Note: The `ProcessSpawner` and `AgentProcessHandle` traits are defined in
// `spawn.rs`. We implement them here for our fake/mock types.

use crate::spawn::{AgentProcessHandle, ProcessEvent, ProcessSpawner, SpawnConfig};
use std::sync::mpsc::{self, Receiver, Sender};

/// A fake agent process for testing without spawning real processes.
///
/// FakeAgentProcess provides complete control over what events are emitted
/// and when, making tests deterministic and fast.
///
/// # How It Works
///
/// 1. Create a FakeAgentProcess
/// 2. Take the receiver (like real AgentProcess)
/// 3. Send events through the sender from your test
/// 4. The component under test receives events from the receiver
///
/// # Example
///
/// ```rust,ignore
/// let fake = FakeAgentProcess::new();
/// let receiver = fake.take_receiver().unwrap();
///
/// // Send events from test
/// fake.send_stdout("Hello from agent");
/// fake.send_exit(0);
///
/// // Component receives events via receiver
/// assert!(matches!(receiver.recv(), Ok(ProcessEvent::Stdout(_))));
/// assert!(matches!(receiver.recv(), Ok(ProcessEvent::Exit(_))));
/// ```
pub struct FakeAgentProcess {
    /// Sender for injecting events.
    sender: Sender<ProcessEvent>,

    /// Receiver for the component under test.
    /// Wrapped in Option so it can be taken once.
    receiver: Mutex<Option<Receiver<ProcessEvent>>>,

    /// Collected stdin writes for assertion.
    stdin_writes: Mutex<Vec<String>>,

    /// Whether the process is "running".
    running: Mutex<bool>,
}

impl FakeAgentProcess {
    /// Create a new fake process.
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        Self {
            sender,
            receiver: Mutex::new(Some(receiver)),
            stdin_writes: Mutex::new(Vec::new()),
            running: Mutex::new(true),
        }
    }

    /// Take the event receiver (can only be called once).
    ///
    /// This mimics the real AgentProcess::take_receiver behavior.
    pub fn take_receiver(&self) -> Option<Receiver<ProcessEvent>> {
        self.receiver.lock().expect("mutex poisoned").take()
    }

    /// Send a stdout line event.
    ///
    /// # Arguments
    ///
    /// * `line` - The line of output (without newline)
    pub fn send_stdout(&self, line: &str) {
        let _ = self.sender.send(ProcessEvent::Stdout(line.to_string()));
    }

    /// Send a stderr line event.
    ///
    /// # Arguments
    ///
    /// * `line` - The line of error output (without newline)
    pub fn send_stderr(&self, line: &str) {
        let _ = self.sender.send(ProcessEvent::Stderr(line.to_string()));
    }

    /// Send an exit event.
    ///
    /// # Arguments
    ///
    /// * `code` - The exit code
    pub fn send_exit(&self, code: i32) {
        *self.running.lock().unwrap() = false;
        let _ = self
            .sender
            .send(ProcessEvent::Exit(crate::shell::AgentExit {
                code,
                signal: None,
            }));
    }

    /// Simulate writing to stdin.
    ///
    /// This doesn't actually write anywhere - it just records the write
    /// so tests can assert on what was "sent" to the process.
    pub fn write_stdin(&self, data: &str) -> Result<(), String> {
        if !*self.running.lock().unwrap() {
            return Err("Process not running".to_string());
        }
        self.stdin_writes
            .lock()
            .expect("mutex poisoned")
            .push(data.to_string());
        Ok(())
    }

    /// Get all data written to stdin.
    pub fn stdin_writes(&self) -> Vec<String> {
        self.stdin_writes.lock().expect("mutex poisoned").clone()
    }

    /// Check if the process is "running".
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }

    /// Stop the process.
    pub fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }

    /// Kill the process.
    pub fn kill(&self) {
        *self.running.lock().unwrap() = false;
    }
}

impl Default for FakeAgentProcess {
    fn default() -> Self {
        Self::new()
    }
}

// Implement AgentProcessHandle (from spawn.rs) for FakeAgentProcess.
// This allows FakeAgentProcess to be used anywhere a real AgentProcess would be.
impl AgentProcessHandle for FakeAgentProcess {
    fn write_stdin(&self, data: &str) -> Result<(), String> {
        if !*self.running.lock().unwrap() {
            return Err("Process not running".to_string());
        }
        self.stdin_writes
            .lock()
            .expect("mutex poisoned")
            .push(data.to_string());
        Ok(())
    }

    fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }

    fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }

    fn kill(&self) {
        *self.running.lock().unwrap() = false;
    }
}

// ============================================================================
// MOCK PROCESS SPAWNER - For testing manager code
// ============================================================================
//
// The real DefaultProcessSpawner (in spawn.rs) spawns actual OS processes.
// MockProcessSpawner returns pre-configured FakeAgentProcess instances instead.

/// A mock process spawner for testing.
///
/// Returns pre-configured FakeAgentProcess instances instead of spawning
/// real processes.
///
/// # Example
///
/// ```rust,ignore
/// let spawner = MockProcessSpawner::new();
///
/// // Pre-configure a fake process
/// let fake = Arc::new(FakeAgentProcess::new());
/// spawner.set_next_process(Arc::clone(&fake));
///
/// // Now when the manager calls spawner.spawn(), it gets our fake
/// let manager = SomeManager::with_spawner(spawner);
/// manager.start(...);
///
/// // Control the fake from the test
/// fake.send_stdout(r#"{"type":"text","text":"Hello"}"#);
/// fake.send_exit(0);
/// ```
pub struct MockProcessSpawner {
    /// Queue of fake processes to return.
    processes: Mutex<Vec<Arc<FakeAgentProcess>>>,

    /// How many times spawn was called.
    spawn_count: Mutex<usize>,

    /// If set, spawn returns this error instead of a process.
    error: Mutex<Option<String>>,
}

impl MockProcessSpawner {
    /// Create a new mock spawner.
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(Vec::new()),
            spawn_count: Mutex::new(0),
            error: Mutex::new(None),
        }
    }

    /// Configure the next call to spawn to return this fake process.
    ///
    /// Processes are returned in FIFO order.
    pub fn add_process(&self, process: Arc<FakeAgentProcess>) {
        self.processes.lock().unwrap().push(process);
    }

    /// Configure spawn to fail with an error.
    pub fn set_error(&self, error: &str) {
        *self.error.lock().unwrap() = Some(error.to_string());
    }

    /// Clear the error (spawn will succeed again).
    pub fn clear_error(&self) {
        *self.error.lock().unwrap() = None;
    }

    /// Get how many times spawn was called.
    pub fn spawn_count(&self) -> usize {
        *self.spawn_count.lock().unwrap()
    }
}

impl Default for MockProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for MockProcessSpawner {
    fn spawn(
        &self,
        _config: SpawnConfig,
    ) -> Result<(Box<dyn AgentProcessHandle>, Receiver<ProcessEvent>), String> {
        *self.spawn_count.lock().unwrap() += 1;

        // Check for configured error
        if let Some(error) = self.error.lock().unwrap().as_ref() {
            return Err(error.clone());
        }

        // Return next configured process, or create a new one
        let process = self
            .processes
            .lock()
            .unwrap()
            .pop()
            .unwrap_or_else(|| Arc::new(FakeAgentProcess::new()));

        // Take the receiver from the fake process
        let receiver = process
            .take_receiver()
            .expect("FakeAgentProcess receiver already taken");

        // Box the Arc<FakeAgentProcess> as Box<dyn AgentProcessHandle>
        // We need to clone the Arc since we're returning a Box
        Ok((Box::new(ArcWrapper(process)), receiver))
    }
}

/// Wrapper to convert Arc<FakeAgentProcess> to Box<dyn AgentProcessHandle>.
///
/// This is needed because we want to keep the Arc for test assertions
/// while also providing a Box to the caller.
struct ArcWrapper(Arc<FakeAgentProcess>);

impl AgentProcessHandle for ArcWrapper {
    fn write_stdin(&self, data: &str) -> Result<(), String> {
        self.0.write_stdin(data)
    }

    fn is_running(&self) -> bool {
        self.0.is_running()
    }

    fn stop(&self) {
        self.0.stop()
    }

    fn kill(&self) {
        self.0.kill()
    }
}

// ============================================================================
// TESTS FOR TEST SUPPORT
// ============================================================================
//
// Yes, we test our test utilities. This ensures they work correctly before
// we use them in actual tests.

#[cfg(test)]
mod tests {
    use super::*;

    mod fixtures {
        use super::*;

        #[test]
        fn sample_chat_metadata_has_expected_fields() {
            let meta = sample_chat_metadata("test-123");

            assert_eq!(meta.id, "test-123");
            assert_eq!(meta.workspace_id, "test-workspace");
            assert_eq!(meta.label, "Test Chat");
            assert_eq!(meta.agent_type, Some("claude".to_string()));
        }

        #[test]
        fn sample_user_message_creates_valid_event() {
            let event = sample_user_message("Hello!");

            match event {
                AgentEvent::UserMessage { content, id, .. } => {
                    assert_eq!(content, "Hello!");
                    assert!(!id.is_empty()); // UUID should be generated
                }
                _ => panic!("Expected UserMessage"),
            }
        }

        #[test]
        fn sample_tool_approval_with_prefixes() {
            let event = sample_tool_approval("req-1", "Bash", Some(vec!["git", "status"]));

            match event {
                AgentEvent::ToolApproval {
                    request_id,
                    name,
                    prefixes,
                    auto_approved,
                    ..
                } => {
                    assert_eq!(request_id, "req-1");
                    assert_eq!(name, "Bash");
                    assert_eq!(
                        prefixes,
                        Some(vec!["git".to_string(), "status".to_string()])
                    );
                    assert!(!auto_approved);
                }
                _ => panic!("Expected ToolApproval"),
            }
        }
    }

    mod test_chat_dir {
        use super::*;

        #[test]
        fn creates_temp_directory() {
            let test_dir = TestChatDir::new();
            assert!(test_dir.path().exists());
        }

        #[test]
        fn creates_chat_directory_structure() {
            let test_dir = TestChatDir::new();
            let chat_dir = test_dir.create_chat_dir("my-project", "main");

            assert!(chat_dir.exists());
            assert!(chat_dir.ends_with("chats/my-project/main"));
        }

        #[test]
        fn directory_cleaned_up_on_drop() {
            let path = {
                let test_dir = TestChatDir::new();
                test_dir.path()
            };
            // After drop, directory should be gone
            assert!(!path.exists());
        }
    }

    mod mock_event_bus {
        use super::*;

        #[test]
        fn starts_empty() {
            let bus = MockEventBus::new();
            assert_eq!(bus.event_count(), 0);
        }

        #[test]
        fn collects_emitted_events() {
            let bus = MockEventBus::new();

            bus.emit("test:event:1", &"payload1");
            bus.emit("test:event:2", &"payload2");

            assert_eq!(bus.event_count(), 2);
            let events = bus.events();
            assert_eq!(events[0].event_type, "test:event:1");
            assert_eq!(events[1].event_type, "test:event:2");
        }

        #[test]
        fn clear_removes_events() {
            let bus = MockEventBus::new();
            bus.emit("test:event", &"payload");
            assert_eq!(bus.event_count(), 1);

            bus.clear();
            assert_eq!(bus.event_count(), 0);
        }

        #[test]
        fn events_of_type_filters_correctly() {
            let bus = MockEventBus::new();
            bus.emit("agent:event:123", &"a");
            bus.emit("agent:stdout:123", &"b");
            bus.emit("agent:event:123", &"c");

            let events = bus.events_of_type("agent:event:123");
            assert_eq!(events.len(), 2);
        }

        #[test]
        fn events_with_prefix_filters_correctly() {
            let bus = MockEventBus::new();
            bus.emit("agent:event:123", &"a");
            bus.emit("pty:data:456", &"b");
            bus.emit("agent:stdout:123", &"c");

            let agent_events = bus.events_with_prefix("agent:");
            assert_eq!(agent_events.len(), 2);
        }
    }

    mod mock_approval_manager {
        use super::*;

        #[test]
        fn approves_nothing_by_default() {
            let approvals = MockApprovalManager::new();
            assert!(!approvals.should_auto_approve("proj", "Bash", &["git".to_string()]));
        }

        #[test]
        fn approve_all_approves_everything() {
            let approvals = MockApprovalManager::approve_all();
            assert!(approvals.should_auto_approve("proj", "Bash", &["rm".to_string()]));
            assert!(approvals.should_auto_approve("proj", "Edit", &[]));
        }

        #[test]
        fn added_approval_is_respected() {
            let approvals = MockApprovalManager::new();
            approvals.add_approval("Bash", vec!["git".to_string()]);

            assert!(approvals.should_auto_approve("proj", "Bash", &["git".to_string()]));
            assert!(!approvals.should_auto_approve("proj", "Bash", &["rm".to_string()]));
        }

        #[test]
        fn empty_prefixes_approves_all_uses() {
            let approvals = MockApprovalManager::new();
            approvals.add_approval("Read", vec![]);

            assert!(approvals.should_auto_approve("proj", "Read", &[]));
            assert!(approvals.should_auto_approve("proj", "Read", &["anything".to_string()]));
        }
    }

    mod fake_agent_process {
        use super::*;

        #[test]
        fn sends_events_through_receiver() {
            let fake = FakeAgentProcess::new();
            let receiver = fake.take_receiver().unwrap();

            fake.send_stdout("Hello");
            fake.send_stderr("Warning");
            fake.send_exit(0);

            assert!(matches!(
                receiver.recv().unwrap(),
                ProcessEvent::Stdout(s) if s == "Hello"
            ));
            assert!(matches!(
                receiver.recv().unwrap(),
                ProcessEvent::Stderr(s) if s == "Warning"
            ));
            assert!(matches!(
                receiver.recv().unwrap(),
                ProcessEvent::Exit(e) if e.code == 0
            ));
        }

        #[test]
        fn collects_stdin_writes() {
            let fake = FakeAgentProcess::new();

            fake.write_stdin("input1").unwrap();
            fake.write_stdin("input2").unwrap();

            let writes = fake.stdin_writes();
            assert_eq!(writes, vec!["input1", "input2"]);
        }

        #[test]
        fn write_stdin_fails_when_not_running() {
            let fake = FakeAgentProcess::new();
            fake.stop();

            let result = fake.write_stdin("data");
            assert!(result.is_err());
        }

        #[test]
        fn take_receiver_returns_none_on_second_call() {
            let fake = FakeAgentProcess::new();
            assert!(fake.take_receiver().is_some());
            assert!(fake.take_receiver().is_none());
        }
    }

    mod mock_process_spawner {
        use super::*;

        #[test]
        fn returns_configured_processes() {
            let spawner = MockProcessSpawner::new();
            let fake = Arc::new(FakeAgentProcess::new());
            spawner.add_process(fake);

            let config = crate::spawn::SpawnConfig::new("/bin/echo", vec![]);
            let result = spawner.spawn(config);

            assert!(result.is_ok());
            assert_eq!(spawner.spawn_count(), 1);
        }

        #[test]
        fn returns_error_when_configured() {
            let spawner = MockProcessSpawner::new();
            spawner.set_error("spawn failed");

            let config = crate::spawn::SpawnConfig::new("/bin/echo", vec![]);
            let result = spawner.spawn(config);

            assert!(result.is_err());
            // Use match instead of unwrap_err since Ok type doesn't impl Debug
            match result {
                Err(e) => assert_eq!(e, "spawn failed"),
                Ok(_) => panic!("Expected error"),
            }
        }

        #[test]
        fn creates_default_process_when_none_configured() {
            let spawner = MockProcessSpawner::new();

            let config = crate::spawn::SpawnConfig::new("/bin/echo", vec![]);
            let result = spawner.spawn(config);

            assert!(result.is_ok());
        }
    }
}

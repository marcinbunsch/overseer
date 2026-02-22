# Test Coverage Attack Plan for `overseer-core`

**Created:** 2026-02-22
**Based on:** `overseer-core-test-coverage.md` + Claude & Codex addendums

---

## Key Decisions

1. **PTY Testing:** Do NOT spawn real PTYs. Create a trait wrapper around `portable-pty` for dependency injection. Mock in tests.
2. **Process Spawning:** Mock `AgentProcess::spawn`. Create trait/DI seam for process creation.
3. **Time-based Flush:** Skip testing time-based flush triggers. Focus on count-based triggers (`MAX_PENDING_EVENTS`). Time-based behavior is simple enough to trust.

---

## Phase 0: Test Infrastructure

Create testing seams and helpers before tackling the managers.

### File: `src/test_support.rs` (NEW)

**Purpose:** Shared test utilities, fixtures, and mock implementations

| Utility | Purpose |
|---------|---------|
| `TestChatDir` | Temp directory wrapper with auto-cleanup |
| `MockEventBus` | Collects emitted events for assertions |
| `MockApprovalManager` | Configurable approval responses |
| `FakeAgentProcess` | Controlled event emission without real processes |
| `sample_chat_metadata()` | Factory for test `ChatMetadata` |
| `sample_agent_events()` | Factory for various `AgentEvent` variants |

### File: `src/managers/pty.rs` - Add Trait

**Change:** Extract `PtyBackend` trait wrapping `portable-pty` operations

```rust
pub trait PtyBackend: Send + Sync {
    fn open_pty(&self, size: PtySize) -> Result<PtyPair, Error>;
    // ... other operations
}

pub struct NativePtyBackend; // Real implementation
pub struct MockPtyBackend;   // Test implementation
```

### File: `src/spawn.rs` - Add Trait

**Change:** Extract `ProcessSpawner` trait for dependency injection

```rust
pub trait ProcessSpawner: Send + Sync {
    fn spawn(&self, config: SpawnConfig) -> Result<Box<dyn AgentProcessHandle>, String>;
}

pub trait AgentProcessHandle: Send + Sync {
    fn write_stdin(&self, data: &str) -> Result<(), String>;
    fn take_receiver(&mut self) -> Option<Receiver<ProcessEvent>>;
    fn is_running(&self) -> bool;
    fn stop(&self);
    fn kill(&self);
}
```

---

## Phase 1: Critical Path

### File: `managers/chat_session.rs`

**LOC:** 303 | **Current Tests:** 0 | **Target Tests:** ~28

#### Path Validation (Security Critical)

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `validate_path_component_rejects_empty` | Empty string rejected |
| 2 | `validate_path_component_rejects_dot_dot` | `..` path traversal rejected |
| 3 | `validate_path_component_rejects_absolute_path` | `/foo` rejected |
| 4 | `validate_path_component_rejects_slash` | `foo/bar` rejected |
| 5 | `validate_path_component_accepts_normal_name` | `my-project` accepted |
| 6 | `validate_path_component_accepts_hyphen_underscore` | `my_project-1` accepted |

#### Session Lifecycle

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 7 | `register_session_creates_metadata_file` | Metadata persisted to disk |
| 8 | `register_session_with_mismatched_id_fails` | ID mismatch returns error |
| 9 | `register_session_twice_is_idempotent` | Double register doesn't error |
| 10 | `unregister_session_flushes_pending_events` | Pending events written on unregister |
| 11 | `unregister_nonexistent_session_returns_ok` | No error for unknown session |

#### Event Appending

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 12 | `append_event_to_registered_session` | Event added to pending buffer |
| 13 | `append_event_to_unregistered_session_fails` | Error for unknown session |
| 14 | `append_event_returns_sequential_seq_numbers` | Seq increments: 1, 2, 3... |
| 15 | `append_event_seq_starts_from_existing_count` | Resume after reload uses correct seq |
| 16 | `append_event_with_seq_returns_correct_seq` | Returns assigned seq number |

#### Flush Behavior

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 17 | `flush_triggers_at_max_pending_events` | Auto-flush at 10 events |
| 18 | `flush_empty_buffer_is_noop` | No file write if nothing pending |
| 19 | `flush_creates_file_on_first_write` | JSONL file created lazily |
| 20 | `flush_appends_to_existing_file` | Events appended, not overwritten |
| 21 | `flush_syncs_to_disk` | `sync_all()` called |

#### Loading Events

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 22 | `load_events_returns_persisted_events` | Round-trip: save then load |
| 23 | `load_events_with_seq_returns_seq_numbers` | SeqEvent contains correct seq |
| 24 | `load_events_since_seq_filters_correctly` | Only events after seq returned |
| 25 | `load_metadata_returns_saved_metadata` | Metadata round-trip works |

#### Edge Cases

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 26 | `add_user_message_generates_uuid_and_timestamp` | UUID and timestamp populated |
| 27 | `config_dir_not_set_returns_error` | Error if no config dir |
| 28 | `save_metadata_without_session_works` | Can save metadata directly |

---

### File: `managers/claude_agent.rs`

**LOC:** 465 | **Current Tests:** 0 | **Target Tests:** ~20

#### Auto-Approval Decision Logic (Security Critical)

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `check_auto_approval_with_matching_tool_approves` | Approved tool returns modified event |
| 2 | `check_auto_approval_with_no_match_passes_through` | Unapproved tool unchanged |
| 3 | `check_auto_approval_with_empty_prefixes` | Uses tool name when no prefixes |
| 4 | `check_auto_approval_sets_auto_approved_flag` | `auto_approved: true` set |
| 5 | `check_auto_approval_non_tool_approval_passes_through` | Non-ToolApproval events unchanged |
| 6 | `check_auto_approval_sends_response_to_stdin` | Approval written to process stdin |

#### Approval Response Building

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 7 | `build_approval_response_correct_json_structure` | Valid JSON with correct shape |
| 8 | `build_approval_response_includes_request_id` | Request ID in response |
| 9 | `build_approval_response_includes_input` | Input echoed in updatedInput |

#### Manager Operations

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 10 | `new_creates_empty_manager` | No processes initially |
| 11 | `is_running_returns_false_for_unknown_id` | Unknown ID = not running |
| 12 | `list_running_returns_empty_initially` | Empty list on fresh manager |
| 13 | `stop_nonexistent_process_is_noop` | No error stopping unknown |
| 14 | `write_stdin_to_nonexistent_process_fails` | Error for unknown process |

#### Send Message Logic

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 15 | `send_message_emits_user_message_event` | UserMessage event emitted |
| 16 | `send_message_calls_start_when_not_running` | New process spawned |
| 17 | `send_message_writes_stdin_when_running` | Existing process gets stdin |
| 18 | `send_message_formats_envelope_correctly` | JSON envelope structure correct |

#### Start/Stop

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 19 | `start_kills_existing_process_for_same_id` | Old process terminated |
| 20 | `start_registers_process_entry` | Entry added to map |

---

### File: `managers/pty.rs`

**LOC:** 194 | **Current Tests:** 0 | **Target Tests:** ~15

**Note:** All tests use `MockPtyBackend` - no real PTY spawning.

#### Manager Operations

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `new_creates_empty_manager` | No PTYs initially |
| 2 | `write_to_nonexistent_pty_fails` | Error for unknown PTY |
| 3 | `resize_nonexistent_pty_fails` | Error for unknown PTY |
| 4 | `kill_nonexistent_pty_is_noop` | No error killing unknown |

#### PTY Lifecycle (Mocked)

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 5 | `spawn_creates_pty_entry` | Entry added to map |
| 6 | `spawn_replaces_existing_pty_with_same_id` | Old PTY killed, new one stored |
| 7 | `spawn_emits_pty_data_events` | Data from mock reader emitted |
| 8 | `spawn_emits_pty_exit_on_close` | Exit event when reader closes |

#### Write/Resize Operations

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 9 | `write_succeeds_for_running_pty` | Write goes to mock writer |
| 10 | `resize_succeeds_for_running_pty` | Resize called on mock |

#### Kill Operations

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 11 | `kill_terminates_pty_process` | Kill called on mock child |
| 12 | `kill_removes_entry_from_map` | Entry gone after kill |

#### Configuration

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 13 | `pty_spawn_config_sets_cwd` | Working directory configured |
| 14 | `pty_spawn_config_sets_workspace_root_env` | Env var set when provided |
| 15 | `pty_spawn_config_uses_login_shell_flag` | `-l` flag for login shell |

---

## Phase 2: Important

### File: `managers/codex_agent.rs`

**LOC:** 349 | **Current Tests:** 0 | **Target Tests:** ~15

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `build_approval_response_with_numeric_id` | Numeric ID in JSON |
| 2 | `build_approval_response_with_string_id` | String ID in JSON |
| 3 | `check_auto_approval_codex_format` | Correct JSON-RPC response |
| 4 | `check_auto_approval_returns_modified_event` | `auto_approved: true` |
| 5 | `start_kills_existing_server` | Old process terminated |
| 6 | `write_stdin_to_unknown_server_fails` | Error for unknown server |
| 7 | `stop_nonexistent_server_is_noop` | No error |
| 8 | `pending_requests_unknown_method_auto_accepts` | Auto-accept unknown methods |
| 9 | `new_creates_empty_manager` | Empty initially |
| 10-15 | (lifecycle tests) | Similar to Claude manager |

---

### File: `managers/copilot_agent.rs`

**LOC:** 362 | **Current Tests:** 0 | **Target Tests:** ~15

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `build_approval_response_jsonrpc_format` | JSON-RPC 2.0 structure |
| 2 | `build_approval_response_outcome_structure` | `outcome.optionId` correct |
| 3 | `check_auto_approval_copilot_format` | Correct response sent |
| 4 | `pending_permission_request_auto_accepts` | `session/request_permission` accepted |
| 5 | `pending_unsupported_method_returns_error` | JSON-RPC error returned |
| 6-15 | (lifecycle tests) | Similar to Claude manager |

---

### File: `managers/gemini_agent.rs`

**LOC:** 223 | **Current Tests:** 0 | **Target Tests:** ~10

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `new_creates_empty_manager` | Empty initially |
| 2 | `write_stdin_is_noop` | Returns Ok, does nothing |
| 3 | `start_kills_existing_process` | Old process terminated |
| 4 | `stop_nonexistent_process_is_noop` | No error |
| 5-10 | (lifecycle tests) | Process spawn, event forwarding |

---

### File: `managers/opencode_agent.rs`

**LOC:** 476 | **Current Tests:** 0 | **Target Tests:** ~20

#### Port Allocation

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | `find_available_port_returns_start_port_if_free` | Uses requested port |
| 2 | `find_available_port_skips_occupied_ports` | Finds next available |
| 3 | `find_available_port_fails_after_100_attempts` | Error after exhaustion |

#### Password Generation

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 4 | `generate_password_is_32_chars` | Correct length |
| 5 | `generate_password_is_alphanumeric` | Valid characters |
| 6 | `generate_password_is_random` | Different each call |

#### Server Lifecycle

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 7 | `start_returns_port_and_password` | Info returned |
| 8 | `start_kills_existing_server` | Old server terminated |
| 9 | `get_port_returns_correct_port` | Port accessible |
| 10 | `get_password_returns_correct_password` | Password accessible |
| 11 | `get_port_unknown_server_fails` | Error for unknown |
| 12 | `stop_terminates_process` | Process killed |
| 13 | `stop_sets_sse_inactive` | SSE flag cleared |

#### SSE Subscriptions

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 14 | `subscribe_events_sets_sse_active` | Flag set to true |
| 15 | `unsubscribe_events_sets_sse_inactive` | Flag set to false |

#### Model Fetching

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 16 | `get_models_parses_provider_response` | Models extracted |
| 17 | `list_models_from_cli_parses_output` | CLI output parsed |
| 18 | `list_models_from_cli_handles_empty_output` | Empty = empty vec |
| 19 | `list_models_from_cli_handles_no_provider_prefix` | Models without `/` |
| 20 | `new_creates_empty_manager` | Empty initially |

---

### File: `spawn.rs`

**LOC:** 361 | **Current Tests:** 3 | **Target Tests:** ~13

| # | Test Name | What It Verifies |
|---|-----------|------------------|
| 1 | ✅ `spawn_config_builder` | (existing) |
| 2 | ✅ `process_event_debug` | (existing) |
| 3 | ✅ `spawn_echo_process` | (existing) |
| 4 | `spawn_process_captures_stdout` | Stdout events received |
| 5 | `spawn_process_captures_stderr` | Stderr events received |
| 6 | `spawn_process_sends_exit_event` | Exit event on completion |
| 7 | `write_stdin_succeeds` | Data written to process |
| 8 | `write_stdin_fails_after_process_exits` | Error after exit |
| 9 | `take_receiver_returns_receiver` | Receiver extracted |
| 10 | `take_receiver_second_call_empty` | Second call gives dummy |
| 11 | `is_running_after_spawn` | True while process alive |
| 12 | `is_running_false_after_kill` | False after kill |
| 13 | `stop_sends_sigint_then_kills` | Graceful then force |

---

## Phase 3: Polish

### Expand Parser Coverage

| File | Current | Target |
|------|---------|--------|
| `agents/claude/parser.rs` | 35% | 50% |
| `agents/codex/parser.rs` | 31% | 50% |

### Other Files

| File | Current | Notes |
|------|---------|-------|
| `approval/safe_commands.rs` | 5% | Validate `is_safe_command` logic |
| `git/branch.rs` | 1 test | Expand branch operations |
| `usage.rs` | 0% | macOS keychain - skip in CI, optional |

---

## Summary

| Phase | Files | Est. Tests | Priority |
|-------|-------|------------|----------|
| 0 | `test_support.rs`, trait additions | N/A (infra) | Do First |
| 1 | `chat_session.rs`, `claude_agent.rs`, `pty.rs` | ~63 | Critical |
| 2 | `codex_agent.rs`, `copilot_agent.rs`, `gemini_agent.rs`, `opencode_agent.rs`, `spawn.rs` | ~70 | Important |
| 3 | Parsers, safe_commands, git | ~20 | Polish |
| **Total** | | **~153** | |

---

## Execution Order

1. **Phase 0:** Create `test_support.rs`, add `PtyBackend` trait, add `ProcessSpawner` trait
2. **Phase 1a:** `chat_session.rs` tests (self-contained, no mocking needed)
3. **Phase 1b:** `claude_agent.rs` tests (uses mock process spawner)
4. **Phase 1c:** `pty.rs` tests (uses mock PTY backend)
5. **Phase 2:** Remaining managers (follow same patterns)
6. **Phase 3:** Polish and expand coverage

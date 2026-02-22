# Test Coverage Plan - Claude's Addendum

**Date:** 2026-02-22
**Re:** `docs/plans/overseer-core-test-coverage.md`

---

## Overall Assessment

The plan is solid and well-prioritized. The tiering makes sense, the risk identification is accurate, and the scope estimates are realistic. The core insight — "parsing is tested, coordination is not" — is correct and concerning.

---

## Strengths

1. **Clear tiering** — Critical/Important/Polish prevents scope creep
2. **Accurate risk identification** — Approval bypass, zombie processes, data loss are the real threats
3. **Realistic estimates** — ~250 test cases across phases shows actual planning, not handwaving
4. **Good coverage metrics** — The 82% on command_parser vs 0% on managers tells the whole story

---

## Concerns

### 1. OpenCode Should Be Tier 1

OpenCode is listed under Tier 1 files but appears in Phase 2. Port allocation failures and SSE subscription bugs can cause silent failures that are hard to diagnose. Recommend moving to Phase 1.

### 2. Test Infrastructure Not Addressed

The plan lists test cases but doesn't address prerequisites:

- **Temp directory fixtures** — `chat_session.rs` tests need isolated filesystem
- **Mock event streams** — Agent managers need fake stdout/stderr
- **Fake PTY** — `pty.rs` can't spawn real terminals in CI
- **Time mocking** — Flush timing tests need controlled clocks

Suggest adding a "Phase 0: Test Infrastructure" that sets up:
```rust
// crates/overseer-core/tests/fixtures/mod.rs
pub struct TestChatSession { /* temp dir, cleanup */ }
pub struct MockEventStream { /* controlled event emission */ }
pub struct FakePty { /* in-memory PTY simulation */ }
```

### 3. Concurrency Testing Strategy Unclear

The plan notes concurrent operations are untested but doesn't specify approach. Options:

- **Controlled mpsc channels** — Inject test channels, control timing
- **Loom** — Formal concurrency testing (heavy, probably overkill)
- **Stress tests with random delays** — Pragmatic chaos testing

Recommend: Start with controlled channels for deterministic tests, add stress tests later.

### 4. Scope vs Timeline

~250 test cases is substantial. Consider identifying a "critical subset" for initial pass:

| File | Critical Subset | Full Coverage |
|------|-----------------|---------------|
| chat_session.rs | ~20 cases (lifecycle + flush) | ~80 cases |
| claude_agent.rs | ~15 cases (approval flow only) | ~50 cases |
| pty.rs | ~10 cases (spawn + cleanup) | ~40 cases |

This gives ~45 high-value tests first, then expand.

---

## Revised Priority Order

Based on risk/impact analysis:

### Critical Path (Do First)

1. **chat_session.rs** — User data. Can't lose messages. Path validation prevents directory traversal.

2. **claude_agent.rs approval flow** — Security-sensitive. A bug here could auto-approve dangerous commands. Focus on:
   - `should_auto_approve()` decision logic
   - Approval context loading
   - Edge cases (malformed input, missing context)

3. **pty.rs lifecycle** — Resource leaks here are silent and cumulative. Focus on:
   - Spawn success/failure
   - Cleanup on process exit
   - Resize error handling

### Important (Do Second)

4. **opencode_agent.rs** — Port allocation and SSE subscriptions
5. **spawn.rs** — Foundation for all agent spawning
6. **codex/copilot/gemini managers** — Lower usage, similar patterns

### Polish (Do Last)

7. Expand parser coverage to 50%+
8. Usage.rs keychain mocking (macOS-specific, can skip in CI)

---

## Test Structure Recommendation

```
crates/overseer-core/
├── src/
│   └── [existing inline tests — keep for unit tests]
├── tests/
│   ├── common/
│   │   ├── mod.rs
│   │   ├── fixtures.rs          # Temp dirs, mock data
│   │   ├── mock_pty.rs          # Fake PTY for testing
│   │   └── mock_events.rs       # Controlled event streams
│   ├── chat_session_test.rs     # Integration tests
│   ├── agent_approval_test.rs   # Approval flow tests
│   ├── pty_lifecycle_test.rs    # PTY spawn/cleanup
│   └── port_allocation_test.rs  # OpenCode port handling
└── Cargo.toml
    # Add: tempfile, tokio-test, mockall (optional)
```

---

## Questions to Resolve Before Starting

1. **CI environment** — Can we spawn real PTYs in CI, or do we need full mocking?
2. **macOS-specific code** — Skip in CI or use conditional compilation?
3. **Agent binaries** — Do integration tests need real Claude/Codex installed, or mock everything?

---

## Summary

The plan is good. Main additions needed:

- [ ] Phase 0: Test infrastructure (fixtures, mocks)
- [ ] Move OpenCode to Phase 1
- [ ] Define "critical subset" for faster initial coverage
- [ ] Clarify concurrency testing approach
- [ ] Resolve CI environment questions

Estimated effort for critical path (~45 tests): Medium
Estimated effort for full Phase 1 (~220 tests): Large

# overseer-core Test Coverage Plan Addendum (Codex)

**Generated:** 2026-02-22
**Based on:** `docs/plans/overseer-core-test-coverage.md`

## Summary

The plan’s prioritization is correct: the manager layer is the highest risk and has zero tests. The biggest missing piece is **testability strategy**. Manager tests will require explicit seams for process spawning, PTY, clock/time, and I/O. Without those seams, the plan will stall or produce flaky tests.

## Addendum Notes

### 1) Add a Testability Phase (Before Phase 1)

Focus on creating seams and helpers so the manager tests are deterministic and fast.

- Add small interfaces/traits for:
  - Process spawning and lifecycle control
  - PTY operations (spawn, resize, read/write)
  - Time/clock access (flush timing, backoff, retry)
  - File I/O/persistence for session writes
- Provide test fakes for each seam in a `test_support` module.

### 2) Make Concurrency Tests Deterministic

Manager tests that validate flush timing, event loops, or backoff need a controllable clock.

- If using `tokio::time`, prefer `tokio::time::pause` + `advance` in tests.
- If using `std::thread::sleep`, consider refactoring to a `Clock` trait or switch to `tokio::time` in testable pathways.

### 3) Scale the Initial Test Targets

The plan’s “~80” and “~100+” cases are likely too ambitious without test helpers. Start with a smaller high‑impact suite per file:

- 10–20 tests per manager covering lifecycle, error cases, and critical race conditions.
- Expand once harness utilities are in place.

### 4) Mix Integration and Unit Tests

A new `tests/` integration suite is good, but manager logic can and should be unit‑tested when seams exist.

- Use integration tests for end‑to‑end flows and concurrency.
- Use unit tests for parsing, validation, and decision logic inside managers.

### 5) Confirm Workspace Layout Before Restructuring

The plan assumes `crates/overseer-core`. Verify this is the correct crate path before adding `tests/` or dev‑dependencies.

### 6) Plan for OS‑Dependent Code (Keychain/PTY)

Tests that touch OS features should be isolated behind traits and mocked.

- Avoid keychain access in tests.
- Provide mock PTY implementations that simulate resize and I/O.

## Suggested Minimal “Testability First” Checklist

1. Introduce `ProcessSpawner` and `PtyBackend` traits.
2. Introduce `Clock` trait or use `tokio::time` throughout manager flush logic.
3. Add `test_support` module with fakes.
4. Write 1–2 proving tests for `chat_session` manager using fakes.

## Opinion (Short)

The plan is strong on prioritization but weak on *how to make tests possible*. Add a testability phase and a deterministic time strategy, and the rest of the plan becomes actionable.

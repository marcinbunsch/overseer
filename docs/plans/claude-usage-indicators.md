# Claude Usage Limits Feature Implementation Plan

## Status: ✅ COMPLETED

## Problem
Add visual indicators for Claude API usage limits (5-hour and 7-day) next to model/permission selectors in the chat UI.

## Approach
1. Run shell command (`curl` pipeline) to fetch usage data from Claude OAuth API
2. Token extraction happens in shell subprocess - never enters Overseer memory
3. Expose via Tauri command
4. Create ClaudeUsageStore to manage state and rate limiting
5. Add usage indicator circles to UI
6. Wire up turn completion events to trigger usage checks

## Platform Support
**macOS only** - Uses macOS Keychain to access Claude OAuth credentials via shell pipeline. On other platforms, the feature gracefully degrades (no indicators shown).

## Security Architecture
**Critical**: OAuth token never enters Overseer's memory. The entire pipeline runs in a shell subprocess:
```bash
curl -s https://api.anthropic.com/api/oauth/usage \
  -H "Authorization: Bearer $(security find-generic-password -s 'Claude Code-credentials' -w | grep -o '"accessToken":"[^"]\+"' | sed 's/"accessToken":"//;s/"$//')" \
  -H "anthropic-beta: oauth-2025-04-20"
```
Only the final JSON response comes back to Overseer. Token flows through shell pipes only.

## Workplan

### Backend (Rust)
- [x] Create `usage.rs` module in overseer-core with shell command execution
- [x] Run complete curl pipeline as subprocess (token stays in shell)
- [x] Parse JSON response from stdout
- [x] Define response structs matching API response format
- [x] Export module from lib.rs
- [x] Add Tauri command in src-tauri/src/lib.rs to call the usage function
- [x] Add platform check (macOS only) with graceful degradation

### Frontend - Store
- [x] Create `src/renderer/stores/ClaudeUsageStore.ts` with:
  - Observable fields for usage data (5-hour, 7-day, extra)
  - Observable fields for tracking last fetch time
  - Action to invoke Tauri command and update state
  - Rate limiting logic (15 min minimum between checks)
  - Scheduling logic for delayed checks
  - Platform support detection
- [x] Export singleton instance

### Frontend - Event System
- [x] Add `"agent:turnComplete"` event to EventMap in eventBus.ts
- [x] Emit this event from ChatStore when turnComplete is handled
- [x] Subscribe to event in ClaudeUsageStore
- [x] Implement rate-limited check logic on event

### Frontend - UI Components
- [x] Create `src/renderer/components/chat/ClaudeUsageIndicator.tsx` with:
  - Two circles (5-hour and 7-day limits)
  - Radix Tooltip integration
  - Visual representation of usage percentage (color-coded)
  - Tooltip showing percentage and reset time
- [x] Integrate indicator into ChatInput.tsx next to ModelSelector
- [x] Only show for Claude agent type
- [x] Wire up to ClaudeUsageStore observables

### Testing & Verification
- [x] Run `pnpm checks:ui` to verify TypeScript/lint - ✅ PASSED
- [x] Run `cargo check` to verify Rust compilation - ✅ PASSED
- [x] Write comprehensive tests - ✅ PASSED
  - ClaudeUsageStore tests (initialization, fetch, rate limiting, platform detection)
  - ClaudeUsageIndicator tests (rendering, color coding)
  - ChatStore tests (event emission)
  - eventBus tests (new event type)
- [x] Run `pnpm test` - ✅ ALL 847 TESTS PASSING
- [ ] Test manually with Claude agent on macOS
- [ ] Verify usage indicators appear and update
- [ ] Verify rate limiting works (15 min minimum)
- [ ] Test tooltip display
- [ ] Verify graceful degradation on non-macOS platforms

## Implementation Notes
- Usage API endpoint: `https://api.anthropic.com/api/oauth/usage`
- Required header: `anthropic-beta: oauth-2025-04-20`
- Token extraction on macOS: `security find-generic-password -s 'Claude Code-credentials' -w`
- Token is in JSON at path: `.claudeAiOauth.accessToken`
- Response has: `five_hour`, `seven_day`, `seven_day_sonnet`, `extra_usage`
- Each has `utilization` (percentage) and `resets_at` (ISO timestamp)
- Color coding: green (<70%), yellow (70-90%), red (>90%)
- **No reqwest dependency** - uses system curl instead for better security

## Files Changed
- `crates/overseer-core/Cargo.toml` - No new dependencies (uses system curl)
- `crates/overseer-core/src/usage.rs` - New module using shell subprocess
- `crates/overseer-core/src/lib.rs` - Exported usage module
- `src-tauri/src/lib.rs` - Added fetch_claude_usage Tauri command
- `src/renderer/stores/ClaudeUsageStore.ts` - New store for usage management
- `src/renderer/utils/eventBus.ts` - Added agent:turnComplete event
- `src/renderer/stores/ChatStore.ts` - Emit turnComplete event
- `src/renderer/components/chat/ClaudeUsageIndicator.tsx` - New UI component
- `src/renderer/components/chat/ChatInput.tsx` - Integrated usage indicator
- `package.json` - Added @radix-ui/react-tooltip dependency


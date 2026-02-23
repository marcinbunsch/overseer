# Frontend Test Coverage Report

**Generated:** 2026-02-21
**Overall Coverage:** 37% of source files have corresponding tests

## Summary

| Category | Tested | Total | Coverage |
|----------|--------|-------|----------|
| Stores | 13 | 20 | 65% |
| Services | 8 | 13 | 62% |
| Utils | 9 | 11 | 82% ✓ |
| **Components** | 19 | 67 | **28%** |
| **Hooks** | 0 | 4 | **0%** |
| Backend | 2 | 4 | 50% |
| **TOTAL** | 47 | 127 | **37%** |

---

## 🔴 Tier 1 - Critical (Core Application Logic)

These files are critical to application stability and have no tests:

| File | LOC | Why Critical |
|------|-----|--------------|
| `services/git.ts` | 87 | All git operations (diff, merge, branch) untested |
| `App.tsx` | 259 | Application root, initialization, routing |
| `chat/ChatWindow.tsx` | 307 | Main chat container, state management |
| `chat/ChatInput.tsx` | ~150 | User input, @ file search, send logic |
| `chat/MessageItem.tsx` | 208 | Message rendering, tool call parsing |
| `stores/ConsoleStore.ts` | 124 | Console output management |
| `stores/UpdateStore.ts` | 130 | Auto-update logic |
| `projects/ProjectSettingsDialog.tsx` | 304 | Project configuration UI |

---

## 🟠 Tier 2 - High Priority (Core Features)

| File | LOC | Issue |
|------|-----|-------|
| `services/opencode.ts` | 537 | Only 0.22x test coverage ratio (116 LOC tests) |
| `hooks/useKeyboardShortcuts.ts` | 96 | All keyboard interactions untested |
| `chat/AtSearch.tsx` | ~80 | File fuzzy search/autocomplete untested |
| `chat/PlanDiffView.tsx` | 259 | Plan review diff display untested |
| `changes/DiffCommentBox.tsx` | 173 | Code review comments untested |
| `stores/UIStore.ts` | 72 | UI state management untested |

---

## 🟡 Tier 3 - Medium Priority (Important Features)

### Stores (Missing Tests)
- `ConfirmDialogStore.ts` (55 LOC)
- `TerminalStore.ts` (35 LOC)
- `ToastStore.ts` (26 LOC)
- `WebAuthStore.ts` (22 LOC)

### Services (Missing Tests)
- `overseerActions.ts` (54 LOC)
- `agentRegistry.ts` (19 LOC)
- `external.ts` (20 LOC)

### Components - Chat Tools (12 components, 449 LOC combined, 0% tested)
- `BashToolItem.tsx`
- `EditToolItem.tsx`
- `TaskToolItem.tsx`
- `TodoWriteToolItem.tsx`
- `WebFetchToolItem.tsx`
- `WriteToolItem.tsx`
- `EnterPlanModeToolItem.tsx`
- `GenericToolItem.tsx`
- `GlobToolItem.tsx`
- `GrepToolItem.tsx`
- `ReadToolItem.tsx`
- `WebSearchToolItem.tsx`

### Components - Chat (Missing Tests)
- `AgentQuestionPanel.tsx`
- `ChatHistoryDialog.tsx`
- `MarkdownContent.tsx` (108 LOC)
- `ModelSelector.tsx` (105 LOC)
- `PlanApprovalPanel.tsx` (114 LOC)
- `QueuedMessagesPanel.tsx` (39 LOC)
- `ToolApprovalPanel.tsx` (143 LOC)
- `TurnSection.tsx` (123 LOC)
- `WebSocketConnectionIndicator.tsx` (87 LOC)

### Components - Layout (346 LOC combined)
- `RightPane.tsx` (126 LOC)
- `MobileConsole.tsx` (106 LOC)
- `LeftPane.tsx` (33 LOC)
- `MiddlePane.tsx` (32 LOC)
- `MobileHeader.tsx` (49 LOC)

### Components - Projects
- `WorkspaceList.tsx` (171 LOC)
- `ProjectItem.tsx` (108 LOC)
- `AddProjectButton.tsx` (27 LOC)
- `ProjectList.tsx` (25 LOC)

### Components - Shared
- `AuthTokenDialog.tsx` (94 LOC)
- `ClaudePermissionModeSelect.tsx` (45 LOC)
- `ConfirmDialog.tsx` (48 LOC)
- `GlobalConfirmDialog.tsx` (48 LOC)
- `UpdateNotification.tsx` (55 LOC)

### Hooks (All untested)
- `useClickOutside.ts` (21 LOC)
- `useDebuncedCallback.ts` (32 LOC)
- `useEdgeSwipe.ts` (78 LOC)
- `useKeyboardShortcuts.ts` (96 LOC)

---

## 🟢 Tier 4 - Lower Priority (Simple/Small Files)

- `stores/ToastStore.ts` (26 LOC) - Simple notification store
- `stores/WebAuthStore.ts` (22 LOC) - Simple auth state
- `utils/agentDisplayName.ts` (21 LOC) - Simple utility
- `utils/paths.ts` (16 LOC) - Simple utility
- `shared/BetaBadge.tsx` (13 LOC)
- `shared/Toasts.tsx` (23 LOC)
- `terminal/TerminalPane.tsx` (72 LOC)
- `changes/PierreDiffView.tsx` (149 LOC)

---

## Files With Insufficient Coverage Ratio

These files have tests but the test-to-source ratio suggests incomplete coverage:

| Source File | Source LOC | Test LOC | Ratio | Assessment |
|-------------|------------|----------|-------|------------|
| `services/opencode.ts` | 537 | 116 | 0.22x | **Needs work** |
| `services/copilot.ts` | 461 | 377 | 0.82x | Borderline |

---

## Recommended Testing Order

### Phase 1 - Critical Path
1. `services/git.ts` - Core git operations
2. `stores/ConsoleStore.ts` - Console output
3. `App.tsx` - Application initialization
4. `chat/ChatWindow.tsx` - Main chat container
5. Expand `services/opencode.ts` tests

### Phase 2 - Core Features
1. `chat/ChatInput.tsx` + `chat/AtSearch.tsx` - Input handling
2. `chat/MessageItem.tsx` - Message rendering
3. `stores/UpdateStore.ts` - Auto-update
4. `hooks/useKeyboardShortcuts.ts` - Keyboard handling
5. `projects/ProjectSettingsDialog.tsx` - Project config

### Phase 3 - Feature Completeness
1. Tool item components (batch)
2. `chat/PlanDiffView.tsx`
3. `changes/DiffCommentBox.tsx`
4. Terminal integration
5. Workspace/Project components

### Phase 4 - Polish
1. Auth dialogs
2. Simple utilities
3. Layout components
4. Remaining UI components

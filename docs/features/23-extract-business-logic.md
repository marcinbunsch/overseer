# Extract Business Logic from Components

**Goal:** All business logic should live in MobX stores or utility functions. Components should be "dumb" -- they read properties, computed properties, and call actions. Nothing more.

**Principle:** If a component is doing something other than (a) reading observable/computed state, (b) calling a store action, or (c) managing purely-UI-local state like `expanded` toggles, it has business logic that should be extracted.

---

## 1. Create a `ChangedFilesStore`

**Current state:** `ChangedFilesPane.tsx` (~290 lines) is the most logic-heavy component. It owns:

- `files`, `isDefaultBranch`, `loading`, `error` state for git changed-file listing
- `checking`, `merging` state for merge operations
- `showMergeConfirm`, `showMergeDialog` dialog state
- `refresh()` callback that calls `gitService.listChangedFiles`
- `handleCheckMerge()` with conflict-handling logic that sends messages to Claude via `sessionStore.sendMessage`
- `handleMerge()` with conflict-handling, toast, and auto-refresh
- Two `useEffect` hooks subscribing to Tauri events (`claude:close:{chatId}`) and `runningCount` changes to auto-refresh
- Direct calls to `listen()` from `@tauri-apps/api/event`

**Target:** Create `src/renderer/stores/ChangedFilesStore.ts` that owns all of this. The component becomes:

```tsx
export const ChangedFilesPane = observer(function ChangedFilesPane({ workspacePath, workspaceId }) {
  const store = useMemo(
    () => new ChangedFilesStore(workspacePath, workspaceId),
    [workspacePath, workspaceId]
  )

  useEffect(() => {
    store.activate()
    return () => store.dispose()
  }, [store])

  // Render reads store.files, store.loading, store.error, etc.
  // Buttons call store.refresh(), store.checkMerge(), store.merge()
})
```

**Store shape:**

```ts
class ChangedFilesStore {
  files: ChangedFile[] = []
  isDefaultBranch = false
  loading = false
  error: string | null = null
  checking = false
  merging = false
  showMergeConfirm = false
  showMergeDialog = false
  diffFile: ChangedFile | null = null

  async refresh(): Promise<void>
  async checkMerge(): Promise<void>
  async merge(): Promise<void>

  // Subscribes to claude:close and runningCount changes
  activate(): void
  dispose(): void
}
```

**Files to change:**

- Create `src/renderer/stores/ChangedFilesStore.ts`
- Simplify `src/renderer/components/changes/ChangedFilesPane.tsx`

---

## 2. Create a `DiffViewStore`

**Current state:** `DiffDialog.tsx` manages:

- `selectedFile` state
- `DiffState` discriminated union (`loading | error | done`)
- A `useRef`-based cache (`cacheRef`) for fetched diffs
- `fetchedRef` to track which file was loaded on open
- `fetchDiff()` callback with caching logic
- `handleOpenChange()` that clears cache on close
- `useEffect` for keyboard navigation (ArrowLeft/ArrowRight to switch files)

**Target:** Create `src/renderer/stores/DiffViewStore.ts`:

```ts
class DiffViewStore {
  selectedFile: ChangedFile
  status: "loading" | "error" | "done" = "loading"
  errorMessage: string | null = null
  diff: string = ""

  private cache = new Map<string, string>()

  selectFile(file: ChangedFile): void
  fetchDiff(file: ChangedFile): Promise<void>
  reset(): void

  get diffLines(): DiffLine[]
  get fileName(): string
}
```

The keyboard navigation `useEffect` stays in the component (it's UI behavior), but it calls `store.selectFile()` instead of managing state directly.

**Files to change:**

- Create `src/renderer/stores/DiffViewStore.ts`
- Simplify `src/renderer/components/changes/DiffDialog.tsx`

---

## 3. Extract shared constants

**Current state:** `STATUS_STYLES` is duplicated identically in:

- `ChangedFilesPane.tsx:18-24`
- `DiffDialog.tsx:18-24`

The `StatusBadge` helper in `DiffDialog.tsx:216-232` has a similar but slightly different mapping (uses long labels like "Modified" instead of "M").

`AGENT_TITLES` in `ChatTabs.tsx:7-10` is a constant that maps agent types to display names.

**Target:** Create `src/renderer/constants/git.ts`:

```ts
export const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: "M", color: "text-ovr-text-primary" },
  A: { label: "A", color: "text-ovr-diff-add" },
  D: { label: "D", color: "text-ovr-diff-del" },
  R: { label: "R", color: "text-ovr-azure-400" },
  "?": { label: "?", color: "text-ovr-text-dim" },
}

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-ovr-text-primary" },
  A: { label: "Added", color: "text-ovr-diff-add" },
  D: { label: "Deleted", color: "text-ovr-diff-del" },
  R: { label: "Renamed", color: "text-ovr-azure-400" },
  "?": { label: "Untracked", color: "text-ovr-text-dim" },
}
```

Create `src/renderer/constants/agents.ts`:

```ts
export const AGENT_TITLES: Record<AgentType, string> = {
  claude: "Claude",
  codex: "Codex",
}
```

**Files to change:**

- Create `src/renderer/constants/git.ts`
- Create `src/renderer/constants/agents.ts`
- Update `ChangedFilesPane.tsx` -- import from constants
- Update `DiffDialog.tsx` -- import from constants
- Update `ChatTabs.tsx` -- import from constants

---

## 4. Extract utility functions

### 4a. `countLines`

**Current state:** Duplicated between `EditToolItem.tsx` (standalone function, lines 5-8) and `WriteToolItem.tsx` (inline expression, line 10).

**Target:** Create `src/renderer/utils/text.ts`:

```ts
export function countLines(s: string): number {
  if (!s) return 0
  return s.split("\n").length
}
```

**Files to change:**

- Create `src/renderer/utils/text.ts`
- Update `EditToolItem.tsx` -- import and use
- Update `WriteToolItem.tsx` -- import and use

### 4b. `isDefaultBranch`

**Current state:** `ChatWindow.tsx:81` has inline check `workspace.branch === "main" || workspace.branch === "master"`.

**Target:** Add to `src/renderer/utils/git.ts`:

```ts
export function isDefaultBranch(branch: string): boolean {
  return branch === "main" || branch === "master"
}
```

**Files to change:**

- Create `src/renderer/utils/git.ts`
- Update `ChatWindow.tsx` -- import and use

### 4c. `summarizeTurnWork`

**Current state:** `TurnSection.tsx:15-35` builds a summary string by iterating over `turn.workMessages`, classifying each as a tool call (starts with `[`) or text message, then formatting counts.

**Target:** Add to `src/renderer/utils/chat.ts`:

```ts
export function summarizeTurnWork(workMessages: Message[]): string {
  let toolCalls = 0
  let textMessages = 0
  for (const msg of workMessages) {
    if (msg.content.startsWith("[")) {
      toolCalls++
    } else {
      textMessages++
    }
  }
  const parts: string[] = []
  if (toolCalls > 0) parts.push(`${toolCalls} tool call${toolCalls !== 1 ? "s" : ""}`)
  if (textMessages > 0) parts.push(`${textMessages} message${textMessages !== 1 ? "s" : ""}`)
  return parts.join(", ")
}
```

**Files to change:**

- Create `src/renderer/utils/chat.ts`
- Update `TurnSection.tsx` -- import and use

### 4d. `collectAnswers` and `areAllQuestionsAnswered`

**Current state:** `AgentQuestionPanel.tsx` has two pieces of business logic in the `QuestionSet` component:

- `allAnswered` (line 35-39): validation that checks if all questions have been answered
- `handleSubmit` (lines 41-48): collects answers into a `Record<string, string>`

**Target:** Add to `src/renderer/utils/questions.ts`:

```ts
export function areAllQuestionsAnswered(
  questions: AgentQuestion["questions"],
  selections: Record<string, string>,
  otherActive: Record<string, boolean>,
  otherTexts: Record<string, string>
): boolean { ... }

export function collectAnswers(
  questions: AgentQuestion["questions"],
  selections: Record<string, string>,
  otherActive: Record<string, boolean>,
  otherTexts: Record<string, string>
): Record<string, string> { ... }
```

**Files to change:**

- Create `src/renderer/utils/questions.ts`
- Update `AgentQuestionPanel.tsx` -- import and use

---

## 5. Extract `useClickOutside` hook

**Current state:** `ChatTabs.tsx:20-29` has a `useEffect` that listens for mousedown events outside a ref to close a menu.

**Target:** Create `src/renderer/hooks/useClickOutside.ts`:

```ts
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void
): void { ... }
```

**Files to change:**

- Create `src/renderer/hooks/useClickOutside.ts`
- Update `ChatTabs.tsx` -- import and use

---

## 6. Move branch rename logic to `RepoStore`

**Current state:** `ChatWindow.tsx:36-49` has `commitRename` with validation logic (trim, check if changed, try/catch with rollback).

**Target:** Add to `RepoStore`:

```ts
async renameBranchSafe(workspaceId: string, newName: string): Promise<boolean> {
  const trimmed = newName.trim()
  if (!trimmed || trimmed === currentBranch) return false
  try {
    await this.renameBranch(workspaceId, trimmed)
    return true
  } catch (err) {
    console.error("Failed to rename branch:", err)
    return false
  }
}
```

The component then simplifies to:

```tsx
const commitRename = useCallback(async () => {
  const success = await repoStore.renameBranchSafe(workspace.id, editValue)
  if (!success) setEditValue(workspace.branch)
  setEditing(false)
}, [editValue, workspace.id, workspace.branch])
```

**Files to change:**

- Update `src/renderer/stores/RepoStore.ts`
- Update `ChatWindow.tsx`

---

## 7. Fix `MessageList` state-during-render pattern

**Current state:** `MessageList.tsx:17-23` sets state during render (comparing current `chatId` to a ref to reset `visibleCount`). This is a React anti-pattern.

**Target:** Use a `key` prop on the component instead. In `ChatWindow.tsx`, render:

```tsx
<MessageList key={sessionStore.activeChatId} turns={sessionStore.currentTurns} />
```

This causes React to unmount/remount when `chatId` changes, naturally resetting `visibleCount` to the initial value. The `prevChatId` ref and conditional state set can be deleted entirely.

**Files to change:**

- Update `ChatWindow.tsx` -- add `key` prop to `MessageList`
- Simplify `MessageList.tsx` -- remove the chatId ref comparison

---

## Summary

| #   | Task                         | New files                                 | Modified files                                           |
| --- | ---------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| 1   | ChangedFilesStore            | `stores/ChangedFilesStore.ts`             | `ChangedFilesPane.tsx`                                   |
| 2   | DiffViewStore                | `stores/DiffViewStore.ts`                 | `DiffDialog.tsx`                                         |
| 3   | Shared constants             | `constants/git.ts`, `constants/agents.ts` | `ChangedFilesPane.tsx`, `DiffDialog.tsx`, `ChatTabs.tsx` |
| 4a  | `countLines` utility         | `utils/text.ts`                           | `EditToolItem.tsx`, `WriteToolItem.tsx`                  |
| 4b  | `isDefaultBranch` utility    | `utils/git.ts`                            | `ChatWindow.tsx`                                         |
| 4c  | `summarizeTurnWork` utility  | `utils/chat.ts`                           | `TurnSection.tsx`                                        |
| 4d  | Question answer utilities    | `utils/questions.ts`                      | `AgentQuestionPanel.tsx`                                 |
| 5   | `useClickOutside` hook       | `hooks/useClickOutside.ts`                | `ChatTabs.tsx`                                           |
| 6   | Branch rename to RepoStore   | --                                        | `RepoStore.ts`, `ChatWindow.tsx`                         |
| 7   | Fix MessageList render-state | --                                        | `MessageList.tsx`, `ChatWindow.tsx`                      |

# Plan: Thinking Mode Toggle

## Context

Claude CLI supports extended thinking via the `--thinking` budget flag (e.g. `--thinking 10000`). This makes Claude reason through problems more carefully before responding, visible as a "thinking" block in the stream output. The user wants a toggle to enable/disable this.

## Current State

- `start_claude` in `lib.rs` builds args for the CLI process
- No `--thinking` flag is passed
- `ChatInput.tsx` has a simple textarea + send button
- Claude's stream-json output includes `thinking` type events when thinking is enabled

## Design

Add a toggle near the chat input (or in the header alongside Plan/Build mode) that enables thinking. When on, pass `--thinking {budget}` to the CLI. Display thinking content in the chat as a collapsible block.

## Files to Modify

### 1. `src/renderer/stores/SessionStore.ts`
- Add `thinkingEnabled: boolean = false` observable
- Add `toggleThinking()` action
- Pass `thinkingEnabled` through to Claude service when sending messages

### 2. `src-tauri/src/lib.rs`
- Add `thinking_budget: Option<u32>` parameter to `start_claude`
- When `Some(budget)`, append `--thinking {budget}` to args
- Default budget could be `10000` tokens (configurable later)

### 3. `src/renderer/services/claude.ts`
- `sendMessage()` accepts `thinkingBudget: number | null` parameter
- Pass through to `start_claude` invoke call

### 4. `src/renderer/components/chat/ChatInput.tsx`
- Add a thinking toggle button next to the send button
- Icon: brain or lightbulb, toggles between on/off states
- When enabled, show subtle indicator (e.g. accent-colored icon)
- Tooltip: "Extended thinking" or similar

### 5. `src/renderer/types/index.ts`
- Add `thinking?: string` field to `Message` type for storing thinking content

### 6. `src/renderer/stores/SessionStore.ts` (event handling)
- Handle `thinking` type events from Claude's stream output
- In `handleClaudeEvent()`:
  - Detect `content_block_start` with `type: "thinking"`
  - Accumulate `content_block_delta` text for thinking blocks
  - Store thinking text on the assistant message

### 7. `src/renderer/components/chat/MessageItem.tsx`
- If a message has `thinking` content, render a collapsible section above the main content
- Collapsed by default, shows "Thinking..." label with expand chevron
- Expanded shows the thinking text in a muted/dimmed style
- Distinct visual treatment: lighter background, italic, or bordered

## UI Sketch

### Input area with toggle:
```
├────────────────────────────────────────────────┤
│  [input area]                    [🧠] [Send]   │
└────────────────────────────────────────────────┘
```

### Thinking block in message (collapsed):
```
│  ▶ Thinking...                                 │
│                                                │
│  Here's my analysis of the code...             │
```

### Thinking block in message (expanded):
```
│  ▼ Thinking                                    │
│  ┊ Let me consider the architecture here.      │
│  ┊ The current approach uses a singleton...    │
│  ┊ A better pattern would be...                │
│                                                │
│  Here's my analysis of the code...             │
```

## Edge Cases

- Thinking adds to token cost: consider showing a warning or cost indicator
- Thinking budget: start with a fixed 10000, could later make it configurable in settings
- Follow-up messages: thinking flag only applies when starting a new process, not for stdin follow-ups (the process retains its config)
- Stream events: thinking blocks come as `content_block_start` with `type: "thinking"` followed by deltas, then `content_block_stop` — same pattern as text blocks but different type
- Long thinking: can be very long, keep collapsed by default

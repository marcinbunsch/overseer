# Claude Agent Protocol Improvements (Planned)

Remaining improvements to Overseer's stream-json protocol handling for the Claude CLI.

For implemented protocol improvements, see [docs/features/10-claude-agent-protocol.md](../features/10-claude-agent-protocol.md).

---

## 1. Surface Result Metadata (Cost, Usage, Duration)

**Priority: High**
**Status: Data available but discarded**

### Problem

The `result` event from Claude contains `total_cost_usd`, `usage` (input/output tokens), `num_turns`, `duration_ms`, `duration_api_ms`, and `is_error`. Currently `translateEvent` only checks `event.type === "result"` and emits `turnComplete` with none of this data.

### Implementation

**A. Extend the `turnComplete` event (`types.ts`)**

```typescript
| {
    kind: "turnComplete"
    costUsd?: number
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    isError?: boolean
  }
```

**B. Parse result fields in ClaudeService (`claude.ts`)**

Update the result handler:

```typescript
if (event.type === "result") {
  this.emitEvent(chatId, {
    kind: "turnComplete",
    costUsd: event.total_cost_usd,
    durationMs: event.duration_ms,
    inputTokens: event.usage?.input_tokens,
    outputTokens: event.usage?.output_tokens,
    isError: event.is_error,
  })
  return
}
```

Also extend the `ClaudeStreamEvent` interface to type these fields:

```typescript
total_cost_usd?: number
duration_ms?: number
duration_api_ms?: number
is_error?: boolean
num_turns?: number
usage?: { input_tokens?: number; output_tokens?: number }
```

**C. Store turn metadata in ChatStore**

Add an observable for the last turn's result:

```typescript
@observable lastTurnResult: {
  costUsd?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
} | null = null
```

Populate it in the `turnComplete` handler.

**D. Display in UI**

Add a small footer line below the last assistant message showing cost and token counts (e.g., `$0.02 · 1.2k in / 3.4k out · 12s`). This could go in `TurnSection.tsx` or as a new `TurnMetadata` component.

### Files to change

| File | Change |
|------|--------|
| `src/renderer/services/claude.ts` | Parse result fields, extend `ClaudeStreamEvent` |
| `src/renderer/services/types.ts` | Extend `turnComplete` event type |
| `src/renderer/stores/ChatStore.ts` | Store `lastTurnResult` |
| `src/renderer/components/chat/TurnSection.tsx` (or new component) | Display metadata |

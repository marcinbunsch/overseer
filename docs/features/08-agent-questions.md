# Plan: Handle Questions from the Agent

## Context

When Claude uses the `AskUserQuestion` tool, it pauses and waits for the user to answer before continuing. This is different from tool approval (`control_request`) — it's a regular `tool_use` event with structured question data (multiple choice options, multi-select, descriptions). The answer must be sent back as a `tool_result` via stdin.

Currently Overseer has no handling for this — the `AskUserQuestion` tool_use appears as raw JSON in the assistant message and Claude hangs waiting for a response.

## Stream-JSON Protocol

### Incoming event (Claude asks a question)

The `AskUserQuestion` tool_use arrives as part of an `assistant` event:

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_abc123",
        "name": "AskUserQuestion",
        "input": {
          "questions": [
            {
              "question": "Which auth method should we use?",
              "header": "Auth method",
              "options": [
                { "label": "JWT", "description": "Stateless tokens, good for APIs" },
                { "label": "Sessions", "description": "Server-side sessions with cookies" }
              ],
              "multiSelect": false
            }
          ]
        }
      }
    ]
  }
}
```

### Outgoing response (user answers)

Send via stdin as a `tool_result`:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_abc123",
        "content": "JWT",
        "is_error": false
      }
    ]
  }
}
```

For multi-select questions, join selected labels with `", "` (e.g. `"JWT, Sessions"`).

## Current State

- `handleClaudeEvent()` in `SessionStore.ts` processes `assistant`, `content_block_delta`, `result`, and `control_request` events
- `ClaudeStreamEvent` type has `message.content[]` which includes `tool_use` blocks but they're not specifically handled
- `claudeService.sendToolApproval()` sends `control_response` — different format from `tool_result`
- `ChatWindow` has a `ToolApprovalPanel` for permission prompts but nothing for questions

## Files to Modify

### 1. `src/renderer/types/index.ts`
- Add question-related types:
  ```ts
  interface AgentQuestion {
    id: string;              // tool_use_id from the event
    questions: QuestionItem[];
  }

  interface QuestionItem {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiSelect: boolean;
  }
  ```

### 2. `src/renderer/services/claude.ts`
- Add `sendQuestionAnswer(toolUseId: string, answers: Record<string, string>)` method
- Sends the `tool_result` envelope via `claude_stdin`:
  ```ts
  const response = {
    type: "user",
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId,
        content: JSON.stringify(answers),
        is_error: false,
      }]
    }
  };
  ```
- The `content` field value depends on the question format — for single questions, send the selected label; for the full `answers` map, send as JSON string

### 3. `src/renderer/stores/SessionStore.ts`
- Add `pendingQuestions: AgentQuestion[]` observable (similar to `pendingToolUses`)
- In `handleClaudeEvent()`, detect `AskUserQuestion` tool_use blocks:
  ```ts
  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "tool_use" && block.name === "AskUserQuestion") {
        this.pendingQuestions.push({
          id: block.id,
          questions: block.input.questions,
        });
      }
    }
  }
  ```
- Add `answerQuestion(toolUseId: string, answers: Record<string, string>)` action:
  - Calls `claudeService.sendQuestionAnswer(toolUseId, answers)`
  - Removes from `pendingQuestions`
  - Appends a user message showing the selected answers

### 4. `src/renderer/components/chat/AgentQuestionPanel.tsx` (new file)
- Renders when `sessionStore.pendingQuestions.length > 0`
- For each pending question set:
  - Display the question text
  - Render option buttons for single-select (radio-style)
  - Render checkboxes for multi-select
  - Each option shows label (bold) and description (muted)
  - "Submit" button sends the selected answers
  - "Other" text input for custom answers (Claude's AskUserQuestion always allows "Other")
- Styled consistently with the existing `ToolApprovalPanel`

### 5. `src/renderer/components/chat/ChatWindow.tsx`
- Import and render `AgentQuestionPanel` alongside `ToolApprovalPanel`
- Position above the input area, same as tool approvals

### 6. `src/renderer/services/claude.ts` (ClaudeStreamEvent type update)
- Extend the `content` array item type to include tool_use fields:
  ```ts
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: {
      questions?: QuestionItem[];
      [key: string]: unknown;
    };
  }>;
  ```

## UI Sketch

### Question panel (single-select):
```
┌────────────────────────────────────────────────┐
│  Claude is asking:                             │
│                                                │
│  Which auth method should we use?              │
│                                                │
│  ○ JWT                                         │
│    Stateless tokens, good for APIs             │
│                                                │
│  ● Sessions                                    │
│    Server-side sessions with cookies           │
│                                                │
│  ○ Other: [________________]                   │
│                                                │
│                                      [Submit]  │
└────────────────────────────────────────────────┘
```

### Question panel (multi-select):
```
┌────────────────────────────────────────────────┐
│  Claude is asking:                             │
│                                                │
│  Which features do you want?                   │
│                                                │
│  ☑ Dark mode                                   │
│    Theme support with system preference        │
│                                                │
│  ☐ i18n                                        │
│    Multi-language support                      │
│                                                │
│  ☑ Analytics                                   │
│    Usage tracking dashboard                    │
│                                                │
│                                      [Submit]  │
└────────────────────────────────────────────────┘
```

### Multiple questions in one request:
- Render each question as a separate section within the same panel
- Single submit button at the bottom sends all answers

## Edge Cases

- **Multiple questions in one tool_use**: the `questions` array can have 1-4 items, render all in one panel
- **Background conversation asks a question**: same as tool approval — show attention badge on tab, OS notification if plan 05 is implemented
- **User closes the question without answering**: can't skip — Claude is blocked. Could add a "Skip" button that sends an empty/default answer
- **"Other" option**: AskUserQuestion always allows free-text "Other" — render a text input that activates when "Other" is selected
- **Timeout**: Claude process will hang indefinitely waiting for an answer — no timeout needed, but the UI should clearly indicate Claude is waiting
- **Question arrives during streaming**: the tool_use block may come in the middle of content blocks — queue it and show the panel once the message turn settles

## References

- [GitHub Issue #16712](https://github.com/anthropics/claude-code/issues/16712) — tool_result via stdin format
- Claude Code's `AskUserQuestion` tool uses a `questions` array with `options`, `multiSelect`, `header` fields

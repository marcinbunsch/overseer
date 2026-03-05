# Autonomous Mode

Autonomous mode puts the AI agent in a loop, automatically re-invoking it until a task is complete or a limit is reached. This solves the problem of agents stopping after one step when working on large multi-step tasks.

## Key Design Principle

Each iteration runs with a **fresh context** (new session ID per iteration). The agent reads its prompt and progress from files in the workspace, not from conversation history. This prevents context window exhaustion and ensures each iteration starts clean.

## Architecture

Each autonomous run enforces a **impl → review → fixes → review** cycle. A review step must run after every implementation step, and only the review step can signal completion.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       AUTONOMOUS SESSION                             │
│  sessionId: {chatId}-auto-{timestamp}                               │
├─────────────────────────────────────────────────────────────────────┤
│ Iteration 1 (impl) │ Iteration 2 (review) │ Iteration 3 (impl) │ …  │
│ Fresh context      │ Fresh context        │ Fresh context      │    │
│ Does the work      │ Reviews all work     │ Fixes issues       │    │
│ Updates progress   │ Writes review.md     │ Updates progress   │    │
│ Cannot complete    │ CAN signal COMPLETE  │ Cannot complete    │    │
└─────────────────────────────────────────────────────────────────────┘
```

## Files

Three files are created in the **workspace root** (visible to the agent):

- `autonomous-prompt.md` - The user's original goal (written once at start)
- `autonomous-progress.md` - Agent's progress notes (updated each iteration)
- `autonomous-review.md` - Review findings written by the review step

## Prompts

### Implementation prompt (odd iterations by default)

```markdown
You are running in **Autonomous Mode**, iteration {N} of max {MAX}.

## Your Goal
Read the file `autonomous-prompt.md` in the workspace root for your full task description.

## Your Progress
Read `autonomous-progress.md` to see what has been accomplished so far.

## Your Job This Iteration
1. Study the goal and current progress
2. Execute the NEXT logical step toward completing the goal
3. Update `autonomous-progress.md` with what you accomplished

## Important
- Each iteration starts fresh - you have no memory of previous iterations
- Always read the progress file first to understand current state
- Make meaningful progress each iteration, don't just plan
- The progress file is your only way to communicate between iterations
- Do NOT signal completion — a dedicated review step determines when the task is done
```

### Review prompt (runs after each implementation step)

```markdown
You are running in **Autonomous Mode**, review step after iteration {N} of max {MAX}.

## Your Goal
Read `autonomous-prompt.md` for the original task description.

## Progress So Far
Read `autonomous-progress.md` to see what has been accomplished.

## Your Job: Review
1. Thoroughly review all work done against the original goal
2. Check for correctness, completeness, and quality
3. Write your full review findings to `autonomous-review.md`
4. Update `autonomous-progress.md` to note that a review was performed and reference `autonomous-review.md`

## Decision
- If the goal is **fully and correctly completed**: end your response with exactly: AUTONOMOUS_SESSION_COMPLETE
- If there are remaining issues or incomplete work: describe clearly in `autonomous-review.md` what still needs to be done. Do NOT output AUTONOMOUS_SESSION_COMPLETE.

## Important
- Be honest and thorough — this review determines whether the task is done
- Each iteration starts fresh - read the files to understand current state
```

## Termination Conditions

1. **Review step** outputs `AUTONOMOUS_SESSION_COMPLETE` (marker stripped from displayed messages) — only review can trigger this
2. Max iterations reached (default: 25, configurable)
3. User clicks Stop button

## Permission Mode

Autonomous mode forces **YOLO mode** for all agent types. All tool requests are auto-approved. This is required for unattended operation.

Each agent type has a different YOLO mode value:
- **Claude**: `bypassPermissions`
- **Codex**: `never`
- **Gemini**: `yolo`
- **Copilot/OpenCode**: Value ignored (these agents don't use permission modes)

The `getYoloModeValueForAgent()` helper in ChatStore automatically selects the correct value based on the current agent type.

## UI Components

### Split Send Button
The Send button becomes a split button with a dropdown arrow. The dropdown contains "Autonomous Run" option.

### Autonomous Dialog
When "Autonomous Run" is selected, a dialog opens with:
- Textarea pre-filled with the chat input content (editable)
- Max iterations input (default: 25)
- YOLO mode indicator (always enabled)
- Start and Cancel buttons

### Autonomous Mode Input Area
When autonomous mode is running, the normal input area is replaced with:
- Spinning icon + "Autonomous Mode Running" label
- Iteration counter (e.g., "Iteration 3 of 25")
- Red Stop button

### Visual Iteration Markers
Special message components show in the chat with markdown rendering:
- **Start**: Blue play icon, "Autonomous Mode Started"
- **Loop (impl)**: Gray rotate icon, "Iteration N of MAX" (clickable to expand and show full loop prompt)
- **Loop (review)**: Gray rotate icon, "Iteration N of MAX (Review)" (clickable to expand)
- **Complete**: Green check, "Autonomous Mode Complete"
- **Stopped**: Yellow stop icon, "Autonomous Mode Stopped"

## Event Flow

```
User clicks "Start Autonomous Run"
    ↓
AutonomousDialog opens → user edits prompt/limit → clicks Start
    ↓
ChatStore.startAutonomousRun(prompt, maxIterations)
    ├── Write autonomous-prompt.md
    ├── Write autonomous-progress.md
    ├── Set autonomousSessionId, autonomousRunning=true
    ├── Add "autonomous-start" message to chat
    └── Call runNextIteration()
            ↓
        runNextIteration()
            ├── Increment autonomousIteration
            ├── Generate iteration session ID
            ├── Add "autonomous-loop" message
            ├── Call sendMessage() with loop prompt
            └── Listen for completion
                    ↓
                onTurnComplete
                    ├── Check for "AUTONOMOUS_SESSION_COMPLETE" in output
                    ├── Check iteration < maxIterations
                    ├── If continue: runNextIteration()
                    └── If done: finishAutonomousRun()
                            ↓
                        finishAutonomousRun()
                            ├── Set autonomousRunning=false
                            ├── Add "autonomous-complete" message
                            └── Return to normal input mode
```

## Implementation Files

### New Files
- `src/renderer/components/chat/AutonomousDialog.tsx` - Configuration dialog
- `src/renderer/components/chat/AutonomousMessage.tsx` - Loop message display

### Modified Files
- `src/renderer/types/index.ts` - `AutonomousMessageType` union type
- `src/renderer/stores/ChatStore.ts` - Autonomous state and methods
- `src/renderer/stores/WorkspaceStore.ts` - Delegated methods and computed properties
- `src/renderer/components/chat/ChatInput.tsx` - Split button, autonomous control UI
- `src/renderer/components/chat/ChatWindow.tsx` - Pass autonomous props
- `src/renderer/components/chat/MessageItem.tsx` - Render autonomous messages
- `src-tauri/src/persistence.rs` - `write_file` Tauri command
- `src-tauri/src/lib.rs` - Command registration

## State Model

```typescript
// ChatStore additions
@observable autonomousMode: boolean = false
@observable autonomousRunning: boolean = false
@observable autonomousIteration: number = 0
@observable autonomousMaxIterations: number = 25
@observable autonomousSessionId: string = ""

// Message meta extension
interface MessageMeta {
  autonomousType?: "autonomous-start" | "autonomous-loop" | "autonomous-complete" | "autonomous-stopped"
  iteration?: number
  maxIterations?: number
}
```

## Session ID Strategy

Each iteration clears the session ID to force fresh context:

```typescript
// Force new session for each iteration by clearing the session ID
this.chat.agentSessionId = null
if (this.service) {
  this.service.setSessionId(this.chat.id, null)
}
```

This causes the agent service to spawn a new process with no memory of previous iterations. Claude CLI requires valid UUIDs for session IDs, so we use `null` to start fresh rather than generating custom iteration-based IDs.

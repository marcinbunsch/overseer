# Autonomous Mode

Autonomous mode puts the AI agent in a loop, automatically re-invoking it until a task is complete or a limit is reached. This solves the problem of agents stopping after one step when working on large multi-step tasks.

## Key Design Principle

Each iteration runs with a **fresh context** (new session ID per iteration). The agent reads its prompt and progress from files in the workspace, not from conversation history. This prevents context window exhaustion and ensures each iteration starts clean.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS SESSION                        │
│  sessionId: {chatId}-auto-{timestamp}                       │
├─────────────────────────────────────────────────────────────┤
│ Iteration 1              │ Iteration 2              │ ...   │
│ sessionId: ...-iter-1    │ sessionId: ...-iter-2    │       │
│ Fresh context            │ Fresh context            │       │
│ Reads prompt + progress  │ Reads prompt + progress  │       │
│ Updates progress         │ Updates progress         │       │
│ Terminates or continues  │ Terminates or continues  │       │
└─────────────────────────────────────────────────────────────┘
```

## Files

Two files are created in the **workspace root** (visible to the agent):

- `autonomous-prompt.md` - The user's original goal (written once at start)
- `autonomous-progress.md` - Agent's progress notes (updated each iteration)

## Loop Prompt

Each iteration receives this injected prompt:

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
4. If the entire goal is COMPLETE:
   - Provide a brief summary of what was accomplished
   - End your response with exactly: AUTONOMOUS_SESSION_COMPLETE

## Important
- Each iteration starts fresh - you have no memory of previous iterations
- Always read the progress file first to understand current state
- Make meaningful progress each iteration, don't just plan
- The progress file is your only way to communicate between iterations
```

## Termination Conditions

1. Agent outputs `AUTONOMOUS_SESSION_COMPLETE` (marker is stripped from displayed messages)
2. Max iterations reached (default: 25, configurable)
3. User clicks Stop button

## Permission Mode

Autonomous mode forces **YOLO mode** for all agent types. All tool requests are auto-approved. This is required for unattended operation.

Each agent type has a different YOLO mode value:
- **Claude**: `bypassPermissions`
- **Codex**: `full-auto`
- **Gemini**: `yolo`
- **Copilot/OpenCode**: Value ignored (these agents don't use permission modes)

The `getYoloModeValue()` helper in ChatStore automatically selects the correct value based on the current agent type.

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
- **Loop**: Gray rotate icon, "Iteration N of MAX" (clickable to expand and show full loop prompt)
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

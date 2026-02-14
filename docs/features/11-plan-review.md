# Plan Review

The plan review feature provides an interactive interface for reviewing and commenting on agent-generated plans before approval. Users can add line-by-line comments that are formatted and sent back to the agent for revision.

## Overview

When an agent enters plan mode and presents a plan via `ExitPlanMode`, users can open the plan review dialog to:
- View the plan in markdown preview or raw code view
- Select lines and add comments
- Collect all feedback and submit it as a formatted message

## User Flow

1. Agent submits a plan via `ExitPlanMode`
2. User clicks to review the plan
3. Plan review dialog opens with markdown preview (default)
4. User can:
   - Double-click to switch to code view at that location
   - Click line numbers to select lines
   - Shift-click or drag to select ranges
   - Add comments to selected lines
   - Edit or remove existing comments
5. User clicks "Submit Review" to send formatted feedback
6. Agent receives the comments and revises the plan

## UI Components

### View Modes

**Markdown View (default)**
- Rendered markdown with syntax highlighting for code blocks
- Double-click any element to switch to code view at that line
- Message icons appear on headings/paragraphs that have comments
- Badge in top-right shows comment count

**Code View**
- Line-numbered display with syntax highlighting
- Click line numbers to start selection
- Shift+click extends selection
- Drag between line numbers for ranges
- Selected lines highlighted in blue
- Lines with notes highlighted in amber

### Notes Sidebar

Right panel showing all collected comments:
- Each note displays line reference ("Line 5" or "Lines 2-4")
- Shows comment text
- Click to edit
- X button to remove (on hover)

### Comment Input

When lines are selected, a comment box appears below the selection:
- Shows line range being commented
- Textarea for comment text
- Cmd/Ctrl+Enter to submit
- Escape to cancel (with confirmation if text entered)

## Submission Format

When the user submits their review, comments are formatted as:

```
User review comments on the proposed plan:

## Line X
> selected line content
> (quoted from plan)

User's comment text

## Lines Y-Z
> (quoted content)

User's comment

---
Please revise the plan based on the feedback above.
```

## Implementation

### Components

| File | Purpose |
|------|---------|
| `PlanReviewDialog.tsx` | Main dialog container with header/footer |
| `PlanContentTable.tsx` | Code view with line selection |
| `PlanMarkdownView.tsx` | Markdown preview with indicators |
| `PlanReviewNotesList.tsx` | Right sidebar with notes list |

### State Management

`PlanReviewStore` manages:
- `pending` - current selection being edited
- `notes` - array of submitted comments
- `viewMode` - "code" or "markdown"
- `highlightedLine` - line to highlight after navigation

### Key Actions

| Action | Description |
|--------|-------------|
| `startSelection(lineIndex, shiftKey)` | Begin or extend line selection |
| `updateComment(text)` | Update pending comment text |
| `addNote(content, startLine, endLine)` | Submit note or update existing |
| `editNote(note)` | Load note into editor |
| `removeNote(noteId)` | Delete a note |
| `switchToCodeAtLine(lineIndex)` | Navigate from markdown to code view |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Enter` | Submit current comment |
| `Escape` | Cancel selection / Close dialog |
| `Shift+Click` | Extend selection |

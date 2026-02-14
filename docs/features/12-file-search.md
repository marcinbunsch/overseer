# @ File Search

The @ file search feature provides inline file autocomplete in the chat input. Type `@` followed by a search query to quickly reference files from your repository.

## Overview

When composing a message, users can type `@` to trigger a file picker that shows matching files from the current workspace. Selecting a file inserts its path into the message.

## User Flow

1. User types `@` in the chat input (at start or after whitespace)
2. File picker appears above the input
3. User types to filter files with fuzzy matching
4. User navigates with arrow keys or mouse
5. User selects with Enter, Tab, or click
6. File path is inserted at cursor position

## Trigger Behavior

The `@` trigger is recognized when:

- At the beginning of the input
- After whitespace (space, newline, tab)

Examples:

- `@src/` - triggers search
- `Check @comp` - triggers search for "comp"
- `email@domain` - does NOT trigger (no preceding whitespace)

## Fuzzy Matching

The search uses a fuzzy matching algorithm that:

- Requires all characters to appear in order
- Scores matches based on:
  - +10 for matches at word boundaries (after `/` or `.`)
  - +5 cumulative bonus for consecutive matches
  - +20 bonus if pattern appears in filename
  - -1 penalty per directory depth
- Shows top 10 results sorted by score

Examples:

- `src` matches `src/components/Button.tsx`
- `ch` matches `src/ChatStore.ts` (c-h consecutive)
- `btn` matches `Button.tsx` (filename match bonus)

## Keyboard Navigation

| Key             | Action                   |
| --------------- | ------------------------ |
| `↑` / `↓`       | Navigate through results |
| `Enter` / `Tab` | Select highlighted file  |
| `Escape`        | Close file picker        |

## UI Display

The autocomplete popup:

- Appears above the input textarea
- Shows file icon + path for each result
- Highlights selected item in blue
- Auto-scrolls to keep selection visible
- Maximum 300px height with scrolling

## Implementation

### Components

| File            | Purpose                      |
| --------------- | ---------------------------- |
| `ChatInput.tsx` | Input field with @ detection |
| `AtSearch.tsx`  | File picker popup component  |
| `fuzzyMatch.ts` | Fuzzy matching algorithm     |

### Key Functions

**findAtQuery(text, cursorPosition)**
Scans backward from cursor to find `@` trigger and extract query.

**fuzzyMatch(pattern, text)**
Returns match score or null if pattern doesn't match.

**gitService.listFiles(workspacePath)**
Fetches all tracked files from the git repository.

## Integration

Files are loaded from git via `list_files` Tauri command on popup mount. The file list includes all tracked files in the repository.

# Mobile UX Improvements

This document covers the mobile-specific UX enhancements added to Overseer for better usability on touch devices and smaller screens.

## Features

### Collapsible Sidebars

On mobile devices (screens < 768px), sidebars are hidden by default and can be toggled via:
- **Header buttons**: Tap the left/right panel icons in the mobile header
- **Edge swipe gestures**: Swipe right from the left edge to open the projects sidebar, swipe left from the right edge to open the changes/terminal sidebar

### Edge Swipe Gestures

The `useEdgeSwipe` hook (`src/renderer/hooks/useEdgeSwipe.ts`) provides touch gesture detection:

```typescript
const { onTouchStart, onTouchEnd } = useEdgeSwipe({
  onSwipeRight: () => openLeftSidebar(),
  onSwipeLeft: () => openRightSidebar(),
  edgeThreshold: 30,    // pixels from edge to detect
  minSwipeDistance: 50, // minimum swipe distance to trigger
})
```

- Detects touches starting within 30px of screen edges
- Requires 50px minimum horizontal swipe
- Only triggers when horizontal movement dominates (avoids conflicts with vertical scrolling)

### Mobile Header

The `MobileHeader` component (`src/renderer/components/layout/MobileHeader.tsx`) provides:
- Left sidebar toggle button
- "Overseer" title (tapping reloads the page)
- Right sidebar toggle button

Only visible on screens < 768px (`md:hidden`).

### Chat Loading State

While chat messages are loading from disk, the UI shows:
- A centered spinner with "Loading chat..." text
- The chat input is hidden until loading completes

This provides better feedback for large chats that take time to load.

### Touch-Friendly Chat Input

On touch devices, the Enter key adds a newline instead of sending the message. Users tap the Send button to submit. This is detected via:

```typescript
const isTouchDevice =
  ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
  !window.matchMedia("(pointer: fine)").matches
```

### Responsive Diff Dialog

The diff dialog adapts to mobile screens:
- **Full screen on mobile**: `inset-0` (no margins, no rounded corners)
- **Windowed on desktop**: `md:inset-10 md:rounded-xl md:border`
- **Horizontal scrolling**: Long lines can be scrolled horizontally
- **Collapsible file list**: Hidden by default on mobile, toggleable via button
- **Hidden file path**: The full path is hidden in the header on mobile

### Hidden Workspace Path

The workspace path in the chat topbar is hidden on mobile (`hidden md:inline`) to save horizontal space.

## PWA Support

Overseer can be installed as a Progressive Web App:

- `public/manifest.json` provides app metadata
- SVG icon used for all icon sizes
- `display: standalone` for native app appearance
- Theme color matches the dark background (`#1b1f24`)

## Implementation Files

- `src/renderer/hooks/useEdgeSwipe.ts` - Edge swipe gesture hook
- `src/renderer/components/layout/MobileHeader.tsx` - Mobile header component
- `src/renderer/stores/UIStore.ts` - Sidebar visibility state
- `src/renderer/App.tsx` - Main layout with gesture handlers
- `src/renderer/components/chat/ChatWindow.tsx` - Chat loading state
- `src/renderer/components/chat/ChatInput.tsx` - Touch device detection
- `src/renderer/components/changes/DiffDialog.tsx` - Responsive diff view
- `public/manifest.json` - PWA manifest
- `index.html` - PWA meta tags

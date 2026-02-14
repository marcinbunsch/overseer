# 17 — Markdown Line Breaks

## Goal

Ensure that soft line breaks (single newlines) in markdown content from AI agents are rendered as `<br>` elements, matching the behavior users expect from chat interfaces.

---

## Problem

By default, CommonMark-compliant markdown parsers treat single newlines as spaces, not line breaks. This means:

```markdown
Line one
Line two
```

Renders as: "Line one Line two" (on the same line)

AI agents often use single newlines to separate short items or create visual breaks, which should be preserved in the rendered output.

---

## Solution

Added the `remark-breaks` plugin to the ReactMarkdown configuration. This plugin converts soft line breaks (single newlines) into `<br>` elements.

After the change:

```markdown
Line one
Line two
```

Renders as:
```html
Line one<br>Line two
```

---

## Implementation

```typescript
// MarkdownContent.tsx
import remarkBreaks from "remark-breaks"

<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkBreaks]}
  // ...
>
```

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/components/chat/MarkdownContent.tsx` | Added `remark-breaks` plugin to remarkPlugins array |
| `package.json` | Added `remark-breaks` dependency |

---

## Dependencies

- `remark-breaks` - Remark plugin to convert newlines to `<br>` elements

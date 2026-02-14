# Plan: Remove Backwards Compatibility Code

This document tracks backwards compatibility code that was added during the rename from "worktrees/repos" to "workspaces/projects". Once users have had sufficient time to migrate, this code should be removed.

## Timeline

- **Introduced:** Commits around `0529910`, `ed905f2`, `7dd3dea`
- **Suggested removal:** After 2-3 releases or ~1 month of usage

---

## 1. ProjectRegistry.ts - Config File Compatibility

**File:** `src/renderer/stores/ProjectRegistry.ts`

### 1.1 Dual file writing (lines 388-390)

Currently writes to both `projects.json` AND `repos.json`:

```typescript
// Also write to repos.json for backwards compatibility
const reposPath = `${getConfigPath(this.home)}/repos.json`
await writeTextFile(reposPath, JSON.stringify(projectsWithCompat, null, 2) + "\n")
```

**To remove:** Delete these lines and only write to `projects.json`.

### 1.2 Property aliases on write (lines 376-383)

Currently writes old property names alongside new ones:

```typescript
const projectsWithCompat = this._projects.map((project) => ({
  ...project,
  // Backwards compatibility for workspaces
  worktrees: project.workspaces,
  worktreeFilter: project.workspaceFilter,
  // Map workspaces with repoId alias for backwards compat
  workspaces: project.workspaces.map((ws) => ({
    ...ws,
    repoId: ws.projectId,
  })),
}))
```

**To remove:** Simplify to only write the new property names:

```typescript
const projects = this._projects.map((project) => ({
  ...project,
  workspaces: project.workspaces.map((ws) => ({
    ...ws,
  })),
}))
```

### 1.3 Fallback to repos.json on read (lines 412-420)

Currently falls back to reading `repos.json` if `projects.json` doesn't exist:

```typescript
if (!projectsFileExists) {
  const reposFileExists = await exists(reposPath)
  if (reposFileExists) {
    configPath = reposPath
    projectsFileExists = true
  }
}
```

**To remove:** Delete this fallback block. Only read from `projects.json`.

### 1.4 Property migration on read (lines 432-461)

Currently migrates old property names when reading:

```typescript
// Migrate old "worktrees" property to "workspaces"
if (item.worktrees && !item.workspaces) {
  result.workspaces = item.worktrees
  delete result.worktrees
  needsMigration = true
}
if (item.worktreeFilter && !item.workspaceFilter) {
  result.workspaceFilter = item.worktreeFilter
  delete result.worktreeFilter
  needsMigration = true
}

// Migrate repoId to projectId in workspaces
if (result.workspaces) {
  result.workspaces = result.workspaces.map((ws: any) => {
    if (ws.repoId && !ws.projectId) {
      needsMigration = true
      return { ...ws, projectId: ws.repoId }
    }
    return ws
  })
}
```

**To remove:** Delete these migration blocks. The `isGitRepo` defaulting can stay as it's a different feature addition.

---

## 2. ChatStore.ts - Session ID Compatibility

**File:** `src/renderer/stores/ChatStore.ts`

### 2.1 claudeSessionId fallback (lines 612-614)

Currently reads legacy `claudeSessionId`:

```typescript
// Backward compat: read claudeSessionId if agentSessionId not present
const sessionId = file.agentSessionId ?? file.claudeSessionId ?? null
this.chat.agentSessionId = sessionId
```

**To remove:** Simplify to:

```typescript
this.chat.agentSessionId = file.agentSessionId ?? null
```

---

## 3. Types - Deprecated Field

**File:** `src/renderer/types/index.ts`

### 3.1 ChatFile.claudeSessionId (lines 112-113)

```typescript
/** @deprecated Use agentSessionId. Kept for backward-compat reading. */
claudeSessionId?: string | null
```

**To remove:** Delete this property from the interface.

---

## 4. Documentation Updates

**File:** `docs/OVERSEER.md`

The documentation still uses old terminology in several places:

- Line 41: References `RepoStore.ts` (should be `ProjectRegistry.ts` or `ProjectStore.ts`)
- Line 55: References `repos/` component directory (should be `projects/`)
- Lines 76-80: Shows `interface Repo` (should be `interface Project`)
- Line 85: Shows `repoId` in Workspace (should be `projectId`)
- Lines 115-123: Section titled "Repository Management" (should be "Project Management")
- Line 220: Only mentions `repos.json` (should mention `projects.json` as primary)

**To update:** Review and update all terminology to use "project" and "workspace".

---

## Removal Checklist

- [ ] Remove dual file writing in `ProjectRegistry.saveToFile()`
- [ ] Remove property aliases on write in `ProjectRegistry.saveToFile()`
- [ ] Remove `repos.json` fallback in `ProjectRegistry.loadFromFile()`
- [ ] Remove property migrations in `ProjectRegistry.loadFromFile()`
- [ ] Remove `claudeSessionId` fallback in `ChatStore.loadChatFromFile()`
- [ ] Remove `claudeSessionId` from `ChatFile` interface
- [ ] Update `docs/OVERSEER.md` with new terminology
- [ ] Delete orphaned `repos.json` files (optional cleanup script)

---

## Testing After Removal

1. Fresh install should create `projects.json` only
2. Existing `projects.json` should load correctly
3. Users with only `repos.json` will need to manually migrate (document in release notes)
4. All chat history should load correctly with `agentSessionId`

# 19 — Login Shell for Agents

## Goal

Ensure all AI agent processes (Claude, Codex, Copilot, Gemini, OpenCode) and the GitHub CLI (`gh`) run in a login shell so that environment variables from user profile files (`~/.bash_profile`, `~/.zshrc`, `~/.profile`, etc.) are loaded.

---

## Problem

Previously, agents and the `gh` CLI were spawned directly using `Command::new(path)` without a login shell. This meant:

- API keys set in shell profiles (e.g., `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) were not available
- PATH modifications from profiles were missing
- Other environment configuration needed by the agents was not loaded

---

## Solution

Wrap agent commands using a configurable shell prefix followed by the command in quotes.

**Default behavior:** `$SHELL -l -c '<command>'`

The shell prefix is fully configurable, allowing users to use any shell invocation format.

### Unix Systems

1. Default prefix: `$SHELL -l -c` (login shell)
2. For non-POSIX shells (fish, nushell, etc.), automatically falls back to `/bin/bash -l -c` or `/bin/sh -l -c`
3. Users can override with any custom prefix (e.g., `/bin/zsh -l -c`, `/bin/bash -c`)

### Windows

Commands run directly (login shell concept doesn't apply).

---

## Implementation

### Rust Backend

A new `build_login_shell_command` function in `shared.rs` handles shell wrapping:

```rust
pub fn build_login_shell_command(
    binary_path: &str,
    args: &[String],
    working_dir: Option<&str>,
    shell_prefix: Option<&str>,  // e.g., "/bin/zsh -l -c"
) -> Result<Command, String>
```

The function:
1. Parses the shell prefix into program and arguments
2. Safely quotes the command using `shlex` crate
3. Executes: `<prefix> '<quoted_command>'`

### Shell Prefix Logic

1. If custom prefix provided (e.g., `/bin/bash -c`), use it directly
2. Otherwise, build default from `$SHELL -l -c`
3. If `$SHELL` is non-POSIX (fish, nu, nushell, elvish, xonsh, ion), use `/bin/bash -l -c` or `/bin/sh -l -c`

---

## Configuration

### Settings UI

A new "Shell Prefix" input in the Advanced section of Settings:

- Empty (default): Uses `$SHELL -l -c`
- Custom prefix: Any shell invocation format (e.g., `/bin/bash -l -c`, `/bin/zsh -c`)

### Config File

```json
{
  "agentShell": "/bin/bash -l -c"
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Added `shlex = "1.3"` dependency |
| `src-tauri/src/agents/shared.rs` | Added `build_login_shell_command` helper |
| `src-tauri/src/agents/claude.rs` | Use login shell, added `agent_shell` param |
| `src-tauri/src/agents/codex.rs` | Use login shell, added `agent_shell` param |
| `src-tauri/src/agents/copilot.rs` | Use login shell, added `agent_shell` param |
| `src-tauri/src/agents/gemini.rs` | Use login shell, added `agent_shell` param |
| `src-tauri/src/agents/opencode.rs` | Use login shell (2 places), added `agent_shell` param |
| `src-tauri/src/git.rs` | Use login shell for `gh pr view` |
| `src/renderer/stores/ConfigStore.ts` | Added `agentShell` setting |
| `src/renderer/services/git.ts` | Pass `agentShell` to `get_pr_status` |
| `src/renderer/services/claude.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/codex.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/copilot.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/gemini.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/opencode.ts` | Pass `agentShell` to invoke (2 places) |
| `src/renderer/components/shared/SettingsDialog.tsx` | Added shell input in Advanced section |

---

## Backward Compatibility

- Old config files without `agentShell` default to `$SHELL -l -c`
- The change is transparent for users with POSIX-compatible shells (bash, zsh)
- Users with fish/nushell get automatic fallback to bash/sh
- Custom prefix format allows maximum flexibility for any shell configuration

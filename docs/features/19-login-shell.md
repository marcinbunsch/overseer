# 19 — Login Shell for Agents

## Goal

Ensure all AI agent processes (Claude, Codex, Copilot, Gemini, OpenCode) run in a login shell so that environment variables from user profile files (`~/.bash_profile`, `~/.zshrc`, `~/.profile`, etc.) are loaded.

---

## Problem

Previously, agents were spawned directly using `Command::new(agent_path)` without a login shell. This meant:

- API keys set in shell profiles (e.g., `ANTHROPIC_API_KEY`) were not available
- PATH modifications from profiles were missing
- Other environment configuration needed by the agents was not loaded

---

## Solution

Wrap agent commands in a login shell: `$SHELL -l -c "command args..."`

On Unix systems:
1. Use the user's configured shell (from Settings) or `$SHELL` environment variable
2. Fall back to `/bin/bash` or `/bin/sh` for non-POSIX shells (fish, nushell, etc.)
3. Use `-l -c` flags to run as a login shell with a command

On Windows:
- Run commands directly (login shell concept doesn't apply the same way)

---

## Implementation

### Rust Backend

A new `build_login_shell_command` function in `shared.rs` handles shell wrapping:

```rust
pub fn build_login_shell_command(
    binary_path: &str,
    args: &[String],
    working_dir: Option<&str>,
    shell_override: Option<&str>,
) -> Result<Command, String>
```

Arguments are safely quoted using the `shlex` crate to handle paths with spaces and special characters.

### Shell Selection Logic

1. Use `shell_override` if provided and non-empty (from config)
2. Otherwise use `$SHELL` environment variable
3. If shell is non-POSIX (fish, nu, nushell, elvish, xonsh, ion), fall back to `/bin/bash` or `/bin/sh`

---

## Configuration

### Settings UI

A new "Agent Shell" input in the Advanced section of Settings:

- Empty (default): Uses `$SHELL` environment variable
- Custom path: Override for users with non-POSIX shells

### Config File

```json
{
  "agentShell": "/bin/bash"
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
| `src/renderer/stores/ConfigStore.ts` | Added `agentShell` setting |
| `src/renderer/services/claude.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/codex.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/copilot.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/gemini.ts` | Pass `agentShell` to invoke |
| `src/renderer/services/opencode.ts` | Pass `agentShell` to invoke (2 places) |
| `src/renderer/components/shared/SettingsDialog.tsx` | Added shell input in Advanced section |

---

## Backward Compatibility

- Old config files without `agentShell` default to using `$SHELL` (existing behavior maintained)
- The change is transparent for users with POSIX-compatible shells (bash, zsh)
- Users with fish/nushell may need to set an explicit shell override

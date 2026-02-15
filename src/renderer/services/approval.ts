import { backend } from "../backend"

/**
 * Parse a bash command into its command prefixes using the Rust backend.
 *
 * For chained commands like `git status && npm test`, returns
 * `["git status", "npm test"]`.
 *
 * For single-word commands (like `ls`), returns just the command name.
 * For multi-word commands (like `git status`), returns the command + subcommand.
 */
export async function getCommandPrefixes(command: string): Promise<string[]> {
  return backend.invoke<string[]>("get_command_prefixes", { command })
}

/**
 * Check if all command prefixes are safe (read-only operations).
 *
 * Returns true only if the prefixes list is non-empty and all prefixes
 * are in the SAFE_COMMANDS set (e.g., git status, git diff, git log).
 */
export async function areCommandsSafe(prefixes: string[]): Promise<boolean> {
  return backend.invoke<boolean>("are_commands_safe", { prefixes })
}

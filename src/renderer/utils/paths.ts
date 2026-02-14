/**
 * Get the config directory name based on dev/prod mode.
 * In dev mode: ~/.config/overseer-dev
 * In prod mode: ~/.config/overseer
 */
export function getConfigDirName(): string {
  return import.meta.env.DEV ? "overseer-dev" : "overseer"
}

/**
 * Build the full config directory path.
 * @param home The user's home directory (without trailing slash)
 */
export function getConfigPath(home: string): string {
  return `${home}/.config/${getConfigDirName()}`
}

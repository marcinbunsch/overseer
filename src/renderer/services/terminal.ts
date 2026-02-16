import { platform } from "@tauri-apps/plugin-os"
import { backend, type Unsubscribe } from "../backend"
import { open } from "@tauri-apps/plugin-shell"
import { Terminal, type IDisposable } from "xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"

import type { ITheme } from "xterm"

/**
 * Strips zsh's PROMPT_EOL_MARK (%) from terminal output.
 * The % appears when previous output lacks a trailing newline.
 * Pattern: % followed by spaces, then ANSI escape (ESC[K) to clear to end of line, then newline
 */
// eslint-disable-next-line no-control-regex
const PROMPT_EOL_MARK_PATTERN = new RegExp("^%\\s*\x1b\\[K\r?\n")

export function stripPromptEolMark(text: string): string {
  return text.replace(PROMPT_EOL_MARK_PATTERN, "")
}

export const TERMINAL_THEME: ITheme = {
  background: "#1a1b1e",
  foreground: "#e6e6e6",
  cursor: "#839496",
  cursorAccent: "#073642",
  selectionBackground: "#406f88",
  selectionForeground: "#fdf6e3",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
}

export interface TerminalInstance {
  ptyId: string
  xterm: Terminal
  fitAddon: FitAddon
  containerEl: HTMLDivElement
  dataUnlisten: Unsubscribe
  exitUnlisten: Unsubscribe
  inputDisposable: IDisposable
  /** Resolves when the shell has produced its first output (ready for input) */
  readyPromise: Promise<void>
  /** Whether any input has been sent to this terminal (user or programmatic) */
  hasInput: boolean
}

class TerminalService {
  private terminals: Map<string, TerminalInstance> = new Map()
  private encoder = new TextEncoder()
  private decoder = new TextDecoder("utf-8")

  private getDefaultShell(): string {
    const current = platform()
    if (current === "windows") return "powershell.exe"
    if (current === "macos") return "/bin/zsh"
    if (current === "linux") return "/bin/bash"
    return "sh"
  }

  async getOrCreate(workspacePath: string, workspaceRoot?: string): Promise<TerminalInstance> {
    const existing = this.terminals.get(workspacePath)
    if (existing) return existing

    const ptyId = crypto.randomUUID()

    const xterm = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(
      new WebLinksAddon((_event, url) => {
        open(url)
      })
    )

    const containerEl = document.createElement("div")
    containerEl.style.position = "absolute"
    containerEl.style.inset = "4px"
    containerEl.style.overflow = "hidden"
    xterm.open(containerEl)
    xterm.attachCustomKeyEventHandler((event) => {
      if (!event.metaKey || event.altKey) return true
      if (event.key.toLowerCase() !== "k") return true

      event.preventDefault()
      xterm.clear()
      this.write(workspacePath, "\x0c")
      return false
    })

    const shell = this.getDefaultShell()

    // Spawn PTY in Rust
    await backend.invoke("pty_spawn", {
      id: ptyId,
      cwd: workspacePath,
      shell,
      cols: xterm.cols,
      rows: xterm.rows,
      workspace_root: workspaceRoot,
    })

    // Track if we're still in the initial output phase.
    // zsh's PROMPT_EOL_MARK (%) appears when previous output lacks a trailing newline.
    // We strip it from the first chunk of output to get a clean terminal start.
    let isFirstChunk = true

    // Promise that resolves when the shell has output its first data (i.e., is ready)
    let resolveReady: () => void
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    // Listen for PTY output
    const dataUnlisten = await backend.listen<number[]>(`pty:data:${ptyId}`, (payload) => {
      const bytes = new Uint8Array(payload)
      let text = this.decoder.decode(bytes, { stream: true })

      // Strip zsh's PROMPT_EOL_MARK from the initial output
      if (isFirstChunk && text) {
        isFirstChunk = false
        text = stripPromptEolMark(text)
        // Shell has produced output, so it's ready for input
        resolveReady()
      }

      if (text) xterm.write(text)
    })

    // Listen for PTY exit
    const exitUnlisten = await backend.listen(`pty:exit:${ptyId}`, () => {
      this.destroy(workspacePath)
    })

    const instance: TerminalInstance = {
      ptyId,
      xterm,
      fitAddon,
      containerEl,
      dataUnlisten,
      exitUnlisten,
      inputDisposable: null as unknown as IDisposable, // Set below
      readyPromise,
      hasInput: false,
    }

    // Forward xterm input to PTY
    instance.inputDisposable = xterm.onData((data: string) => {
      instance.hasInput = true
      const bytes = Array.from(this.encoder.encode(data))
      backend.invoke("pty_write", { id: ptyId, data: bytes })
    })

    this.terminals.set(workspacePath, instance)

    // Inject WORKSPACE_ROOT environment variable after shell is ready
    // This ensures it's available even in login shells that reset env
    if (workspaceRoot) {
      readyPromise.then(async () => {
        // Send export command and clear the screen to hide it
        const initScript = `export WORKSPACE_ROOT="${workspaceRoot}" && clear\r`
        const bytes = Array.from(this.encoder.encode(initScript))
        await invoke("pty_write", { id: ptyId, data: bytes })
      })
    }

    return instance
  }

  destroy(workspacePath: string): void {
    const instance = this.terminals.get(workspacePath)
    if (!instance) return

    instance.dataUnlisten()
    instance.exitUnlisten()
    instance.inputDisposable.dispose()
    backend.invoke("pty_kill", { id: instance.ptyId })
    instance.xterm.dispose()
    this.terminals.delete(workspacePath)
  }

  destroyAll(): void {
    for (const workspacePath of this.terminals.keys()) {
      this.destroy(workspacePath)
    }
  }

  resize(workspacePath: string, cols: number, rows: number): void {
    const instance = this.terminals.get(workspacePath)
    if (!instance) return
    backend.invoke("pty_resize", { id: instance.ptyId, cols, rows })
  }

  write(workspacePath: string, data: string): void {
    const instance = this.terminals.get(workspacePath)
    if (!instance) return
    instance.hasInput = true
    const bytes = Array.from(this.encoder.encode(data))
    backend.invoke("pty_write", { id: instance.ptyId, data: bytes })
  }

  /** Wait for the shell to be ready for input (first output received) */
  async waitForReady(workspacePath: string): Promise<void> {
    const instance = this.terminals.get(workspacePath)
    if (!instance) return
    await instance.readyPromise
  }

  /** Check if terminal exists for a workspace */
  has(workspacePath: string): boolean {
    return this.terminals.has(workspacePath)
  }

  /** Check if terminal has received any input (user or programmatic) */
  hasInput(workspacePath: string): boolean {
    const instance = this.terminals.get(workspacePath)
    return instance?.hasInput ?? false
  }

  /** Destroy terminal if it exists and has never received input */
  destroyIfUnused(workspacePath: string): void {
    const instance = this.terminals.get(workspacePath)
    if (instance && !instance.hasInput) {
      this.destroy(workspacePath)
    }
  }
}

export const terminalService = new TerminalService()

# PTY Rebuild: Replace tauri-pty with Custom Implementation

## Problem

The `tauri-pty` plugin uses HTTP streaming for PTY data channels. When multiple terminals are open, the connections freeze up due to connection pool limits or resource exhaustion. This makes the app unusable with multiple workspaces.

## Solution

Replace `tauri-pty` with a custom Rust PTY module using `portable-pty`. All communication flows through Tauri's native IPC (commands + events) instead of HTTP streaming.

**Key benefits:**

- Single Tauri IPC channel multiplexed by PTY ID
- No HTTP connection limits
- Full control over PTY lifecycle
- Follows existing agent.rs patterns

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (TypeScript)                                       │
│                                                             │
│   terminalService.ts                                        │
│   ├─ spawn(id, cwd, shell?) → invoke("pty_spawn", {...})   │
│   ├─ write(id, data)        → invoke("pty_write", {...})   │
│   ├─ resize(id, cols, rows) → invoke("pty_resize", {...})  │
│   ├─ kill(id)               → invoke("pty_kill", {...})    │
│   │                                                         │
│   └─ Listeners:                                             │
│       listen("pty:data:{id}")  → xterm.write(data)         │
│       listen("pty:exit:{id}")  → cleanup                   │
└─────────────────────────────────────────────────────────────┘
                              │
                    Tauri IPC (single channel)
                              │
┌─────────────────────────────────────────────────────────────┐
│ Rust (src-tauri/src/pty.rs)                                │
│                                                             │
│   PtyMap: HashMap<String, PtyEntry>                        │
│                                                             │
│   PtyEntry {                                                │
│     child: Box<dyn Child + Send>,                          │
│     writer: Arc<Mutex<Box<dyn Write + Send>>>,             │
│     master: MasterPty,  // prevent PTY close               │
│   }                                                         │
│                                                             │
│   Commands:                                                 │
│   ├─ pty_spawn(id, cwd, shell, cols, rows)                 │
│   ├─ pty_write(id, data: Vec<u8>)                          │
│   ├─ pty_resize(id, cols, rows)                            │
│   └─ pty_kill(id)                                          │
│                                                             │
│   Events emitted:                                           │
│   ├─ "pty:data:{id}" → Vec<u8> (raw bytes)                 │
│   └─ "pty:exit:{id}" → { code: i32 }                       │
└─────────────────────────────────────────────────────────────┘
```

## Design Decisions

### PTY Identification

- Use UUID per terminal instance (not workspace path)
- Enables multiple terminals per workspace in the future
- Frontend generates UUID, passes to Rust on spawn

### Shell Selection

- Default: `$SHELL` environment variable
- Fallback: `/bin/zsh` (macOS), `/bin/bash` (Linux), `powershell.exe` (Windows)
- Configurable via settings (future)

### Data Format

- Raw bytes (`Vec<u8>`) for both input and output
- Preserves terminal escape sequences and control characters
- Frontend uses `TextEncoder`/`TextDecoder` for conversion

### No Prompt Detection

- Raw I/O only - no shell state tracking
- Simpler implementation, fewer edge cases
- Can add prompt detection later if needed

## Rust Implementation

### Dependencies

Add to `Cargo.toml`:

```toml
portable-pty = "0.8"
```

### Module: `src-tauri/src/pty.rs`

```rust
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::Emitter;

struct PtyEntry {
    #[allow(dead_code)]
    child: Box<dyn Child + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyMap {
    ptys: Mutex<HashMap<String, PtyEntry>>,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    code: Option<u32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<PtyMap>,
    id: String,
    cwd: String,
    shell: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let writer = Arc::new(Mutex::new(writer));

    // Store entry
    {
        let mut map = state.ptys.lock().unwrap();
        map.insert(
            id.clone(),
            PtyEntry {
                child,
                writer: Arc::clone(&writer),
                master: pair.master,
            },
        );
    }

    // Reader thread - emits pty:data:{id} events
    let read_id = id.clone();
    let read_app = app.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let _ = read_app.emit(&format!("pty:data:{}", read_id), data);
                }
                Err(_) => break,
            }
        }
        // Emit exit event
        let _ = read_app.emit(&format!("pty:exit:{}", read_id), PtyExit { code: None });
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyMap>, id: String, data: Vec<u8>) -> Result<(), String> {
    let map = state.ptys.lock().unwrap();
    let entry = map
        .get(&id)
        .ok_or_else(|| format!("No PTY with id {}", id))?;

    let mut writer = entry.writer.lock().unwrap();
    writer
        .write_all(&data)
        .map_err(|e| format!("Write failed: {}", e))?;
    writer.flush().map_err(|e| format!("Flush failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<PtyMap>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.ptys.lock().unwrap();
    let entry = map
        .get(&id)
        .ok_or_else(|| format!("No PTY with id {}", id))?;

    entry
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<PtyMap>, id: String) -> Result<(), String> {
    let mut map = state.ptys.lock().unwrap();
    if let Some(mut entry) = map.remove(&id) {
        // Child will be killed when dropped
        let _ = entry.child.kill();
    }
    Ok(())
}
```

### Registration in `lib.rs`

```rust
mod pty;

pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyMap::default())
        // ... existing plugins ...
        // REMOVE: .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            // ... existing handlers ...
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        // ...
}
```

## TypeScript Implementation

### Updated `TerminalInstance`

```typescript
export interface TerminalInstance {
  ptyId: string // UUID for this PTY
  xterm: Terminal
  fitAddon: FitAddon
  containerEl: HTMLDivElement
  dataUnlisten: UnlistenFn // Tauri event unlisten
  exitUnlisten: UnlistenFn // Tauri event unlisten
  inputDisposable: IDisposable // xterm.onData disposable
}
```

### Updated `terminalService.ts`

```typescript
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { platform } from "@tauri-apps/plugin-os"
import { Terminal, type IDisposable } from "xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"

class TerminalService {
  private terminals: Map<string, TerminalInstance> = new Map()
  private encoder = new TextEncoder()
  private decoder = new TextDecoder("utf-8")

  private getDefaultShell(): string {
    // Try $SHELL first, fall back to platform default
    const current = platform()
    if (current === "windows") return "powershell.exe"
    if (current === "macos") return "/bin/zsh"
    if (current === "linux") return "/bin/bash"
    return "sh"
  }

  async getOrCreate(workspacePath: string): Promise<TerminalInstance> {
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
    xterm.loadAddon(new WebLinksAddon())

    const containerEl = document.createElement("div")
    containerEl.style.position = "absolute"
    containerEl.style.inset = "4px"
    containerEl.style.overflow = "hidden"
    xterm.open(containerEl)

    const shell = this.getDefaultShell()

    // Spawn PTY in Rust
    await invoke("pty_spawn", {
      id: ptyId,
      cwd: workspacePath,
      shell,
      cols: xterm.cols,
      rows: xterm.rows,
    })

    // Listen for PTY output
    const dataUnlisten = await listen<number[]>(`pty:data:${ptyId}`, (event) => {
      const bytes = new Uint8Array(event.payload)
      const text = this.decoder.decode(bytes, { stream: true })
      if (text) xterm.write(text)
    })

    // Listen for PTY exit
    const exitUnlisten = await listen(`pty:exit:${ptyId}`, () => {
      this.destroy(workspacePath)
    })

    // Forward xterm input to PTY
    const inputDisposable = xterm.onData((data: string) => {
      const bytes = Array.from(this.encoder.encode(data))
      invoke("pty_write", { id: ptyId, data: bytes })
    })

    const instance: TerminalInstance = {
      ptyId,
      xterm,
      fitAddon,
      containerEl,
      dataUnlisten,
      exitUnlisten,
      inputDisposable,
    }
    this.terminals.set(workspacePath, instance)
    return instance
  }

  destroy(workspacePath: string): void {
    const instance = this.terminals.get(workspacePath)
    if (!instance) return

    instance.dataUnlisten()
    instance.exitUnlisten()
    instance.inputDisposable.dispose()
    invoke("pty_kill", { id: instance.ptyId })
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
    invoke("pty_resize", { id: instance.ptyId, cols, rows })
  }
}
```

### Update `TerminalPane.tsx`

The component needs minor updates since `getOrCreate` is now async:

```typescript
useEffect(() => {
  let instance: TerminalInstance | null = null
  let mounted = true

  const init = async () => {
    instance = await terminalService.getOrCreate(workspacePath)
    if (!mounted) return

    wrapper.appendChild(instance.containerEl)
    // ... rest of setup
  }

  init()

  return () => {
    mounted = false
    if (instance) {
      wrapper.removeChild(instance.containerEl)
    }
  }
}, [workspacePath])
```

## Migration Steps

1. **Add `portable-pty` to Cargo.toml**
2. **Create `src-tauri/src/pty.rs`** with PtyMap and commands
3. **Update `lib.rs`**: add state, register commands, remove `tauri_plugin_pty`
4. **Update `terminal.ts`**: replace tauri-pty with invoke/listen calls
5. **Update `TerminalPane.tsx`**: handle async `getOrCreate`
6. **Update tests**: mock new invoke/listen pattern
7. **Remove tauri-pty**: from package.json and Cargo.toml
8. **Test**: multiple terminals, resize, kill, restart

## Testing Checklist

- [ ] Single terminal works
- [ ] Multiple terminals work simultaneously (the main goal!)
- [ ] Terminal resize sends SIGWINCH correctly
- [ ] Shell exit triggers cleanup
- [ ] Manual kill works
- [ ] Switching workspaces preserves terminal state
- [ ] Login shell sources profile files correctly
- [ ] Unicode/emoji display correctly
- [ ] Control characters (Ctrl+C, Ctrl+D) work

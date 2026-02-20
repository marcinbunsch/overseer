import { observable, action, makeObservable } from "mobx"

export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug"

export interface ConsoleEntry {
  id: number
  level: ConsoleLevel
  message: string
  timestamp: Date
}

const MAX_ENTRIES = 500

/**
 * Store for capturing console output for mobile debugging.
 * Intercepts console.log/warn/error/info/debug and stores entries
 * for display in the mobile debug console.
 */
class ConsoleStore {
  @observable
  entries: ConsoleEntry[] = []

  @observable
  hasUnreadErrors = false

  private nextId = 0
  private initialized = false
  private originalConsole: {
    log: typeof console.log
    warn: typeof console.warn
    error: typeof console.error
    info: typeof console.info
    debug: typeof console.debug
  } | null = null

  constructor() {
    makeObservable(this)
  }

  /**
   * Initialize console interception. Call once at app startup.
   */
  init() {
    if (this.initialized) return
    this.initialized = true

    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    }

    // Intercept each method
    console.log = (...args: unknown[]) => {
      this.addEntry("log", args)
      this.originalConsole!.log(...args)
    }
    console.warn = (...args: unknown[]) => {
      this.addEntry("warn", args)
      this.originalConsole!.warn(...args)
    }
    console.error = (...args: unknown[]) => {
      this.addEntry("error", args)
      this.originalConsole!.error(...args)
    }
    console.info = (...args: unknown[]) => {
      this.addEntry("info", args)
      this.originalConsole!.info(...args)
    }
    console.debug = (...args: unknown[]) => {
      this.addEntry("debug", args)
      this.originalConsole!.debug(...args)
    }
  }

  @action
  private addEntry(level: ConsoleLevel, args: unknown[]) {
    const message = args
      .map((arg) => {
        if (typeof arg === "string") return arg
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return String(arg)
        }
      })
      .join(" ")

    const entry: ConsoleEntry = {
      id: this.nextId++,
      level,
      message,
      timestamp: new Date(),
    }

    this.entries.push(entry)

    // Trim old entries if over limit
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
    }

    // Track unread errors
    if (level === "error" || level === "warn") {
      this.hasUnreadErrors = true
    }
  }

  @action
  clear() {
    this.entries = []
    this.hasUnreadErrors = false
  }

  @action
  markRead() {
    this.hasUnreadErrors = false
  }
}

export const consoleStore = new ConsoleStore()

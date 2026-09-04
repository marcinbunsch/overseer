import React from "react"
import { consoleStore } from "../stores/ConsoleStore"

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level error boundary. When a render throws, React unmounts the whole tree
 * — including the in-app debug console — leaving a blank white screen (the exact
 * symptom on mobile). This catches that and shows the error, its stack, and the
 * most recent captured console errors, so there's something to read on-device.
 *
 * Uses inline styles rather than Tailwind classes so it still renders even if a
 * stylesheet failed to load.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Route through console.error so ConsoleStore captures it and forwards it to
    // the server log like any other error.
    console.error("React render crashed:", error.message, error.stack, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    const recentErrors = consoleStore.entries
      .filter((entry) => entry.level === "error" || entry.level === "warn")
      .slice(-15)

    return (
      <div
        data-testid="error-boundary-fallback"
        style={{
          position: "fixed",
          inset: 0,
          overflow: "auto",
          background: "#1b1f24",
          color: "#e6e6e6",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          padding: 20,
          zIndex: 999999,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <h1 style={{ color: "#ff6b6b", fontSize: 18, margin: "0 0 4px" }}>Overseer crashed</h1>
        <p style={{ color: "#9aa4af", margin: "0 0 16px" }}>
          The UI hit an error it couldn&apos;t recover from. Details below.
        </p>

        <button
          onClick={this.handleReload}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 14,
            cursor: "pointer",
            marginBottom: 20,
          }}
        >
          Reload
        </button>

        <Section title="Error">
          <pre data-testid="error-boundary-message" style={preStyle}>
            {error.message}
          </pre>
        </Section>

        {error.stack && (
          <Section title="Stack">
            <pre style={preStyle}>{error.stack}</pre>
          </Section>
        )}

        {recentErrors.length > 0 && (
          <Section title="Recent console errors">
            <pre style={preStyle}>
              {recentErrors.map((entry) => `[${entry.level}] ${entry.message}`).join("\n\n")}
            </pre>
          </Section>
        )}
      </div>
    )
  }
}

const preStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "#12151a",
  border: "1px solid #2a2f37",
  borderRadius: 8,
  padding: 12,
  margin: 0,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: "#9aa4af", marginBottom: 6, textTransform: "uppercase", fontSize: 11 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

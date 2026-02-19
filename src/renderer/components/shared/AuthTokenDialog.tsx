import { useState } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { Key } from "lucide-react"
import { httpBackend } from "../../backend/http"

interface AuthTokenDialogProps {
  open: boolean
  onAuthenticated: () => void
}

/**
 * Dialog that prompts for an authentication token when the HTTP backend
 * rejects requests with 401 Unauthorized.
 *
 * This is shown automatically when connecting to an Overseer HTTP server
 * that has authentication enabled.
 */
export function AuthTokenDialog({ open, onAuthenticated }: AuthTokenDialogProps) {
  const [token, setToken] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!token.trim()) {
      setError("Please enter a token")
      return
    }

    setError(null)
    setVerifying(true)

    try {
      // Set the token in the backend
      httpBackend.setAuthToken(token.trim())

      // Try a simple invoke to verify the token works
      // list_projects is a lightweight command that should always work
      await httpBackend.invoke("list_projects")

      // Success - notify parent
      onAuthenticated()
    } catch (err) {
      // Token didn't work, clear it
      httpBackend.setAuthToken(null)
      setError(err instanceof Error ? err.message : "Invalid token")
    } finally {
      setVerifying(false)
    }
  }

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <AlertDialog.Title className="mb-1 flex items-center gap-2 text-base font-semibold text-ovr-text-strong">
            <Key className="size-5" />
            Authentication Required
          </AlertDialog.Title>
          <AlertDialog.Description className="mb-4 text-sm text-ovr-text-muted">
            This Overseer server requires authentication. Enter the token displayed in the desktop
            app.
          </AlertDialog.Description>

          <form onSubmit={handleSubmit}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter authentication token"
              autoFocus
              className="ovr-input mb-3 w-full px-3 py-2 text-sm"
              disabled={verifying}
              data-testid="auth-token-input"
            />

            {error && <p className="mb-3 text-xs text-ovr-error">{error}</p>}

            <button
              type="submit"
              disabled={verifying || !token.trim()}
              className="ovr-btn-primary w-full py-2 text-sm disabled:opacity-50"
              data-testid="auth-submit-btn"
            >
              {verifying ? "Verifying..." : "Connect"}
            </button>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

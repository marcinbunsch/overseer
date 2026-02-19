import { observer } from "mobx-react-lite"
import * as Tooltip from "@radix-ui/react-tooltip"
import { useEffect, useState } from "react"
import { httpBackend, type WsConnectionState } from "../../backend/http"
import { backend } from "../../backend"

/**
 * Indicator showing WebSocket connection status in web mode.
 * Shows a colored dot with tooltip explaining the connection state.
 */
export const WebSocketConnectionIndicator = observer(function WebSocketConnectionIndicator() {
  const [connectionState, setConnectionState] = useState<WsConnectionState>(
    httpBackend.connectionState
  )

  useEffect(() => {
    // Subscribe to connection state changes
    const unsubscribe = httpBackend.onConnectionStateChange(setConnectionState)
    // Sync initial state
    setConnectionState(httpBackend.connectionState)
    return unsubscribe
  }, [])

  // Only show in web mode
  if (backend.type !== "web") {
    return null
  }

  const getColor = () => {
    switch (connectionState) {
      case "connected":
        return "bg-ovr-ok"
      case "connecting":
        return "bg-ovr-warn"
      case "disconnected":
        return "bg-ovr-bad"
    }
  }

  const getLabel = () => {
    switch (connectionState) {
      case "connected":
        return "Connected"
      case "connecting":
        return "Connecting..."
      case "disconnected":
        return "Disconnected"
    }
  }

  const getDescription = () => {
    switch (connectionState) {
      case "connected":
        return "WebSocket connected to server"
      case "connecting":
        return "Establishing WebSocket connection..."
      case "disconnected":
        return "WebSocket disconnected, will retry automatically"
    }
  }

  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className="flex cursor-default items-center gap-1.5"
            data-testid="ws-connection-indicator"
          >
            <div className={`size-2 rounded-full ${getColor()}`} />
            <span className="text-xs text-ovr-text-dim">{getLabel()}</span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 rounded bg-ovr-bg-elevated px-3 py-2 text-xs text-ovr-text-primary shadow-lg"
            sideOffset={5}
          >
            <div className="font-medium">WebSocket Status</div>
            <div className="text-ovr-text-muted">{getDescription()}</div>
            <Tooltip.Arrow className="fill-ovr-bg-elevated" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
})

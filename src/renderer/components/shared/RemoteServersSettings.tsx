import { observer } from "mobx-react-lite"
import { useState } from "react"
import { Loader2, Plus, Trash2, Globe, AlertCircle, Check } from "lucide-react"
import classNames from "classnames"
import {
  remoteServerStore,
  type RemoteServer,
  type RemoteServerConfig,
} from "../../stores/RemoteServerStore"
import { configStore } from "../../stores/ConfigStore"
import { Input } from "./Input"

interface AddServerFormProps {
  onAdd: (config: Omit<RemoteServerConfig, "id">) => void
  onCancel: () => void
}

function AddServerForm({ onAdd, onCancel }: AddServerFormProps) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [authToken, setAuthToken] = useState("")
  const [autoConnect, setAutoConnect] = useState(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd({
      name: name.trim(),
      url: url.trim().replace(/\/$/, ""), // Remove trailing slash
      authToken: authToken.trim() || undefined,
      autoConnect,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-dashed border-ovr-border-subtle bg-ovr-bg-elevated p-3"
    >
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[11px] text-ovr-text-muted">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Home Server"
            className="w-full text-xs"
            autoFocus
          />
        </div>
        <div className="flex-[2]">
          <label className="mb-1 block text-[11px] text-ovr-text-muted">URL</label>
          <Input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.100:6767"
            className="w-full text-xs"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-ovr-text-muted">Auth Token (optional)</label>
        <Input
          type="text"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="Bearer token from server"
          className="w-full text-xs"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
            className="size-3.5 rounded border-ovr-border-subtle bg-ovr-bg-panel"
          />
          <span className="text-xs text-ovr-text-muted">Auto-connect on launch</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !url.trim()}
            className="ovr-btn-primary px-3 py-1 text-xs disabled:opacity-50"
          >
            Add Server
          </button>
        </div>
      </div>
    </form>
  )
}

interface ServerItemProps {
  server: RemoteServer
}

const ServerItem = observer(function ServerItem({ server }: ServerItemProps) {
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      await remoteServerStore.connect(server.id)
      configStore.saveRemoteServers()
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = () => {
    remoteServerStore.disconnect(server.id)
  }

  const handleRemove = () => {
    remoteServerStore.removeServer(server.id)
    configStore.saveRemoteServers()
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ovr-bg-panel">
        <Globe className="size-4 text-ovr-text-dim" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-ovr-text-primary">{server.name}</span>
          {server.isConnected && (
            <span className="flex items-center gap-1 text-[10px] text-ovr-ok">
              <Check className="size-3" />
              Connected
            </span>
          )}
          {server.isConnecting && (
            <span className="flex items-center gap-1 text-[10px] text-ovr-text-dim">
              <Loader2 className="size-3 animate-spin" />
              Connecting...
            </span>
          )}
          {server.connectionError && (
            <span
              className="flex items-center gap-1 text-[10px] text-ovr-bad"
              title={server.connectionError}
            >
              <AlertCircle className="size-3" />
              Error
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-ovr-text-dim">{server.url}</div>
        {server.isConnected && server.projects.length > 0 && (
          <div className="mt-1 text-[10px] text-ovr-text-dim">
            {server.projects.length} project{server.projects.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {server.isConnected ? (
          <button
            onClick={handleDisconnect}
            className="rounded px-2 py-1 text-[11px] text-ovr-text-muted hover:bg-ovr-bg-panel hover:text-ovr-text-primary"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isConnecting || server.isConnecting}
            className={classNames(
              "rounded px-2 py-1 text-[11px] disabled:opacity-50",
              server.connectionError
                ? "text-ovr-warn hover:bg-ovr-warn/10"
                : "text-ovr-azure-400 hover:bg-ovr-azure-500/10"
            )}
          >
            {isConnecting ? "Connecting..." : server.connectionError ? "Retry" : "Connect"}
          </button>
        )}
        <button
          onClick={handleRemove}
          className="rounded p-1.5 text-ovr-text-dim hover:bg-ovr-bad/10 hover:text-ovr-bad"
          title="Remove server"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
})

export const RemoteServersSettings = observer(function RemoteServersSettings() {
  const [showAddForm, setShowAddForm] = useState(false)

  const handleAddServer = (config: Omit<RemoteServerConfig, "id">) => {
    remoteServerStore.addServer(config)
    configStore.saveRemoteServers()
    setShowAddForm(false)

    // Auto-connect if enabled
    if (config.autoConnect) {
      const server = remoteServerStore.servers.find((s) => s.url === config.url)
      if (server) {
        remoteServerStore.connect(server.id).catch(() => {})
      }
    }
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Remote Servers</label>
      <p className="mb-3 text-[11px] text-ovr-text-dim">
        Connect to remote Overseer instances to access their projects.
      </p>

      <div className="space-y-2">
        {remoteServerStore.servers.map((server) => (
          <ServerItem key={server.id} server={server} />
        ))}

        {showAddForm ? (
          <AddServerForm onAdd={handleAddServer} onCancel={() => setShowAddForm(false)} />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ovr-border-subtle py-2 text-xs text-ovr-text-dim transition-colors hover:border-ovr-azure-500 hover:text-ovr-azure-400"
          >
            <Plus className="size-3.5" />
            Add Remote Server
          </button>
        )}
      </div>
    </div>
  )
})

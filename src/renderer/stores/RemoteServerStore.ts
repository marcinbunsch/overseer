import { observable, action, makeObservable, computed, runInAction } from "mobx"
import type { Backend } from "../backend/types"
import { createHttpBackend, type HttpBackend } from "../backend/http"
import type { Project } from "../types"

export interface RemoteServerConfig {
  id: string
  name: string
  url: string
  authToken?: string
  autoConnect?: boolean
}

export interface RemoteServer extends RemoteServerConfig {
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null
  projects: Project[]
}

class RemoteServerStore {
  @observable
  private _servers: Map<string, RemoteServer> = new Map()

  private _backends: Map<string, HttpBackend> = new Map()

  constructor() {
    makeObservable(this)
  }

  @computed
  get servers(): RemoteServer[] {
    return Array.from(this._servers.values())
  }

  @computed
  get connectedServers(): RemoteServer[] {
    return this.servers.filter((s) => s.isConnected)
  }

  /**
   * Get all projects from connected remote servers.
   */
  @computed
  get remoteProjects(): Project[] {
    return this.connectedServers.flatMap((server) =>
      server.projects.map((project) => ({
        ...project,
        remoteServerUrl: server.url,
      }))
    )
  }

  /**
   * Get the backend for a specific remote server URL.
   * Returns undefined if the server is not connected.
   */
  getBackend(serverUrl: string): Backend | undefined {
    return this._backends.get(serverUrl)
  }

  /**
   * Initialize servers from saved config.
   * Called by ConfigStore after loading.
   */
  @action
  initFromConfig(configs: RemoteServerConfig[]): void {
    for (const config of configs) {
      this._servers.set(config.id, {
        ...config,
        isConnected: false,
        isConnecting: false,
        connectionError: null,
        projects: [],
      })
    }
  }

  /**
   * Add a new remote server.
   */
  @action
  addServer(config: Omit<RemoteServerConfig, "id">): RemoteServer {
    const id = crypto.randomUUID()
    const server: RemoteServer = {
      id,
      ...config,
      isConnected: false,
      isConnecting: false,
      connectionError: null,
      projects: [],
    }
    this._servers.set(id, server)
    return server
  }

  /**
   * Update a server's configuration.
   */
  @action
  updateServer(id: string, updates: Partial<Omit<RemoteServerConfig, "id">>): void {
    const server = this._servers.get(id)
    if (!server) return

    // If URL changed and we're connected, disconnect first
    if (updates.url && updates.url !== server.url && server.isConnected) {
      this.disconnect(id)
    }

    Object.assign(server, updates)
  }

  /**
   * Remove a server.
   */
  @action
  removeServer(id: string): void {
    const server = this._servers.get(id)
    if (!server) return

    // Disconnect and cleanup
    if (server.isConnected) {
      this.disconnect(id)
    }

    this._servers.delete(id)
  }

  /**
   * Connect to a remote server.
   */
  @action
  async connect(id: string): Promise<void> {
    const server = this._servers.get(id)
    if (!server || server.isConnecting || server.isConnected) return

    server.isConnecting = true
    server.connectionError = null

    try {
      // Create HTTP backend for this server
      const backend = createHttpBackend(server.url)

      // Set auth token if provided
      if (server.authToken) {
        backend.setAuthToken(server.authToken)
      }

      // Test connection by fetching projects
      const registry = await backend.invoke<{ projects: Project[] }>("load_project_registry")

      runInAction(() => {
        server.isConnected = true
        server.isConnecting = false
        server.projects = registry.projects
        this._backends.set(server.url, backend)
      })
    } catch (err) {
      runInAction(() => {
        server.isConnecting = false
        server.connectionError = err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  /**
   * Disconnect from a remote server.
   */
  @action
  disconnect(id: string): void {
    const server = this._servers.get(id)
    if (!server) return

    // Clean up backend
    const backend = this._backends.get(server.url)
    if (backend) {
      backend.disconnect()
      this._backends.delete(server.url)
    }

    server.isConnected = false
    server.isConnecting = false
    server.connectionError = null
    server.projects = []
  }

  /**
   * Refresh projects from a connected server.
   */
  @action
  async refreshProjects(id: string): Promise<void> {
    const server = this._servers.get(id)
    if (!server || !server.isConnected) return

    const backend = this._backends.get(server.url)
    if (!backend) return

    try {
      const registry = await backend.invoke<{ projects: Project[] }>("load_project_registry")
      runInAction(() => {
        server.projects = registry.projects
      })
    } catch (err) {
      console.error(`Failed to refresh projects from ${server.name}:`, err)
    }
  }

  /**
   * Connect to all servers with autoConnect enabled.
   */
  async autoConnectServers(): Promise<void> {
    const promises = this.servers
      .filter((s) => s.autoConnect && !s.isConnected && !s.isConnecting)
      .map((s) => this.connect(s.id).catch(() => {})) // Ignore individual failures

    await Promise.all(promises)
  }

  /**
   * Get server configs for persistence.
   */
  getConfigs(): RemoteServerConfig[] {
    return this.servers.map(({ id, name, url, authToken, autoConnect }) => ({
      id,
      name,
      url,
      authToken,
      autoConnect,
    }))
  }

  /**
   * Get server by ID.
   */
  getServer(id: string): RemoteServer | undefined {
    return this._servers.get(id)
  }

  /**
   * Find server by URL.
   */
  getServerByUrl(url: string): RemoteServer | undefined {
    return this.servers.find((s) => s.url === url)
  }
}

export const remoteServerStore = new RemoteServerStore()

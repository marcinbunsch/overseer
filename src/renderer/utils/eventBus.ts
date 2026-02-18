/**
 * App-wide event bus for decoupled communication between components.
 *
 * Used primarily for overseer actions to communicate with stores without
 * creating circular dependencies.
 */

type EventCallback<T = unknown> = (payload: T) => void

interface EventMap {
  "overseer:open_pr": { title: string; body?: string }
  "overseer:merge_branch": { into: string }
  "overseer:new_workspace": void
  "overseer:open_diff_review": void
  "overseer:focus_chat_input": void
  "agent:turnComplete": { agentType: string; chatId: string }
}

type EventName = keyof EventMap

class EventBus {
  private listeners = new Map<EventName, Set<EventCallback>>()

  on<K extends EventName>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as EventCallback)

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback)
    }
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload)
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err)
        }
      }
    }
  }

  off<K extends EventName>(event: K, callback: EventCallback<EventMap[K]>): void {
    this.listeners.get(event)?.delete(callback as EventCallback)
  }
}

export const eventBus = new EventBus()

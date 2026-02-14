import { observable, action, makeObservable } from "mobx"

export interface Toast {
  id: string
  message: string
}

class ToastStore {
  @observable toasts: Toast[] = []

  constructor() {
    makeObservable(this)
  }

  @action show(message: string): void {
    const id = crypto.randomUUID()
    this.toasts.push({ id, message })
    setTimeout(() => this.dismiss(id), 3000)
  }

  @action dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id)
  }
}

export const toastStore = new ToastStore()

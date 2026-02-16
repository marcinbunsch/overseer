import { observable, action, runInAction, makeObservable } from "mobx"

interface ConfirmDialogState {
  title: string
  description: string
  confirmLabel: string
  resolve: (confirmed: boolean) => void
}

class ConfirmDialogStore {
  @observable
  current: ConfirmDialogState | null = null

  constructor() {
    makeObservable(this)
  }

  /**
   * Show a confirmation dialog and return a promise that resolves to true if confirmed.
   */
  confirm(options: {
    title: string
    description: string
    confirmLabel?: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      runInAction(() => {
        this.current = {
          title: options.title,
          description: options.description,
          confirmLabel: options.confirmLabel ?? "Confirm",
          resolve,
        }
      })
    })
  }

  @action
  handleConfirm() {
    if (this.current) {
      this.current.resolve(true)
      this.current = null
    }
  }

  @action
  handleCancel() {
    if (this.current) {
      this.current.resolve(false)
      this.current = null
    }
  }
}

export const confirmDialogStore = new ConfirmDialogStore()

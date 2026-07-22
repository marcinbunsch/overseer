import { action, makeObservable, observable } from "mobx"

export interface CodexUsageWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexCredits {
  hasCredits: boolean
  unlimited: boolean
  balance: string | null
}

export interface CodexUsageData {
  limitId: string | null
  limitName: string | null
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  credits: CodexCredits | null
  planType: string | null
}

export class CodexUsageStore {
  @observable
  usageData: CodexUsageData | null = null

  constructor() {
    makeObservable(this)
  }

  @action
  setUsageData(usageData: CodexUsageData) {
    this.usageData = usageData
  }
}

export const codexUsageStore = new CodexUsageStore()

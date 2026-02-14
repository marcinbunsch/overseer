import { invoke } from "@tauri-apps/api/core"
import { configStore } from "../stores/ConfigStore"

class ExternalService {
  async openInEditor(path: string): Promise<void> {
    return invoke<void>("open_external", {
      command: configStore.editorCommand,
      path,
    })
  }

  async openInTerminal(path: string): Promise<void> {
    return invoke<void>("open_external", {
      command: configStore.terminalCommand,
      path,
    })
  }
}

export const externalService = new ExternalService()

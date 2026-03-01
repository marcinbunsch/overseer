import { observer } from "mobx-react-lite"
import { PanelLeft, PanelRight, RefreshCw, Terminal } from "lucide-react"
import { uiStore } from "../../stores/UIStore"
import { consoleStore } from "../../stores/ConsoleStore"
import { reloadWithState } from "../../utils/urlState"

/**
 * Mobile header with sidebar toggle buttons.
 * Only visible on small screens (md:hidden).
 */
export const MobileHeader = observer(function MobileHeader() {
  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 md:hidden">
      <div className="flex gap-1">
        <button
          onClick={() => uiStore.toggleLeftSidebar()}
          className="flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
          aria-label="Toggle projects sidebar"
        >
          <PanelLeft size={20} />
        </button>
        <button
          onClick={reloadWithState}
          className="flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
          aria-label="Reload app"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <span className="text-sm font-medium text-ovr-text-muted">Overseer</span>

      <div className="flex gap-1">
        <button
          onClick={() => uiStore.toggleMobileConsole()}
          className="relative flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
          aria-label="Toggle debug console"
        >
          <Terminal size={18} />
          {consoleStore.hasUnreadErrors && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
          )}
        </button>
        <button
          onClick={() => uiStore.toggleRightSidebar()}
          className="flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
          aria-label="Toggle terminal sidebar"
        >
          <PanelRight size={20} />
        </button>
      </div>
    </div>
  )
})

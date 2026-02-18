import { observer } from "mobx-react-lite"
import { PanelLeft, PanelRight } from "lucide-react"
import { uiStore } from "../../stores/UIStore"

/**
 * Mobile header with sidebar toggle buttons.
 * Only visible on small screens (md:hidden).
 */
export const MobileHeader = observer(function MobileHeader() {
  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 md:hidden">
      <button
        onClick={() => uiStore.toggleLeftSidebar()}
        className="flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
        aria-label="Toggle projects sidebar"
      >
        <PanelLeft size={20} />
      </button>

      <span className="text-sm font-medium text-ovr-text-muted">Overseer</span>

      <button
        onClick={() => uiStore.toggleRightSidebar()}
        className="flex h-8 w-8 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
        aria-label="Toggle terminal sidebar"
      >
        <PanelRight size={20} />
      </button>
    </div>
  )
})

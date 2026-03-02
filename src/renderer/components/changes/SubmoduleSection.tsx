import { useState } from "react"
import { observer } from "mobx-react-lite"
import { ChevronDown, ChevronRight, FolderGit2 } from "lucide-react"
import { STATUS_STYLES } from "../../constants/git"
import type { ChangedFile, SubmoduleResult } from "../../types"

interface SubmoduleSectionProps {
  submodule: SubmoduleResult
  onFileClick: (file: ChangedFile) => void
  depth?: number
}

/**
 * Collapsible section for displaying files changed inside a submodule.
 * Supports nested submodules via recursion.
 */
export const SubmoduleSection = observer(function SubmoduleSection({
  submodule,
  onFileClick,
  depth = 0,
}: SubmoduleSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const totalFiles = submodule.files.length + submodule.uncommitted.length
  const indentPx = depth * 12 // 12px per nesting level

  // Create a file with submodulePath attached for diff routing
  const createSubmoduleFile = (file: ChangedFile, isUncommitted: boolean): ChangedFile => ({
    ...file,
    isUncommitted,
    submodulePath: submodule.path,
  })

  if (!submodule.isInitialized) {
    return (
      <div style={{ marginLeft: indentPx }}>
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ovr-text-dim italic">
          <FolderGit2 className="size-3.5 text-ovr-text-dim" />
          <span className="flex-1 truncate">{submodule.path}</span>
          <span className="rounded bg-ovr-bg-elevated px-1 text-[10px]">not initialized</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginLeft: indentPx }}>
      {/* Submodule header */}
      <button
        data-testid={`submodule-header-${submodule.path}`}
        onClick={() => setCollapsed(!collapsed)}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5 text-left text-xs font-medium text-ovr-azure-400 hover:bg-ovr-bg-elevated/50"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" data-testid="chevron-right" />
        ) : (
          <ChevronDown className="size-3.5" data-testid="chevron-down" />
        )}
        <FolderGit2 className="size-3.5" />
        <span className="flex-1 truncate">{submodule.path}</span>
        <span className="text-ovr-text-dim" data-testid="submodule-file-count">
          {totalFiles}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Uncommitted changes inside submodule */}
          {submodule.uncommitted.map((file) => {
            const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
            const subFile = createSubmoduleFile(file, true)
            return (
              <button
                key={`${submodule.path}-uncommitted-${file.path}`}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 pl-6 text-left text-sm hover:bg-ovr-bg-elevated/50"
                onClick={() => onFileClick(subFile)}
                data-testid={`submodule-file-${submodule.path}-${file.path}`}
              >
                <span
                  className={`w-4 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                >
                  {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-ovr-text-primary">{file.path}</span>
              </button>
            )
          })}

          {/* Committed changes inside submodule */}
          {submodule.files.map((file) => {
            const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
            const subFile = createSubmoduleFile(file, false)
            return (
              <button
                key={`${submodule.path}-branch-${file.path}`}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 pl-6 text-left text-sm hover:bg-ovr-bg-elevated/50"
                onClick={() => onFileClick(subFile)}
                data-testid={`submodule-file-${submodule.path}-${file.path}`}
              >
                <span
                  className={`w-4 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                >
                  {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-ovr-text-primary">{file.path}</span>
              </button>
            )
          })}

          {/* Nested submodules (recursive) */}
          {submodule.submodules.map((nested) => (
            <SubmoduleSection
              key={nested.path}
              submodule={nested}
              onFileClick={onFileClick}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </div>
  )
})

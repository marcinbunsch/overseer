import { useEffect, useState, useRef, useCallback } from "react"
import { File, Loader2 } from "lucide-react"
import { gitService } from "../../services/git"
import { fuzzyMatch } from "../../utils/fuzzyMatch"

interface AtSearchProps {
  query: string
  workspacePath: string
  onSelect: (path: string) => void
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
}

export function AtSearch({
  query,
  workspacePath,
  onSelect,
  selectedIndex,
  onSelectedIndexChange,
}: AtSearchProps) {
  const [files, setFiles] = useState<string[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loading = files === null

  // Load files on mount
  useEffect(() => {
    let cancelled = false

    gitService
      .listFiles(workspacePath)
      .then((result) => {
        if (!cancelled) {
          setFiles(result)
        }
      })
      .catch((err) => {
        console.error("Failed to list files:", err)
        if (!cancelled) {
          setFiles([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspacePath])

  // Filter and sort files based on query
  const filteredFiles = useCallback(() => {
    if (!files) return []

    if (!query.trim()) {
      // Show first 10 files when no query
      return files.slice(0, 10)
    }

    const matches: Array<{ path: string; score: number }> = []
    for (const file of files) {
      const result = fuzzyMatch(query, file)
      if (result.match) {
        matches.push({ path: file, score: result.score })
      }
    }

    // Sort by score descending, then alphabetically
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.path.localeCompare(b.path)
    })

    return matches.slice(0, 10).map((m) => m.path)
  }, [files, query])

  const results = filteredFiles()

  // Ensure selectedIndex is within bounds
  useEffect(() => {
    if (selectedIndex >= results.length) {
      onSelectedIndexChange(Math.max(0, results.length - 1))
    }
  }, [results.length, selectedIndex, onSelectedIndexChange])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[data-file-item]")
      const item = items[selectedIndex] as HTMLElement | undefined
      if (item) {
        item.scrollIntoView({ block: "nearest" })
      }
    }
  }, [selectedIndex])

  // Listen for selection event from parent (when Enter/Tab is pressed)
  useEffect(() => {
    const handleSelect = () => {
      if (results.length > 0 && selectedIndex >= 0 && selectedIndex < results.length) {
        onSelect(results[selectedIndex])
      }
    }
    document.addEventListener("at-search-select", handleSelect)
    return () => document.removeEventListener("at-search-select", handleSelect)
  }, [results, selectedIndex, onSelect])

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-ovr-text-muted">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading files...</span>
        </div>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
        <div className="px-3 py-2 text-xs text-ovr-text-muted">No matching files</div>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg"
    >
      {results.map((path, index) => (
        <button
          key={path}
          data-file-item
          onClick={() => onSelect(path)}
          onMouseEnter={() => onSelectedIndexChange(index)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
            index === selectedIndex
              ? "bg-ovr-azure-500/20 text-ovr-text-primary"
              : "text-ovr-text-secondary hover:bg-ovr-bg-panel"
          }`}
        >
          <File size={12} className="shrink-0 text-ovr-text-muted" />
          <span className="truncate">{path}</span>
        </button>
      ))}
    </div>
  )
}

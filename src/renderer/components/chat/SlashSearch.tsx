import { useEffect, useState, useRef, useCallback } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { skillsService, type Skill } from "../../services/skills"
import { fuzzyMatch } from "../../utils/fuzzyMatch"

interface SlashSearchProps {
  query: string
  workspacePath: string
  onSelect: (name: string) => void
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
}

export function SlashSearch({
  query,
  workspacePath,
  onSelect,
  selectedIndex,
  onSelectedIndexChange,
}: SlashSearchProps) {
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loading = skills === null

  // Load skills on mount
  useEffect(() => {
    let cancelled = false

    skillsService
      .listSkills(workspacePath)
      .then((result) => {
        if (!cancelled) setSkills(result)
      })
      .catch((err) => {
        console.error("Failed to list skills:", err)
        if (!cancelled) setSkills([])
      })

    return () => {
      cancelled = true
    }
  }, [workspacePath])

  // Filter and sort skills based on query (fuzzy match on name)
  const filteredSkills = useCallback(() => {
    if (!skills) return []

    if (!query.trim()) {
      return skills.slice(0, 10)
    }

    const matches: Array<{ skill: Skill; score: number }> = []
    for (const skill of skills) {
      const result = fuzzyMatch(query, skill.name)
      if (result.match) {
        matches.push({ skill, score: result.score })
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.skill.name.localeCompare(b.skill.name)
    })

    return matches.slice(0, 10).map((m) => m.skill)
  }, [skills, query])

  const results = filteredSkills()

  // Ensure selectedIndex is within bounds
  useEffect(() => {
    if (selectedIndex >= results.length) {
      onSelectedIndexChange(Math.max(0, results.length - 1))
    }
  }, [results.length, selectedIndex, onSelectedIndexChange])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[data-skill-item]")
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
        onSelect(results[selectedIndex].name)
      }
    }
    document.addEventListener("slash-search-select", handleSelect)
    return () => document.removeEventListener("slash-search-select", handleSelect)
  }, [results, selectedIndex, onSelect])

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-ovr-text-muted">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading skills...</span>
        </div>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
        <div className="px-3 py-2 text-xs text-ovr-text-muted">No matching skills</div>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-75 overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg"
    >
      {results.map((skill, index) => (
        <button
          key={skill.name}
          data-skill-item
          onClick={() => onSelect(skill.name)}
          onMouseEnter={() => onSelectedIndexChange(index)}
          className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left ${
            index === selectedIndex ? "bg-ovr-azure-500/20" : "hover:bg-ovr-bg-panel"
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="shrink-0 text-ovr-text-muted" />
            <span
              className={`text-xs ${
                index === selectedIndex ? "text-ovr-text-primary" : "text-ovr-text-secondary"
              }`}
            >
              /{skill.name}
            </span>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-ovr-text-muted">
              {skill.source}
            </span>
          </div>
          {skill.description && (
            <span className="truncate pl-5 text-[11px] text-ovr-text-muted">
              {skill.description}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

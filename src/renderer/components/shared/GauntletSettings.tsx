import { observer } from "mobx-react-lite"
import { useState } from "react"
import * as Select from "@radix-ui/react-select"
import { ChevronDown, Plus, Trash2 } from "lucide-react"
import { gauntletStore } from "../../stores/GauntletStore"
import { configStore } from "../../stores/ConfigStore"
import { getAgentDisplayName } from "../../utils/agentDisplayName"
import { ModelSelector } from "../chat/ModelSelector"
import type { AgentType, GauntletReviewer } from "../../types"
import { Input } from "./Input"
import { Textarea } from "./Textarea"
import { Checkbox } from "./Checkbox"

function AgentSelect({ value, onChange }: { value: AgentType; onChange: (v: AgentType) => void }) {
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as AgentType)}>
      <Select.Trigger className="flex items-center gap-1.5 rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-xs text-ovr-text-primary outline-none">
        <Select.Value />
        <ChevronDown size={12} className="text-ovr-text-muted" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-[200] rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
          <Select.Viewport className="p-1">
            {configStore.enabledAgents.map((agent) => (
              <Select.Item
                key={agent}
                value={agent}
                className="cursor-pointer rounded px-2 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
              >
                <Select.ItemText>{getAgentDisplayName(agent)}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

const ReviewerItem = observer(function ReviewerItem({ reviewer }: { reviewer: GauntletReviewer }) {
  const update = (updates: Partial<Omit<GauntletReviewer, "id">>) => {
    gauntletStore.updateReviewer(reviewer.id, updates)
    configStore.saveGauntletReviewers()
  }

  const handleRemove = () => {
    gauntletStore.removeReviewer(reviewer.id)
    configStore.saveGauntletReviewers()
  }

  return (
    <div className="space-y-3 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-3">
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center" title="Enabled by default in a run">
          <Checkbox
            checked={reviewer.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            data-testid={`gauntlet-reviewer-enabled-${reviewer.id}`}
          />
        </label>
        <Input
          type="text"
          value={reviewer.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Reviewer name"
          className="flex-1 text-xs"
          data-testid={`gauntlet-reviewer-name-${reviewer.id}`}
        />
        <button
          onClick={handleRemove}
          className="rounded p-1.5 text-ovr-text-dim hover:bg-ovr-bad/10 hover:text-ovr-bad"
          title="Remove reviewer"
          data-testid={`gauntlet-reviewer-remove-${reviewer.id}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <Textarea
        value={reviewer.prompt}
        onChange={(e) => update({ prompt: e.target.value })}
        placeholder="What should this reviewer focus on?"
        className="min-h-20 w-full resize-y text-xs"
        data-testid={`gauntlet-reviewer-prompt-${reviewer.id}`}
      />

      <div className="flex items-center gap-2">
        <label className="text-[11px] text-ovr-text-muted">Agent</label>
        <AgentSelect
          value={reviewer.agentType}
          onChange={(v) => update({ agentType: v, modelVersion: null })}
        />
        <label className="text-[11px] text-ovr-text-muted">Model</label>
        <ModelSelector
          value={reviewer.modelVersion}
          onChange={(m) => update({ modelVersion: m })}
          agentType={reviewer.agentType}
        />
      </div>
    </div>
  )
})

function AddReviewerForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [agentType, setAgentType] = useState<AgentType>("claude")
  const [modelVersion, setModelVersion] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    gauntletStore.addReviewer({
      name: name.trim(),
      prompt: prompt.trim(),
      agentType,
      modelVersion,
      enabled: true,
    })
    configStore.saveGauntletReviewers()
    onDone()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-dashed border-ovr-border-subtle bg-ovr-bg-elevated p-3"
    >
      <div>
        <label className="mb-1 block text-[11px] text-ovr-text-muted">Name</label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Performance Review"
          className="w-full text-xs"
          autoFocus
          data-testid="gauntlet-add-name"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-ovr-text-muted">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should this reviewer focus on?"
          className="min-h-20 w-full resize-y text-xs"
          data-testid="gauntlet-add-prompt"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-ovr-text-muted">Agent</label>
          <AgentSelect
            value={agentType}
            onChange={(v) => {
              setAgentType(v)
              setModelVersion(null)
            }}
          />
          <label className="text-[11px] text-ovr-text-muted">Model</label>
          <ModelSelector value={modelVersion} onChange={setModelVersion} agentType={agentType} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="ovr-btn-primary px-3 py-1 text-xs disabled:opacity-50"
            data-testid="gauntlet-add-submit"
          >
            Add Reviewer
          </button>
        </div>
      </div>
    </form>
  )
}

export const GauntletSettings = observer(function GauntletSettings() {
  const [showAddForm, setShowAddForm] = useState(false)

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-ovr-text-muted">
        Gauntlet Reviewers
      </label>
      <p className="mb-3 text-[11px] text-ovr-text-dim">
        Specialist agents that review a workspace during a gauntlet run. Each round runs every
        selected reviewer; the implementer must address all their findings to survive.
      </p>

      <div className="space-y-2">
        {gauntletStore.reviewers.map((reviewer) => (
          <ReviewerItem key={reviewer.id} reviewer={reviewer} />
        ))}

        {showAddForm ? (
          <AddReviewerForm onDone={() => setShowAddForm(false)} />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ovr-border-subtle py-2 text-xs text-ovr-text-dim transition-colors hover:border-ovr-azure-500 hover:text-ovr-azure-400"
            data-testid="gauntlet-add-reviewer"
          >
            <Plus className="size-3.5" />
            Add Reviewer
          </button>
        )}
      </div>
    </div>
  )
})

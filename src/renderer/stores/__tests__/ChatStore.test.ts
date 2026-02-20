import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { runInAction } from "mobx"
import type { Chat } from "../../types"
import { ChatStore, type ChatStoreContext } from "../ChatStore"

// Mock agent services via agentRegistry
const mockAgentService = {
  onEvent: vi.fn(),
  onDone: vi.fn(),
  sendMessage: vi.fn(() => Promise.resolve()),
  sendToolApproval: vi.fn(() => Promise.resolve()),
  interruptTurn: vi.fn(),
  stopChat: vi.fn(),
  removeChat: vi.fn(),
  isRunning: vi.fn(() => false),
  setSessionId: vi.fn(),
  getSessionId: vi.fn(() => null),
  attachListeners: vi.fn(() => Promise.resolve()),
}

vi.mock("../../services/agentRegistry", () => ({
  getAgentService: () => mockAgentService,
}))

// Mock ConfigStore
vi.mock("../ConfigStore", () => ({
  configStore: {
    claudePath: "claude",
    codexPath: "codex",
    claudePermissionMode: "default",
    codexApprovalPolicy: "untrusted",
    agentShell: "zsh -l -c",
    loaded: true,
  },
}))

// Mock eventBus
vi.mock("../../utils/eventBus", () => ({
  eventBus: {
    emit: vi.fn(),
  },
}))

import { eventBus } from "../../utils/eventBus"

// Helper type for test context overrides
// Allows passing Sets directly (for convenience) plus any ChatStoreContext overrides
type TestContextOverrides = Partial<ChatStoreContext>

function createTestContext(overrides?: TestContextOverrides): ChatStoreContext {
  return {
    getChatDir: overrides?.getChatDir ?? (() => Promise.resolve("/tmp/test-chats")),
    getInitPrompt: overrides?.getInitPrompt ?? (() => undefined),
    getProjectName: overrides?.getProjectName ?? (() => "test-project"),
    getWorkspaceName: overrides?.getWorkspaceName ?? (() => "test-workspace"),
    saveIndex: overrides?.saveIndex ?? vi.fn(),
    getActiveChatId: overrides?.getActiveChatId ?? (() => "test-chat-id"),
    getWorkspacePath: overrides?.getWorkspacePath ?? (() => "/tmp/test-workspace"),
    renameChat: overrides?.renameChat ?? vi.fn(),
    isWorkspaceSelected: overrides?.isWorkspaceSelected ?? (() => true),
    refreshChangedFiles: overrides?.refreshChangedFiles ?? vi.fn(),
  }
}

function createTestChat(overrides?: Partial<Chat>): Chat {
  return {
    id: "test-chat-id",
    workspaceId: "wt-1",
    label: "Test Chat",
    messages: [],
    status: "idle",
    agentType: "claude",
    agentSessionId: null,
    modelVersion: null,
    permissionMode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createChatStore(
  chatOverrides?: Partial<Chat>,
  ctxOverrides?: TestContextOverrides
): ChatStore {
  return new ChatStore(createTestChat(chatOverrides), createTestContext(ctxOverrides))
}

describe("ChatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      switch (command) {
        case "add_user_message": {
          const payload = args as { content?: string; meta?: Record<string, unknown> | null }
          return {
            kind: "userMessage",
            id: "user-1",
            content: payload?.content ?? "",
            timestamp: new Date().toISOString(),
            meta: payload?.meta ?? null,
          }
        }
        case "load_chat_events":
          return []
        case "load_chat_metadata":
          return null
        default:
          return undefined
      }
    })
  })

  it("initializes with correct defaults", () => {
    const store = createChatStore()

    expect(store.id).toBe("test-chat-id")
    expect(store.label).toBe("Test Chat")
    expect(store.messages).toEqual([])
    expect(store.isSending).toBe(false)
    expect(store.pendingToolUses).toEqual([])
    expect(store.pendingQuestions).toEqual([])
    expect(store.draft).toBe("")
    expect(store.agentType).toBe("claude")
  })

  it("draft management stores and retrieves drafts", () => {
    const store = createChatStore()

    store.setDraft("my draft text")
    expect(store.draft).toBe("my draft text")

    store.setDraft("")
    expect(store.draft).toBe("")
  })

  it("draft management persists to localStorage", () => {
    const store = createChatStore()

    store.setDraft("test draft")
    const raw = localStorage.getItem("overseer:drafts")
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed["test-chat-id"]).toBe("test draft")
  })

  it("draft loads from localStorage on construction", () => {
    localStorage.setItem("overseer:drafts", JSON.stringify({ "test-chat-id": "saved draft" }))

    const store = createChatStore()
    expect(store.draft).toBe("saved draft")
  })

  it("stopGeneration adds cancelled message and resets state", () => {
    const store = createChatStore()

    runInAction(() => {
      store.isSending = true
      store.chat.status = "running"
    })

    store.stopGeneration()

    expect(mockAgentService.interruptTurn).toHaveBeenCalledWith("test-chat-id")
    expect(store.isSending).toBe(false)
    expect(store.messages[store.messages.length - 1].content).toBe("[cancelled]")
    expect(store.status).toBe("idle")
  })

  it("sendMessage adds user message and calls agent service", async () => {
    const store = createChatStore()

    await store.sendMessage("hello agent", "/home/user/wt")

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].role).toBe("user")
    expect(store.messages[0].content).toBe("hello agent")
    expect(mockAgentService.sendMessage).toHaveBeenCalled()
  })

  it("sendMessage does nothing when already sending", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.isSending = true
    })

    await store.sendMessage("hello", "/home/user/wt")

    expect(mockAgentService.sendMessage).not.toHaveBeenCalled()
  })

  it("handleAgentEvent processes message events", () => {
    const store = createChatStore()

    const onEventCalls = mockAgentService.onEvent.mock.calls
    const eventCall = onEventCalls.find((call: unknown[]) => call[0] === "test-chat-id")
    expect(eventCall).toBeDefined()

    const eventCallback = eventCall![1]

    eventCallback({
      kind: "message",
      content: "Hello from the agent!",
    })

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toBe("Hello from the agent!")
  })

  it("handleAgentEvent captures sessionId", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({
      kind: "sessionId",
      sessionId: "session-123",
    })

    expect(store.chat.agentSessionId).toBe("session-123")
  })

  it("handleAgentEvent processes text deltas by appending", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    // First, add a base message
    eventCallback({
      kind: "message",
      content: "Start",
    })

    // Then stream a delta
    eventCallback({
      kind: "text",
      text: " more text",
    })

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toBe("Start more text")
  })

  it("handleAgentEvent processes turnComplete event", () => {
    const store = createChatStore()

    runInAction(() => {
      store.isSending = true
      store.chat.status = "running"
    })

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({ kind: "turnComplete" })

    expect(store.isSending).toBe(false)
    expect(store.status).toBe("idle")
  })

  it("handleAgentEvent calls refreshChangedFiles on turnComplete", () => {
    const refreshChangedFiles = vi.fn()
    const store = createChatStore(undefined, { refreshChangedFiles })

    runInAction(() => {
      store.isSending = true
      store.chat.status = "running"
    })

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({ kind: "turnComplete" })

    expect(refreshChangedFiles).toHaveBeenCalledTimes(1)
  })

  it("emits agent:turnComplete event with chat info on turnComplete", () => {
    const store = createChatStore()

    runInAction(() => {
      store.isSending = true
      store.chat.status = "running"
      store.chat.agentType = "claude"
      store.chat.id = "test-chat-123"
    })

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({ kind: "turnComplete" })

    expect(eventBus.emit).toHaveBeenCalledWith("agent:turnComplete", {
      agentType: "claude",
      chatId: "test-chat-123",
    })
  })

  it("handleAgentEvent processes tool approval events", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({
      kind: "toolApproval",
      id: "req-1",
      name: "Bash",
      input: { command: "git commit -m 'test'" },
      displayInput: '{"command": "git commit -m \'test\'"}',
    })

    expect(store.pendingToolUses).toHaveLength(1)
    expect(store.pendingToolUses[0].name).toBe("Bash")
  })

  it("handleAgentEvent adds non-Bash tools to pending list", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({
      kind: "toolApproval",
      id: "req-1",
      name: "Read",
      input: { path: "/tmp/file.txt" },
      displayInput: '{"path": "/tmp/file.txt"}',
    })

    // Should add to pending list (no auto-approval in frontend)
    expect(store.pendingToolUses).toHaveLength(1)
    expect(store.pendingToolUses[0].name).toBe("Read")
  })

  it("handleAgentEvent processes question events", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({
      kind: "question",
      id: "q-1",
      questions: [
        {
          question: "Which option?",
          header: "Choose",
          options: [{ label: "A", description: "Option A" }],
          multiSelect: false,
        },
      ],
      rawInput: {},
    })

    expect(store.pendingQuestions).toHaveLength(1)
    expect(store.pendingQuestions[0].questions[0].question).toBe("Which option?")
  })

  it("approveToolUse sends approval and removes from pending", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.pendingToolUses.push({
        id: "tool-1",
        name: "Bash",
        input: '{"command": "ls"}',
        rawInput: { command: "ls" },
        commandPrefixes: ["ls"],
      })
    })

    await store.approveToolUse("tool-1", true)

    expect(mockAgentService.sendToolApproval).toHaveBeenCalled()
    expect(store.pendingToolUses).toHaveLength(0)
  })

  describe("approveToolUseAll", () => {
    beforeEach(() => {
      vi.mocked(invoke).mockClear()
    })

    it("calls backend to add tool approval when scope is tool", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Read",
          input: '{"path": "/tmp/file.txt"}',
          rawInput: { path: "/tmp/file.txt" },
        })
      })

      await store.approveToolUseAll("tool-1", "tool")

      expect(invoke).toHaveBeenCalledWith("add_approval", {
        projectName: "test-project",
        toolOrPrefix: "Read",
        isPrefix: false,
      })
    })

    it("calls backend to add all command prefixes when scope is command", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Bash",
          input: '{"command": "cd /foo && pnpm install"}',
          rawInput: { command: "cd /foo && pnpm install" },
          commandPrefixes: ["cd", "pnpm install"],
        })
      })

      await store.approveToolUseAll("tool-1", "command")

      expect(invoke).toHaveBeenCalledWith("add_approval", {
        projectName: "test-project",
        toolOrPrefix: "cd",
        isPrefix: true,
      })
      expect(invoke).toHaveBeenCalledWith("add_approval", {
        projectName: "test-project",
        toolOrPrefix: "pnpm install",
        isPrefix: true,
      })
    })

    it("auto-approves other pending Bash tools when all their prefixes match", async () => {
      const store = createChatStore()

      runInAction(() => {
        // First tool with cd and pnpm install
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Bash",
          input: '{"command": "cd /foo && pnpm install"}',
          rawInput: { command: "cd /foo && pnpm install" },
          commandPrefixes: ["cd", "pnpm install"],
        })
        // Second tool with just cd (should be auto-approved after tool-1)
        store.pendingToolUses.push({
          id: "tool-2",
          name: "Bash",
          input: '{"command": "cd /bar"}',
          rawInput: { command: "cd /bar" },
          commandPrefixes: ["cd"],
        })
        // Third tool with pnpm test (should NOT be auto-approved - pnpm test != pnpm install)
        store.pendingToolUses.push({
          id: "tool-3",
          name: "Bash",
          input: '{"command": "pnpm test"}',
          rawInput: { command: "pnpm test" },
          commandPrefixes: ["pnpm test"],
        })
      })

      await store.approveToolUseAll("tool-1", "command")

      // tool-1 and tool-2 should be approved (cd is in tool-1's prefixes)
      expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
        "test-chat-id",
        "tool-1",
        true,
        { command: "cd /foo && pnpm install" }
      )
      expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
        "test-chat-id",
        "tool-2",
        true,
        { command: "cd /bar" }
      )

      // tool-3 should remain pending (pnpm test not in tool-1's prefixes)
      expect(store.pendingToolUses).toHaveLength(1)
      expect(store.pendingToolUses[0].id).toBe("tool-3")
    })

    it("does NOT auto-approve other Bash tools if only some of their prefixes match", async () => {
      const store = createChatStore()

      runInAction(() => {
        // First tool with just cd
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Bash",
          input: '{"command": "cd /foo"}',
          rawInput: { command: "cd /foo" },
          commandPrefixes: ["cd"],
        })
        // Second tool with cd AND git push (git push not in tool-1's prefixes)
        store.pendingToolUses.push({
          id: "tool-2",
          name: "Bash",
          input: '{"command": "cd /repo && git push"}',
          rawInput: { command: "cd /repo && git push" },
          commandPrefixes: ["cd", "git push"],
        })
      })

      await store.approveToolUseAll("tool-1", "command")

      // tool-1 should be approved
      expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
        "test-chat-id",
        "tool-1",
        true,
        { command: "cd /foo" }
      )

      // tool-2 should remain pending (git push not in tool-1's prefixes)
      expect(store.pendingToolUses).toHaveLength(1)
      expect(store.pendingToolUses[0].id).toBe("tool-2")
    })

    it("auto-approves other Read tools when approving Read by tool name", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Read",
          input: '{"path": "/a.txt"}',
          rawInput: { path: "/a.txt" },
        })
        store.pendingToolUses.push({
          id: "tool-2",
          name: "Read",
          input: '{"path": "/b.txt"}',
          rawInput: { path: "/b.txt" },
        })
        store.pendingToolUses.push({
          id: "tool-3",
          name: "Write",
          input: '{"path": "/c.txt"}',
          rawInput: { path: "/c.txt" },
        })
      })

      await store.approveToolUseAll("tool-1", "tool")

      // tool-1 and tool-2 (both Read) should be approved
      expect(mockAgentService.sendToolApproval).toHaveBeenCalledTimes(2)

      // tool-3 (Write) should remain pending
      expect(store.pendingToolUses).toHaveLength(1)
      expect(store.pendingToolUses[0].name).toBe("Write")
    })
  })

  describe("denyToolUseWithExplanation", () => {
    it("sends denial with explanation message to agent", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Write",
          input: '{"path": "/tmp/file.txt"}',
          rawInput: { path: "/tmp/file.txt" },
        })
      })

      await store.denyToolUseWithExplanation("tool-1", "Please use Edit instead")

      expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
        "test-chat-id",
        "tool-1",
        false,
        { path: "/tmp/file.txt" },
        "User denied this tool use and requested something different:\n\nPlease use Edit instead"
      )
      expect(store.pendingToolUses).toHaveLength(0)
    })

    it("adds user message to chat when explanation provided", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Bash",
          input: '{"command": "rm -rf /"}',
          rawInput: { command: "rm -rf /" },
        })
      })

      const initialMessageCount = store.chat.messages.length
      await store.denyToolUseWithExplanation("tool-1", "Don't delete everything")

      expect(store.chat.messages.length).toBe(initialMessageCount + 1)
      expect(store.chat.messages[store.chat.messages.length - 1]).toMatchObject({
        role: "user",
        content: "Don't delete everything",
      })
    })

    it("does not add user message when explanation is empty", async () => {
      const store = createChatStore()

      runInAction(() => {
        store.pendingToolUses.push({
          id: "tool-1",
          name: "Bash",
          input: '{"command": "ls"}',
          rawInput: { command: "ls" },
        })
      })

      const initialMessageCount = store.chat.messages.length
      await store.denyToolUseWithExplanation("tool-1", "   ")

      expect(store.chat.messages.length).toBe(initialMessageCount)
    })
  })

  it("rename updates the label and triggers persistence", () => {
    const saveIndex = vi.fn()
    const store = createChatStore(undefined, { saveIndex })

    store.rename("New Name")

    expect(store.label).toBe("New Name")
    expect(saveIndex).toHaveBeenCalled()
  })

  it("clearUnreadStatus resets status to idle when no pending items and not sending", () => {
    const store = createChatStore()

    runInAction(() => {
      store.chat.status = "done"
    })

    store.clearUnreadStatus()
    expect(store.status).toBe("idle")
  })

  it("clearUnreadStatus resets status to running when no pending items but still sending", () => {
    const store = createChatStore()

    runInAction(() => {
      store.chat.status = "needs_attention"
      store.isSending = true
    })

    store.clearUnreadStatus()
    expect(store.status).toBe("running")
  })

  it("clearUnreadStatus preserves status when pending items exist", () => {
    const store = createChatStore()

    runInAction(() => {
      store.chat.status = "needs_attention"
      store.pendingToolUses.push({
        id: "tool-1",
        name: "Bash",
        input: "{}",
        rawInput: {},
      })
    })

    store.clearUnreadStatus()
    expect(store.status).toBe("needs_attention")
  })

  // --- Status derivation tests ---

  it("status returns idle by default", () => {
    const store = createChatStore()
    expect(store.status).toBe("idle")
  })

  it("status returns running when isSending is true", () => {
    const store = createChatStore()
    runInAction(() => {
      store.isSending = true
    })
    expect(store.status).toBe("running")
  })

  it("status returns needs_attention when pendingToolUses is non-empty", () => {
    const store = createChatStore()
    runInAction(() => {
      store.pendingToolUses.push({
        id: "tool-1",
        name: "Bash",
        input: "{}",
        rawInput: {},
      })
    })
    expect(store.status).toBe("needs_attention")
  })

  it("status returns needs_attention when pendingQuestions is non-empty", () => {
    const store = createChatStore()
    runInAction(() => {
      store.pendingQuestions.push({
        id: "q-1",
        questions: [],
        rawInput: {},
      })
    })
    expect(store.status).toBe("needs_attention")
  })

  it("status returns needs_attention when pendingPlanApproval is set", () => {
    const store = createChatStore()
    runInAction(() => {
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "my plan",
        previousPlanContent: null,
      }
    })
    expect(store.status).toBe("needs_attention")
  })

  it("status returns needs_attention over running when both pending and sending", () => {
    const store = createChatStore()
    runInAction(() => {
      store.isSending = true
      store.pendingToolUses.push({
        id: "tool-1",
        name: "Bash",
        input: "{}",
        rawInput: {},
      })
    })
    expect(store.status).toBe("needs_attention")
  })

  it("status returns done when chat.status is done and not sending/pending", () => {
    const store = createChatStore()
    runInAction(() => {
      store.chat.status = "done"
    })
    expect(store.status).toBe("done")
  })

  it("status ignores persisted running status when not actually sending", () => {
    const store = createChatStore()
    runInAction(() => {
      store.chat.status = "running"
      store.isSending = false
    })
    expect(store.status).toBe("idle")
  })

  it("status ignores persisted needs_attention when no pending items", () => {
    const store = createChatStore()
    runInAction(() => {
      store.chat.status = "needs_attention"
    })
    expect(store.status).toBe("idle")
  })

  // --- End status derivation tests ---

  it("modelVersion returns null by default", () => {
    const store = createChatStore()

    expect(store.modelVersion).toBeNull()
  })

  it("modelVersion returns the chat's modelVersion", () => {
    const store = createChatStore({ modelVersion: "opus" })

    expect(store.modelVersion).toBe("opus")
  })

  it("setModelVersion updates the modelVersion", () => {
    const store = createChatStore()

    store.setModelVersion("haiku")
    expect(store.modelVersion).toBe("haiku")

    store.setModelVersion(null)
    expect(store.modelVersion).toBeNull()
  })

  it("sendMessage passes modelVersion to agent service", async () => {
    const store = createChatStore({ modelVersion: "opus" })

    await store.sendMessage("test message", "/home/user/wt")

    expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
      "test-chat-id",
      "test message",
      "/home/user/wt",
      "/tmp/test-chats",
      "opus",
      "default", // permission mode
      undefined, // initPrompt
      "test-project"
    )
  })

  it("sendMessage passes null modelVersion when not set", async () => {
    const store = createChatStore({ modelVersion: null })

    await store.sendMessage("test message", "/home/user/wt")

    expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
      "test-chat-id",
      "test message",
      "/home/user/wt",
      "/tmp/test-chats",
      null,
      "default", // permission mode
      undefined, // initPrompt
      "test-project"
    )
  })

  it("handleAgentEvent processes planApproval events with plan content", () => {
    const store = createChatStore()

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    const planContent = "# My Plan\n\n## Step 1\nDo something"
    eventCallback({
      kind: "planApproval",
      id: "plan-1",
      planContent,
    })

    expect(store.pendingPlanApproval).not.toBeNull()
    expect(store.pendingPlanApproval?.id).toBe("plan-1")
    expect(store.pendingPlanApproval?.planContent).toBe(planContent)
  })

  it("handleAgentEvent sets needs_attention status for plan approval in background chat", () => {
    const store = createChatStore(undefined, { getActiveChatId: () => "other-chat" })

    const eventCall = mockAgentService.onEvent.mock.calls.find(
      (c: unknown[]) => c[0] === "test-chat-id"
    )
    const eventCallback = eventCall![1]

    eventCallback({
      kind: "planApproval",
      id: "plan-1",
      planContent: "# Plan",
    })

    expect(store.status).toBe("needs_attention")
  })

  it("approvePlan sends approval and clears pending state", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "# My Plan",
        previousPlanContent: null,
      }
    })

    await store.approvePlan()

    expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
      "test-chat-id",
      "plan-1",
      true,
      {}
    )
    expect(store.pendingPlanApproval).toBeNull()
  })

  it("rejectPlan sends rejection with feedback and clears pending state", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "# My Plan",
        previousPlanContent: null,
      }
    })

    await store.rejectPlan("Please add more details")

    expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
      "test-chat-id",
      "plan-1",
      false,
      {},
      "User requested changes to the plan:\n\nPlease add more details"
    )
    expect(store.pendingPlanApproval).toBeNull()
    // Feedback should be added as a user message
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toBe("Please add more details")
    expect(store.messages[0].role).toBe("user")
  })

  it("rejectPlan with empty feedback does not add user message", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "# My Plan",
        previousPlanContent: null,
      }
    })

    await store.rejectPlan("")

    expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
      "test-chat-id",
      "plan-1",
      false,
      {},
      "User rejected the plan"
    )
    expect(store.pendingPlanApproval).toBeNull()
    expect(store.messages).toHaveLength(0)
  })

  it("clearUnreadStatus preserves status when plan approval is pending", () => {
    const store = createChatStore()

    runInAction(() => {
      store.chat.status = "needs_attention"
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "# My Plan",
        previousPlanContent: null,
      }
    })

    store.clearUnreadStatus()
    expect(store.status).toBe("needs_attention")
  })

  it("denyPlan sends denial and resets agent state", async () => {
    const store = createChatStore()

    runInAction(() => {
      store.pendingPlanApproval = {
        id: "plan-1",
        planContent: "# My Plan",
        previousPlanContent: null,
      }
      store.isSending = true
      store.chat.status = "running"
    })

    await store.denyPlan()

    expect(mockAgentService.sendToolApproval).toHaveBeenCalledWith(
      "test-chat-id",
      "plan-1",
      false,
      {},
      "User denied the plan. Do not proceed with this plan."
    )
    expect(store.pendingPlanApproval).toBeNull()
    expect(store.isSending).toBe(false)
    expect(store.status).toBe("idle")
  })

  it("denyPlan does nothing when no plan is pending", async () => {
    const store = createChatStore()

    await store.denyPlan()

    expect(mockAgentService.sendToolApproval).not.toHaveBeenCalled()
  })

  describe("follow-up queuing", () => {
    it("initializes with empty pendingFollowUps", () => {
      const store = createChatStore()

      expect(store.pendingFollowUps).toEqual([])
    })

    it("queues follow-up when sending message while isSending is true", async () => {
      const store = createChatStore()

      // First message - sets isSending to true
      await store.sendMessage("first message", "/home/user/wt")
      expect(store.isSending).toBe(true)

      // Second message should be queued
      await store.sendMessage("follow-up message", "/home/user/wt")

      expect(store.pendingFollowUps).toEqual(["follow-up message"])
      // Should NOT call agent service again
      expect(mockAgentService.sendMessage).toHaveBeenCalledTimes(1)
    })

    it("allows multiple follow-ups to be queued", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")

      await store.sendMessage("follow-up 1", "/home/user/wt")
      await store.sendMessage("follow-up 2", "/home/user/wt")
      await store.sendMessage("follow-up 3", "/home/user/wt")

      expect(store.pendingFollowUps).toEqual(["follow-up 1", "follow-up 2", "follow-up 3"])
      expect(mockAgentService.sendMessage).toHaveBeenCalledTimes(1)
    })

    it("clears draft when queuing follow-up", async () => {
      const store = createChatStore()

      store.setDraft("my follow-up")
      await store.sendMessage("first message", "/home/user/wt")

      store.setDraft("queued message")
      await store.sendMessage("queued message", "/home/user/wt")

      expect(store.draft).toBe("")
    })

    it("clearPendingFollowUps clears all queued follow-ups", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up 1", "/home/user/wt")
      await store.sendMessage("follow-up 2", "/home/user/wt")

      store.clearPendingFollowUps()

      expect(store.pendingFollowUps).toEqual([])
    })

    it("removeFollowUp removes a single follow-up by index", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up 1", "/home/user/wt")
      await store.sendMessage("follow-up 2", "/home/user/wt")
      await store.sendMessage("follow-up 3", "/home/user/wt")

      expect(store.pendingFollowUps).toEqual(["follow-up 1", "follow-up 2", "follow-up 3"])

      store.removeFollowUp(1)

      expect(store.pendingFollowUps).toEqual(["follow-up 1", "follow-up 3"])
    })

    it("removeFollowUp does nothing for out-of-bounds index", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up 1", "/home/user/wt")

      store.removeFollowUp(5)
      store.removeFollowUp(-1)

      expect(store.pendingFollowUps).toEqual(["follow-up 1"])
    })

    it("stopGeneration clears pending follow-ups", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up", "/home/user/wt")

      store.stopGeneration()

      expect(store.pendingFollowUps).toEqual([])
    })

    it("sends combined follow-ups when turnComplete event is received", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up 1", "/home/user/wt")
      await store.sendMessage("follow-up 2", "/home/user/wt")

      expect(store.pendingFollowUps).toHaveLength(2)

      // Trigger turnComplete event
      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]
      eventCallback({ kind: "turnComplete" })

      // Follow-ups should be cleared immediately
      expect(store.pendingFollowUps).toEqual([])

      // Wait for the async sendMessage to complete
      await vi.waitFor(() => {
        expect(mockAgentService.sendMessage).toHaveBeenCalledTimes(2)
      })

      expect(mockAgentService.sendMessage).toHaveBeenLastCalledWith(
        "test-chat-id",
        "follow-up 1\n\nfollow-up 2",
        "/tmp/test-workspace",
        "/tmp/test-chats",
        null,
        "default",
        undefined,
        "test-project"
      )
    })

    it("does not send follow-up when pendingFollowUps is empty on turnComplete", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")

      // Trigger turnComplete without any queued follow-ups
      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]
      eventCallback({ kind: "turnComplete" })

      // Should only have the original call
      expect(mockAgentService.sendMessage).toHaveBeenCalledTimes(1)
    })

    it("clears pending follow-ups when onDone is called (process exits)", async () => {
      const store = createChatStore()

      await store.sendMessage("first message", "/home/user/wt")
      await store.sendMessage("follow-up 1", "/home/user/wt")

      expect(store.pendingFollowUps).toHaveLength(1)

      // Trigger onDone callback (process exit)
      const onDoneCall = mockAgentService.onDone.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const onDoneCallback = onDoneCall![1]
      onDoneCallback()

      // Follow-ups should be cleared (but not sent since process exited)
      expect(store.pendingFollowUps).toEqual([])
      // Only the original message was sent, not the follow-up
      expect(mockAgentService.sendMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe("overseer actions", () => {
    it("extracts and executes overseer actions from message events", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      eventCallback({
        kind: "message",
        content: `Here's my response.

\`\`\`overseer
{"action": "rename_chat", "params": {"title": "New Chat Title"}}
\`\`\`

More text here.`,
      })

      // Action should be executed
      expect(renameChatMock).toHaveBeenCalledWith("test-chat-id", "New Chat Title")

      // Message should be stored without the overseer block
      expect(store.messages).toHaveLength(1)
      expect(store.messages[0].content).toBe("Here's my response.\n\nMore text here.")
    })

    it("handles multiple overseer actions in a single message", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, {
        renameChat: renameChatMock,
      })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      eventCallback({
        kind: "message",
        content: `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "My Task"}}
\`\`\`

Done with the task!

\`\`\`overseer
{"action": "open_pr", "params": {"title": "Complete task"}}
\`\`\``,
      })

      // rename_chat is executed directly
      expect(renameChatMock).toHaveBeenCalledWith("test-chat-id", "My Task")

      // open_pr emits via eventBus
      expect(eventBus.emit).toHaveBeenCalledWith("overseer:open_pr", {
        title: "Complete task",
        body: undefined,
      })

      // Message should only contain the text between
      expect(store.messages).toHaveLength(1)
      expect(store.messages[0].content).toBe("Done with the task!")
    })

    it("does not add empty message when content is only an overseer block", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      eventCallback({
        kind: "message",
        content: `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Silent Action"}}
\`\`\``,
      })

      // Action should be executed
      expect(renameChatMock).toHaveBeenCalledWith("test-chat-id", "Silent Action")

      // No message should be added since content is empty after extraction
      expect(store.messages).toHaveLength(0)
    })

    it("passes message through unchanged when no overseer blocks", () => {
      const store = createChatStore()

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      eventCallback({
        kind: "message",
        content: "Regular message without any actions.",
      })

      expect(store.messages).toHaveLength(1)
      expect(store.messages[0].content).toBe("Regular message without any actions.")
    })

    it("ignores invalid overseer blocks", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      eventCallback({
        kind: "message",
        content: `Here's my response.

\`\`\`overseer
{invalid json}
\`\`\`

More text.`,
      })

      // No action should be executed for invalid JSON
      expect(renameChatMock).not.toHaveBeenCalled()

      // Message should be stored as-is since no valid actions were found
      expect(store.messages).toHaveLength(1)
      expect(store.messages[0].content).toContain("{invalid json}")
    })

    it("processes overseer blocks from delta-streamed messages on turnComplete", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      // Simulate delta streaming: first add a partial message
      eventCallback({
        kind: "message",
        content: "Starting response",
        delta: true,
      })

      // Then stream more content with an overseer block
      eventCallback({
        kind: "text",
        text: `

\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Delta Streamed Title"}}
\`\`\`

Final text.`,
      })

      // At this point, the action should NOT have been executed yet
      // (because the complete message wasn't processed for overseer blocks during delta)
      expect(renameChatMock).not.toHaveBeenCalled()

      // Now trigger turnComplete
      runInAction(() => {
        store.isSending = true
        store.chat.status = "running"
      })
      eventCallback({ kind: "turnComplete" })

      // Now the action should be executed
      expect(renameChatMock).toHaveBeenCalledWith("test-chat-id", "Delta Streamed Title")

      // Message content should be cleaned
      expect(store.messages[0].content).toBe("Starting response\n\nFinal text.")
    })

    it("does not process overseer blocks from tool messages on turnComplete", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      // Manually add a tool message with an overseer block (shouldn't happen, but testing the guard)
      runInAction(() => {
        store.chat.messages.push({
          id: "msg-1",
          role: "assistant",
          content: `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Tool Message Title"}}
\`\`\``,
          timestamp: new Date(),
          toolMeta: { toolName: "Bash" },
        })
      })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      runInAction(() => {
        store.isSending = true
        store.chat.status = "running"
      })
      eventCallback({ kind: "turnComplete" })

      // Should NOT process overseer blocks from tool messages
      expect(renameChatMock).not.toHaveBeenCalled()
    })

    it("does not process overseer blocks from bash output messages on turnComplete", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      // Manually add a bash output message with an overseer block
      runInAction(() => {
        store.chat.messages.push({
          id: "msg-1",
          role: "assistant",
          content: `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Bash Output Title"}}
\`\`\``,
          timestamp: new Date(),
          isBashOutput: true,
        })
      })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      runInAction(() => {
        store.isSending = true
        store.chat.status = "running"
      })
      eventCallback({ kind: "turnComplete" })

      // Should NOT process overseer blocks from bash output messages
      expect(renameChatMock).not.toHaveBeenCalled()
    })

    it("only checks recent messages (last 5) on turnComplete", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      // Add 6 old messages, one with an overseer block
      runInAction(() => {
        for (let i = 0; i < 6; i++) {
          store.chat.messages.push({
            id: `msg-${i}`,
            role: "assistant",
            content:
              i === 0
                ? `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Old Title ${i}"}}
\`\`\``
                : `Regular message ${i}`,
            timestamp: new Date(),
          })
        }
      })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      runInAction(() => {
        store.isSending = true
        store.chat.status = "running"
      })
      eventCallback({ kind: "turnComplete" })

      // Should NOT process the overseer block from the oldest message (index 0)
      // because it's outside the last 5 messages window
      expect(renameChatMock).not.toHaveBeenCalled()
    })

    it("processes overseer blocks from user messages are ignored on turnComplete", () => {
      const renameChatMock = vi.fn()
      const store = createChatStore(undefined, { renameChat: renameChatMock })

      // Add a user message with an overseer block (shouldn't be processed)
      runInAction(() => {
        store.chat.messages.push({
          id: "msg-1",
          role: "user",
          content: `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "User Message Title"}}
\`\`\``,
          timestamp: new Date(),
        })
      })

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      runInAction(() => {
        store.isSending = true
        store.chat.status = "running"
      })
      eventCallback({ kind: "turnComplete" })

      // Should NOT process overseer blocks from user messages
      expect(renameChatMock).not.toHaveBeenCalled()
    })
  })

  describe("seq tracking and reconnection", () => {
    it("lastSeenSeq starts at 0 and seenSeqs is empty", () => {
      const store = createChatStore()
      const lastSeenSeq = (store as unknown as { lastSeenSeq: number }).lastSeenSeq
      const seenSeqs = (store as unknown as { seenSeqs: Set<number> }).seenSeqs
      expect(lastSeenSeq).toBe(0)
      expect(seenSeqs.size).toBe(0)
    })

    it("seenSeqs and lastSeenSeq update with wrapped events", () => {
      const store = createChatStore()

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      // Send seq events with flattened format (seq alongside event fields)
      eventCallback({ seq: 1, kind: "message", content: "Hello" })
      eventCallback({ seq: 2, kind: "text", text: " world" })
      eventCallback({ seq: 3, kind: "turnComplete" })

      const lastSeenSeq = (store as unknown as { lastSeenSeq: number }).lastSeenSeq
      const seenSeqs = (store as unknown as { seenSeqs: Set<number> }).seenSeqs
      expect(lastSeenSeq).toBe(3)
      expect(seenSeqs.size).toBe(3)
      expect(seenSeqs.has(1)).toBe(true)
      expect(seenSeqs.has(2)).toBe(true)
      expect(seenSeqs.has(3)).toBe(true)
    })

    it("lastSeenSeq is set correctly after loadFromDisk", async () => {
      // Mock load_chat_events_with_seq to return events with seq numbers
      vi.mocked(invoke).mockImplementation(async (command) => {
        switch (command) {
          case "load_chat_events_with_seq":
            return [
              {
                seq: 1,
                kind: "userMessage",
                id: "u1",
                content: "hi",
                timestamp: new Date().toISOString(),
              },
              { seq: 2, kind: "message", content: "hello" },
              { seq: 3, kind: "turnComplete" },
            ]
          case "load_chat_metadata":
            return null
          default:
            return undefined
        }
      })

      const store = createChatStore()
      await store.ensureLoaded()

      const lastSeenSeq = (store as unknown as { lastSeenSeq: number }).lastSeenSeq
      const seenSeqs = (store as unknown as { seenSeqs: Set<number> }).seenSeqs
      expect(lastSeenSeq).toBe(3)
      expect(seenSeqs.size).toBe(3)
    })

    it("duplicate events are skipped based on seenSeqs", () => {
      const store = createChatStore()

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      // Send event with seq 1 (flattened format)
      eventCallback({ seq: 1, kind: "message", content: "Hello" })

      // Send same seq again (duplicate) - should be skipped
      eventCallback({ seq: 1, kind: "message", content: "Hello duplicate" })

      const seenSeqs = (store as unknown as { seenSeqs: Set<number> }).seenSeqs
      expect(seenSeqs.size).toBe(1)

      // Only one message should be in the store
      expect(store.messages.length).toBe(1)
      expect(store.messages[0].content).toBe("Hello")
    })

    it("skips userMessage event when meta.type is 'system'", () => {
      const store = createChatStore()

      const eventCall = mockAgentService.onEvent.mock.calls.find(
        (c: unknown[]) => c[0] === "test-chat-id"
      )
      const eventCallback = eventCall![1]

      // First, simulate the user sending a message (persisted by frontend)
      eventCallback({
        seq: 1,
        kind: "userMessage",
        id: "msg-1",
        content: "Add a logout button",
        timestamp: new Date().toISOString(),
      })

      expect(store.messages.length).toBe(1)
      expect(store.messages[0].content).toBe("Add a logout button")

      // Now simulate the backend sending a userMessage event marked as system
      // This is the combined initPrompt + userMessage that the agent receives
      eventCallback({
        seq: 2,
        kind: "userMessage",
        id: "msg-2",
        content: "This is a React project.\n\nAdd a logout button",
        timestamp: new Date().toISOString(),
        meta: { type: "system", label: "System" },
      })

      // The system message should be skipped
      expect(store.messages.length).toBe(1)
      expect(store.messages[0].content).toBe("Add a logout button")
    })

    it("dispose calls unsubscribeReconnect", () => {
      const store = createChatStore()

      // Manually set unsubscribeReconnect to a mock
      const unsubscribeMock = vi.fn()
      ;(store as unknown as { unsubscribeReconnect: () => void }).unsubscribeReconnect =
        unsubscribeMock

      store.dispose()

      expect(unsubscribeMock).toHaveBeenCalled()
    })
  })

  describe("permissionMode", () => {
    it("permissionMode computed getter returns correct value", () => {
      const store = createChatStore({ permissionMode: "acceptEdits" })
      expect(store.permissionMode).toBe("acceptEdits")
    })

    it("setPermissionMode updates chat.permissionMode", () => {
      const store = createChatStore()

      store.setPermissionMode("bypassPermissions")
      expect(store.permissionMode).toBe("bypassPermissions")

      store.setPermissionMode(null)
      expect(store.permissionMode).toBeNull()
    })

    it("sendMessage uses chat's permissionMode when set", async () => {
      const store = createChatStore({ permissionMode: "acceptEdits" })

      await store.sendMessage("test message", "/home/user/wt")

      expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
        "test-chat-id",
        "test message",
        "/home/user/wt",
        "/tmp/test-chats",
        null, // modelVersion
        "acceptEdits", // permission mode from chat
        undefined, // initPrompt
        "test-project"
      )
    })

    it("sendMessage falls back to configStore.claudePermissionMode when chat's permissionMode is null", async () => {
      const store = createChatStore({ permissionMode: null })

      await store.sendMessage("test message", "/home/user/wt")

      expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
        "test-chat-id",
        "test message",
        "/home/user/wt",
        "/tmp/test-chats",
        null, // modelVersion
        "default", // fallback to configStore.claudePermissionMode which is mocked as "default"
        undefined, // initPrompt
        "test-project"
      )
    })

    it("adds shell instructions to initPrompt for Codex on first message when agentShell is configured", async () => {
      const store = createChatStore(
        { agentType: "codex" },
        { getInitPrompt: () => "Custom init prompt" }
      )

      await store.sendMessage("first message", "/home/user/wt")

      expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
        "test-chat-id",
        "first message",
        "/home/user/wt",
        "/tmp/test-chats",
        null,
        "untrusted",
        expect.stringContaining("Custom init prompt"),
        "test-project"
      )

      // Verify the shell instruction is included
      const calls = vi.mocked(mockAgentService.sendMessage).mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      const initPrompt = calls[0][6] as string | undefined
      expect(initPrompt).toContain("IMPORTANT: All bash commands are already running in zsh -l -c")
      expect(initPrompt).toContain('Do NOT wrap commands with "zsh -l -c"')
    })

    it("does not add shell instructions for non-Codex agents", async () => {
      const store = createChatStore(
        { agentType: "claude" },
        { getInitPrompt: () => "Custom init prompt" }
      )

      await store.sendMessage("first message", "/home/user/wt")

      const calls = vi.mocked(mockAgentService.sendMessage).mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      const initPrompt = calls[0][6] as string | undefined
      expect(initPrompt).toBe("Custom init prompt")
      expect(initPrompt).not.toContain("All bash commands are already running")
    })

    it("does not add shell instructions on subsequent messages", async () => {
      const store = createChatStore(
        {
          agentType: "codex",
          messages: [{ id: "1", role: "user", content: "first", timestamp: new Date() }],
        },
        { getInitPrompt: () => "Custom init prompt" }
      )

      await store.sendMessage("second message", "/home/user/wt")

      const calls = vi.mocked(mockAgentService.sendMessage).mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      const initPrompt = calls[0][6] as string | undefined
      expect(initPrompt).toBeUndefined()
    })

    it("adds generic shell instructions when agentShell is not configured", async () => {
      // Mock ConfigStore with empty agentShell
      const { configStore } = await import("../ConfigStore")
      const originalShell = configStore.agentShell
      configStore.agentShell = ""

      const store = createChatStore(
        { agentType: "codex" },
        { getInitPrompt: () => "Custom init prompt" }
      )

      await store.sendMessage("first message", "/home/user/wt")

      const calls = vi.mocked(mockAgentService.sendMessage).mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      const initPrompt = calls[0][6] as string | undefined
      expect(initPrompt).toContain("Custom init prompt")
      expect(initPrompt).toContain("All bash commands are already running in a login shell")
      expect(initPrompt).toContain("determined by $SHELL environment variable")

      // Restore original value
      configStore.agentShell = originalShell
    })
  })
})

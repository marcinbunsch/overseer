/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { toolAvailabilityStore } from "../../../stores/ToolAvailabilityStore"
import { projectRegistry } from "../../../stores/ProjectRegistry"

// Mock the stores and services
vi.mock("../../../stores/SessionStore", () => ({
  sessionStore: {
    currentChats: [],
    isSending: false,
  },
}))

// Create a mock ChangedFilesStore
const mockChangedFilesStore = {
  files: [{ path: "test.ts", status: "M" }],
  uncommitted: [],
  isDefaultBranch: false,
  loading: false,
  error: null,
  checking: false,
  merging: false,
  showMergeConfirm: false,
  diffFile: null,
  prStatus: null,
  prLoading: false,
  totalFileCount: 1,
  allFiles: [{ path: "test.ts", status: "M" }],
  activate: vi.fn(),
  deactivate: vi.fn(),
  dispose: vi.fn(),
  onRunningCountChange: vi.fn(),
  refresh: vi.fn(),
  setDiffFile: vi.fn(),
  createPR: vi.fn(),
  checkMerge: vi.fn(),
  setShowMergeConfirm: vi.fn(),
  merge: vi.fn(),
}

// Mock the workspace store
const mockWorkspaceStore = {
  runningCount: 0,
  isSending: false,
  getChangedFilesStore: vi.fn(() => mockChangedFilesStore),
}

vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspaceStore: null,
    selectedWorkspace: { id: "test-id", path: "/test" },
    selectedProject: { isGitRepo: true },
  },
}))

vi.mock("../../../stores/ToolAvailabilityStore", () => ({
  toolAvailabilityStore: {
    gh: null,
    ensureGh: vi.fn().mockResolvedValue({ available: true, lastChecked: Date.now() }),
  },
}))

// Import after mocks
import { ChangedFilesPane } from "../ChangedFilesPane"

describe("ChangedFilesPane PR section visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset gh status before each test
    toolAvailabilityStore.gh = null
    // Set up the mock workspace store - use unknown cast to bypass strict type checking
    ;(
      projectRegistry as unknown as { selectedWorkspaceStore: typeof mockWorkspaceStore | null }
    ).selectedWorkspaceStore = mockWorkspaceStore
  })

  afterEach(() => {
    toolAvailabilityStore.gh = null
    ;(
      projectRegistry as unknown as { selectedWorkspaceStore: typeof mockWorkspaceStore | null }
    ).selectedWorkspaceStore = null
  })

  it("shows Create PR button when gh status is null (not checked yet)", () => {
    toolAvailabilityStore.gh = null

    render(<ChangedFilesPane workspacePath="/test" />)

    expect(screen.getByTitle("Create a pull request")).toBeInTheDocument()
  })

  it("shows Create PR button when gh is available", () => {
    toolAvailabilityStore.gh = {
      available: true,
      version: "gh 2.0.0",
      lastChecked: Date.now(),
    }

    render(<ChangedFilesPane workspacePath="/test" />)

    expect(screen.getByTitle("Create a pull request")).toBeInTheDocument()
  })

  it("hides Create PR button when gh is not available", () => {
    toolAvailabilityStore.gh = {
      available: false,
      error: "command not found",
      lastChecked: Date.now(),
    }

    render(<ChangedFilesPane workspacePath="/test" />)

    expect(screen.queryByTitle("Create a pull request")).not.toBeInTheDocument()
  })

  it("calls ensureGh on mount", () => {
    render(<ChangedFilesPane workspacePath="/test" />)

    expect(toolAvailabilityStore.ensureGh).toHaveBeenCalled()
  })
})

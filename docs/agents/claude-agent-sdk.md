# Claude Agent SDK

Build production AI agents with Claude Code as a library. The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript.

> Source: https://platform.claude.com/docs/en/agent-sdk/overview

## Quick Start

### Installation

```bash
# Install Claude Code runtime
curl -fsSL https://claude.ai/install.sh | bash

# Install SDK
npm install @anthropic-ai/claude-agent-sdk   # TypeScript
pip install claude-agent-sdk                  # Python
```

### Authentication

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Also supports:
- **Amazon Bedrock**: `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials
- **Google Vertex AI**: `CLAUDE_CODE_USE_VERTEX=1` + GCP credentials
- **Microsoft Foundry**: `CLAUDE_CODE_USE_FOUNDRY=1` + Azure credentials

### Minimal Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: { allowedTools: ["Read", "Edit", "Bash"] }
})) {
  console.log(message);
}
```

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    async for message in query(
        prompt="Find and fix the bug in auth.py",
        options=ClaudeAgentOptions(allowed_tools=["Read", "Edit", "Bash"])
    ):
        print(message)

asyncio.run(main())
```

## Built-in Tools

| Tool | What it does |
|------|-------------|
| **Read** | Read any file in the working directory |
| **Write** | Create new files |
| **Edit** | Make precise edits to existing files |
| **Bash** | Run terminal commands, scripts, git operations |
| **Glob** | Find files by pattern (`**/*.ts`, `src/**/*.py`) |
| **Grep** | Search file contents with regex |
| **WebSearch** | Search the web for current information |
| **WebFetch** | Fetch and parse web page content |
| **AskUserQuestion** | Ask the user clarifying questions with multiple choice options |
| **Task** | Spawn subagents for focused subtasks |
| **TodoWrite** | Create and manage structured task lists |
| **NotebookEdit** | Edit Jupyter notebook cells |

## Permission Modes

| Mode | Description | Tool behavior |
|------|-------------|---------------|
| `default` | Standard permission behavior | Unmatched tools trigger `canUseTool` callback |
| `acceptEdits` | Auto-accept file edits | File edits and filesystem ops auto-approved |
| `bypassPermissions` | Bypass all permission checks | All tools run without prompts (use with caution) |
| `plan` | Planning mode | No tool execution; Claude plans without making changes |

```typescript
for await (const message of query({
  prompt: "Review this code for best practices",
  options: {
    allowedTools: ["Read", "Glob", "Grep"],
    permissionMode: "bypassPermissions"
  }
})) { /* ... */ }
```

## Sessions

Sessions allow maintaining context across multiple interactions. Capture the session ID from the first query, then resume later with full context.

```typescript
let sessionId: string | undefined;

// First query
for await (const message of query({
  prompt: "Read the authentication module",
  options: { allowedTools: ["Read", "Glob"] }
})) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
}

// Resume with full context
for await (const message of query({
  prompt: "Now find all places that call it",
  options: { resume: sessionId }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Forking Sessions

Fork a session to explore different approaches without modifying the original:

```typescript
const forkedResponse = query({
  prompt: "Now let's redesign this as a GraphQL API instead",
  options: {
    resume: sessionId,
    forkSession: true  // Creates a new session ID, preserves original
  }
});
```

## Hooks

Hooks intercept agent execution at key points for validation, logging, security, or custom logic.

### Available Hooks

| Hook Event | Python | TypeScript | Trigger |
|------------|--------|------------|---------|
| `PreToolUse` | Yes | Yes | Before tool executes (can block/modify) |
| `PostToolUse` | Yes | Yes | After tool execution result |
| `PostToolUseFailure` | No | Yes | After tool execution failure |
| `UserPromptSubmit` | Yes | Yes | User prompt submission |
| `Stop` | Yes | Yes | Agent execution stop |
| `SubagentStart` | No | Yes | Subagent initialization |
| `SubagentStop` | Yes | Yes | Subagent completion |
| `PreCompact` | Yes | Yes | Conversation compaction request |
| `PermissionRequest` | No | Yes | Permission dialog would be displayed |
| `SessionStart` | No | Yes | Session initialization |
| `SessionEnd` | No | Yes | Session termination |
| `Notification` | No | Yes | Agent status messages |

### Hook Example: Block Dangerous Operations

```typescript
import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  const filePath = preInput.tool_input?.file_path as string;
  const fileName = filePath?.split("/").pop();

  if (fileName === ".env") {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: "Cannot modify .env files",
      },
    };
  }
  return {};
};

for await (const message of query({
  prompt: "Update the database configuration",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Write|Edit", hooks: [protectEnvFiles] }],
    },
  },
})) {
  console.log(message);
}
```

### Hook Callback Outputs

- **`permissionDecision`**: `'allow'` | `'deny'` | `'ask'` — control whether the tool executes
- **`updatedInput`**: modify tool input before execution (requires `permissionDecision: 'allow'`)
- **`systemMessage`**: inject context into the conversation
- **`continue`**: `false` to stop the agent
- **`additionalContext`**: add context to the conversation

### Permission Decision Flow

1. **Deny** rules checked first (any match = immediate denial)
2. **Ask** rules checked second
3. **Allow** rules checked third
4. **Default to Ask** if nothing matches

## Subagents

Subagents are separate agent instances for focused subtasks. They provide context isolation, parallelization, specialized instructions, and tool restrictions.

```typescript
for await (const message of query({
  prompt: "Review the authentication module for security issues",
  options: {
    allowedTools: ["Read", "Grep", "Glob", "Task"],
    agents: {
      "code-reviewer": {
        description:
          "Expert code review specialist. Use for quality, security, and maintainability reviews.",
        prompt: `You are a code review specialist with expertise in security, performance, and best practices.`,
        tools: ["Read", "Grep", "Glob"], // Read-only access
        model: "sonnet",
      },
      "test-runner": {
        description:
          "Runs and analyzes test suites. Use for test execution and coverage analysis.",
        prompt: `You are a test execution specialist.`,
        tools: ["Bash", "Read", "Grep"],
      },
    },
  },
})) {
  if ("result" in message) console.log(message.result);
}
```

### AgentDefinition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | `string` | Yes | When to use this agent (Claude reads this to decide) |
| `prompt` | `string` | Yes | System prompt defining role and behavior |
| `tools` | `string[]` | No | Allowed tool names. Omit to inherit all |
| `model` | `'sonnet' \| 'opus' \| 'haiku' \| 'inherit'` | No | Model override |

Subagents cannot spawn their own subagents (don't include `Task` in a subagent's tools).

## MCP (Model Context Protocol)

Connect agents to external systems via MCP: databases, browsers, APIs, etc.

```typescript
for await (const message of query({
  prompt: "List the 3 most recent issues in anthropics/claude-code",
  options: {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
      },
    },
    allowedTools: ["mcp__github__list_issues"],
  },
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

### Transport Types

- **stdio**: Local processes communicating via stdin/stdout
- **HTTP/SSE**: Cloud-hosted MCP servers and remote APIs
- **SDK MCP servers**: Custom tools defined in-process (see Custom Tools)

### Tool Naming Convention

MCP tools follow the pattern `mcp__<server-name>__<tool-name>`. Use wildcards for blanket access: `mcp__github__*`.

### MCP Tool Search

When many MCP tools are configured, tool search dynamically loads tools on-demand. Controlled via `ENABLE_TOOL_SEARCH` env var: `auto` (default), `auto:5` (5% threshold), `true`, `false`.

## Custom Tools

Define in-process MCP tools using `createSdkMcpServer` and `tool`:

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const customServer = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool(
      "get_weather",
      "Get current temperature for a location",
      {
        latitude: z.number().describe("Latitude"),
        longitude: z.number().describe("Longitude"),
      },
      async (args) => {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`
        );
        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: `Temperature: ${data.current.temperature_2m}°C`,
            },
          ],
        };
      }
    ),
  ],
});

// Use with streaming input (required for custom MCP tools)
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "What's the weather in San Francisco?",
    },
  };
}

for await (const message of query({
  prompt: generateMessages(),
  options: {
    mcpServers: { "my-tools": customServer },
    allowedTools: ["mcp__my-tools__get_weather"],
  },
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

## User Input & Approvals

### canUseTool Callback

Handle tool approval requests and clarifying questions:

```typescript
for await (const message of query({
  prompt: "Create a test file and then delete it",
  options: {
    canUseTool: async (toolName, input) => {
      if (toolName === "AskUserQuestion") {
        // Handle Claude's clarifying questions
        return handleClarifyingQuestions(input);
      }

      // Handle tool approval
      console.log(`Tool: ${toolName}, Input: ${JSON.stringify(input)}`);
      const approved = await askUser("Allow? (y/n)");

      if (approved) {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: "User denied this action" };
    },
  },
})) {
  if ("result" in message) console.log(message.result);
}
```

### Response Types

- **Allow**: `{ behavior: 'allow', updatedInput: input }`
- **Allow with changes**: `{ behavior: 'allow', updatedInput: { ...input, file_path: '/sandbox' + input.file_path } }`
- **Deny**: `{ behavior: 'deny', message: 'Reason for denial' }`

## Streaming vs Single Message Input

### Streaming Input (Recommended)

Persistent, interactive session with full feature support (image uploads, queued messages, hooks, interrupts):

```typescript
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: { role: "user" as const, content: "Analyze this codebase" },
  };

  await new Promise((resolve) => setTimeout(resolve, 2000));

  yield {
    type: "user" as const,
    message: { role: "user" as const, content: "Now focus on security" },
  };
}

for await (const message of query({
  prompt: generateMessages(),
  options: { maxTurns: 10, allowedTools: ["Read", "Grep"] },
})) {
  if (message.type === "result") console.log(message.result);
}
```

### Single Message Input

Simple one-shot queries for stateless environments (lambdas, CI jobs):

```typescript
for await (const message of query({
  prompt: "Explain the authentication flow",
  options: { maxTurns: 1, allowedTools: ["Read", "Grep"] },
})) {
  if (message.type === "result") console.log(message.result);
}
```

## Configuration Options (TypeScript)

Key `Options` fields for `query()`:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `allowedTools` | `string[]` | All tools | Tools Claude can use |
| `disallowedTools` | `string[]` | `[]` | Blocked tool names |
| `permissionMode` | `PermissionMode` | `'default'` | Permission mode |
| `systemPrompt` | `string \| preset` | minimal | System prompt or `claude_code` preset |
| `model` | `string` | CLI default | Claude model to use |
| `maxTurns` | `number` | unlimited | Maximum conversation turns |
| `maxBudgetUsd` | `number` | unlimited | Maximum budget in USD |
| `cwd` | `string` | `process.cwd()` | Working directory |
| `resume` | `string` | — | Session ID to resume |
| `forkSession` | `boolean` | `false` | Fork instead of continue when resuming |
| `mcpServers` | `Record<string, config>` | `{}` | MCP server configs |
| `hooks` | `Record<HookEvent, matcher[]>` | `{}` | Hook callbacks |
| `agents` | `Record<string, AgentDefinition>` | — | Subagent definitions |
| `canUseTool` | `function` | — | Custom permission callback |
| `settingSources` | `SettingSource[]` | `[]` | Filesystem settings to load (`'user'`, `'project'`, `'local'`) |
| `plugins` | `SdkPluginConfig[]` | `[]` | Custom plugins |
| `sandbox` | `SandboxSettings` | — | Command execution sandbox config |
| `betas` | `SdkBeta[]` | `[]` | Beta features (e.g., `'context-1m-2025-08-07'`) |
| `includePartialMessages` | `boolean` | `false` | Stream partial message events |
| `enableFileCheckpointing` | `boolean` | `false` | Enable file change tracking for rewinding |
| `outputFormat` | `{ type, schema }` | — | Structured output validation |

## Configuration Options (Python)

Key `ClaudeAgentOptions` fields:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `allowed_tools` | `list[str]` | `[]` | Tools Claude can use |
| `disallowed_tools` | `list[str]` | `[]` | Blocked tool names |
| `permission_mode` | `PermissionMode` | `None` | Permission mode |
| `system_prompt` | `str \| preset` | `None` | System prompt or preset |
| `model` | `str` | `None` | Claude model to use |
| `max_turns` | `int` | `None` | Maximum conversation turns |
| `max_budget_usd` | `float` | `None` | Maximum budget in USD |
| `cwd` | `str \| Path` | `None` | Working directory |
| `resume` | `str` | `None` | Session ID to resume |
| `fork_session` | `bool` | `False` | Fork when resuming |
| `mcp_servers` | `dict` | `{}` | MCP server configs |
| `hooks` | `dict` | `None` | Hook configurations |
| `agents` | `dict` | `None` | Subagent definitions |
| `can_use_tool` | `callable` | `None` | Custom permission callback |
| `setting_sources` | `list` | `None` | Filesystem settings to load |
| `plugins` | `list` | `[]` | Custom plugins |
| `sandbox` | `SandboxSettings` | `None` | Sandbox config |
| `include_partial_messages` | `bool` | `False` | Stream partial messages |
| `enable_file_checkpointing` | `bool` | `False` | File change tracking |

### Python: query() vs ClaudeSDKClient

| Feature | `query()` | `ClaudeSDKClient` |
|---------|-----------|-------------------|
| Session | New each time | Reuses same session |
| Conversation | Single exchange | Multiple exchanges in context |
| Interrupts | No | Yes |
| Hooks | No | Yes |
| Custom Tools | No | Yes |
| Continue Chat | No | Yes |
| Use Case | One-off tasks | Continuous conversations |

## Message Types

| Type | Description |
|------|-------------|
| `SDKAssistantMessage` / `AssistantMessage` | Claude's response with content blocks |
| `SDKUserMessage` / `UserMessage` | User input message |
| `SDKSystemMessage` / `SystemMessage` | System init message (contains session_id, tools, MCP status) |
| `SDKResultMessage` / `ResultMessage` | Final result with cost, usage, duration |
| `SDKPartialAssistantMessage` / `StreamEvent` | Streaming partial (when `includePartialMessages` is true) |

### Result subtypes

- `success` — task completed successfully
- `error_max_turns` — hit max turn limit
- `error_during_execution` — error occurred
- `error_max_budget_usd` — hit budget limit

## Hosting & Deployment

### Deployment Patterns

| Pattern | Description | Example Use Cases |
|---------|-------------|-------------------|
| **Ephemeral Sessions** | New container per task, destroyed on completion | Bug fixes, invoice processing, translations |
| **Long-Running Sessions** | Persistent containers, multiple Claude processes | Email agents, site builders, high-frequency bots |
| **Hybrid Sessions** | Ephemeral containers hydrated with history | Project managers, deep research, customer support |
| **Single Container** | Multiple Claude processes in one container | Agent simulations, collaborative agents |

### System Requirements

- Python 3.10+ or Node.js 18+
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
- Recommended: 1 GiB RAM, 5 GiB disk, 1 CPU per instance
- Outbound HTTPS to `api.anthropic.com`

### Sandbox Providers

- Modal Sandbox, Cloudflare Sandboxes, Daytona, E2B, Fly Machines, Vercel Sandbox

## Claude Code Features via SDK

Set `settingSources: ['project']` to load filesystem-based configuration:

| Feature | Description | Location |
|---------|-------------|----------|
| Skills | Specialized capabilities in Markdown | `.claude/skills/SKILL.md` |
| Slash commands | Custom commands | `.claude/commands/*.md` |
| Memory | Project context and instructions | `CLAUDE.md` or `.claude/CLAUDE.md` |
| Plugins | Custom commands, agents, MCP servers | Programmatic via `plugins` option |

## SDK vs Other Claude Tools

**Agent SDK vs Client SDK**: Client SDK requires you to implement the tool loop. Agent SDK handles tool execution autonomously.

**Agent SDK vs Claude Code CLI**: Same capabilities, different interface. CLI for interactive development; SDK for CI/CD, custom apps, and production automation.

## Links

- TypeScript SDK: `@anthropic-ai/claude-agent-sdk` — [GitHub](https://github.com/anthropics/claude-agent-sdk-typescript)
- Python SDK: `claude-agent-sdk` — [GitHub](https://github.com/anthropics/claude-agent-sdk-python)
- [Example agents](https://github.com/anthropics/claude-agent-sdk-demos)
- [Full TypeScript API reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Full Python API reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [Quickstart guide](https://platform.claude.com/docs/en/agent-sdk/quickstart)

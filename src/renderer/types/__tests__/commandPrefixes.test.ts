import { describe, it, expect } from "vitest"
import { getCommandPrefixes, getCommandPrefix } from "../index"

describe("getCommandPrefixes", () => {
  describe("single commands", () => {
    it("returns single-word prefix for simple commands like cd", () => {
      expect(getCommandPrefixes({ command: "cd /some/path" })).toEqual(["cd"])
    })

    it("returns single-word prefix for zsh with flags", () => {
      expect(getCommandPrefixes({ command: "zsh -l -c 'echo foo'" })).toEqual(["zsh"])
    })

    it("returns single-word prefix for bash", () => {
      expect(getCommandPrefixes({ command: "bash -c 'npm install'" })).toEqual(["bash"])
    })

    it("returns single-word prefix for ls", () => {
      expect(getCommandPrefixes({ command: "ls -la /some/dir" })).toEqual(["ls"])
    })

    it("returns single-word prefix for python", () => {
      expect(getCommandPrefixes({ command: "python script.py --flag" })).toEqual(["python"])
    })

    it("returns single-word prefix for node", () => {
      expect(getCommandPrefixes({ command: "node index.js" })).toEqual(["node"])
    })

    it("returns single-word prefix for make", () => {
      expect(getCommandPrefixes({ command: "make build" })).toEqual(["make"])
    })
  })

  describe("multi-word commands (have subcommands)", () => {
    it("returns two-word prefix for git commands", () => {
      expect(getCommandPrefixes({ command: "git commit -m 'message'" })).toEqual(["git commit"])
    })

    it("returns two-word prefix for git push", () => {
      expect(getCommandPrefixes({ command: "git push origin main" })).toEqual(["git push"])
    })

    it("returns two-word prefix for npm install", () => {
      expect(getCommandPrefixes({ command: "npm install lodash" })).toEqual(["npm install"])
    })

    it("returns two-word prefix for pnpm test", () => {
      expect(getCommandPrefixes({ command: "pnpm test --watch" })).toEqual(["pnpm test"])
    })

    it("returns two-word prefix for docker build", () => {
      expect(getCommandPrefixes({ command: "docker build -t myimage ." })).toEqual(["docker build"])
    })

    it("returns two-word prefix for cargo run", () => {
      expect(getCommandPrefixes({ command: "cargo run --release" })).toEqual(["cargo run"])
    })

    it("returns two-word prefix for gh pr", () => {
      expect(getCommandPrefixes({ command: "gh pr create --title 'Fix'" })).toEqual(["gh pr"])
    })
  })

  describe("chained commands", () => {
    it("extracts prefixes from && chains", () => {
      expect(getCommandPrefixes({ command: "cd /foo && pnpm install" })).toEqual([
        "cd",
        "pnpm install",
      ])
    })

    it("extracts prefixes from multiple && chains", () => {
      expect(getCommandPrefixes({ command: "cd /foo && pnpm install && pnpm test" })).toEqual([
        "cd",
        "pnpm install",
        "pnpm test",
      ])
    })

    it("extracts prefixes from || chains", () => {
      expect(getCommandPrefixes({ command: "npm test || echo 'tests failed'" })).toEqual([
        "npm test",
        "echo",
      ])
    })

    it("extracts prefixes from ; chains", () => {
      expect(getCommandPrefixes({ command: "cd /app; npm install" })).toEqual(["cd", "npm install"])
    })

    it("extracts prefixes from pipe chains", () => {
      expect(getCommandPrefixes({ command: "cat file.txt | grep pattern" })).toEqual([
        "cat",
        "grep",
      ])
    })

    it("handles mixed chain operators", () => {
      expect(
        getCommandPrefixes({ command: "cd /foo && git add . && git commit -m 'msg'" })
      ).toEqual(["cd", "git add", "git commit"])
    })
  })

  describe("edge cases", () => {
    it("returns undefined for non-string command", () => {
      expect(getCommandPrefixes({ command: 123 })).toBeUndefined()
    })

    it("returns undefined for missing command", () => {
      expect(getCommandPrefixes({})).toBeUndefined()
    })

    it("returns undefined for empty command", () => {
      expect(getCommandPrefixes({ command: "" })).toBeUndefined()
    })

    it("handles leading whitespace", () => {
      expect(getCommandPrefixes({ command: "  cd /foo" })).toEqual(["cd"])
    })

    it("handles single-word command without args", () => {
      expect(getCommandPrefixes({ command: "pwd" })).toEqual(["pwd"])
    })

    it("handles unknown command with one word", () => {
      expect(getCommandPrefixes({ command: "mycommand" })).toEqual(["mycommand"])
    })

    it("handles unknown command with multiple words (uses two-word prefix)", () => {
      expect(getCommandPrefixes({ command: "mycommand subcommand arg1" })).toEqual([
        "mycommand subcommand",
      ])
    })

    it("handles whitespace between chain operators", () => {
      expect(getCommandPrefixes({ command: "cd /foo   &&   git status" })).toEqual([
        "cd",
        "git status",
      ])
    })

    it("handles command with trailing chain operator", () => {
      // This is technically invalid shell syntax, but we should handle it gracefully
      expect(getCommandPrefixes({ command: "cd /foo &&" })).toEqual(["cd"])
    })

    it("handles multiple consecutive spaces in command", () => {
      expect(getCommandPrefixes({ command: "git   commit   -m 'test'" })).toEqual(["git commit"])
    })
  })

  describe("all single-word commands", () => {
    // Verify a sample of commands from each category
    const singleWordCommands = [
      // Shell/scripting
      ["cd /path", "cd"],
      ["ls -la", "ls"],
      ["zsh -l -c 'echo'", "zsh"],
      ["bash --version", "bash"],
      ["sh script.sh", "sh"],
      ["fish -c 'echo'", "fish"],
      ["source ~/.bashrc", "source"],
      ["eval 'echo test'", "eval"],
      // File operations
      ["touch file.txt", "touch"],
      ["mkdir -p dir", "mkdir"],
      ["rm -rf dir", "rm"],
      ["cp src dst", "cp"],
      ["mv old new", "mv"],
      ["chmod 755 file", "chmod"],
      // Programming runtimes
      ["python3 script.py", "python3"],
      ["node app.js", "node"],
      ["ruby script.rb", "ruby"],
      ["deno run app.ts", "deno"],
      ["bun run script.ts", "bun"],
      // Build tools
      ["make all", "make"],
      ["cmake ..", "cmake"],
      // Utilities
      ["echo hello", "echo"],
      ["pwd", "pwd"],
      ["which node", "which"],
      ["grep pattern file", "grep"],
      ["curl https://example.com", "curl"],
      ["tar -xzf archive.tar.gz", "tar"],
    ]

    it.each(singleWordCommands)("'%s' returns ['%s']", (command, expectedPrefix) => {
      expect(getCommandPrefixes({ command })).toEqual([expectedPrefix])
    })
  })

  describe("all multi-word commands", () => {
    // Commands that have subcommands (use first two words)
    const multiWordCommands = [
      ["git status", "git status"],
      ["git add .", "git add"],
      ["git commit -m 'msg'", "git commit"],
      ["git push origin main", "git push"],
      ["git pull --rebase", "git pull"],
      ["npm install lodash", "npm install"],
      ["npm run build", "npm run"],
      ["npm test", "npm test"],
      ["pnpm install", "pnpm install"],
      ["pnpm run dev", "pnpm run"],
      ["yarn add react", "yarn add"],
      ["docker build -t app .", "docker build"],
      ["docker run -it ubuntu", "docker run"],
      ["docker compose up", "docker compose"],
      ["kubectl get pods", "kubectl get"],
      ["kubectl apply -f", "kubectl apply"],
      ["brew install node", "brew install"],
      ["cargo build --release", "cargo build"],
      ["cargo test", "cargo test"],
      ["gh pr create", "gh pr"],
      ["gh issue list", "gh issue"],
    ]

    it.each(multiWordCommands)("'%s' returns ['%s']", (command, expectedPrefix) => {
      expect(getCommandPrefixes({ command })).toEqual([expectedPrefix])
    })
  })
})

describe("getCommandPrefix (deprecated, backwards compat)", () => {
  it("returns first prefix from array", () => {
    expect(getCommandPrefix({ command: "cd /foo && npm install" })).toBe("cd")
  })

  it("returns undefined for invalid input", () => {
    expect(getCommandPrefix({})).toBeUndefined()
  })
})

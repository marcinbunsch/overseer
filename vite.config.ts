import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // React core - the foundation everything depends on
            if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) {
              return "vendor-react";
            }
            // Radix UI primitives - used across many components
            if (id.includes("@radix-ui")) {
              return "vendor-radix";
            }
            // Markdown and syntax highlighting merged into one chunk
            // because react-markdown uses react-syntax-highlighter and they share hast utilities
            if (
              id.includes("react-syntax-highlighter") ||
              id.includes("refractor") ||
              id.includes("prismjs") ||
              id.includes("react-markdown") ||
              id.includes("remark") ||
              id.includes("unified") ||
              id.includes("mdast") ||
              id.includes("micromark") ||
              id.includes("hast")
            ) {
              return "vendor-markdown";
            }
            // Terminal emulator
            if (id.includes("/xterm") || id.includes("@xterm")) {
              return "vendor-terminal";
            }
            // Icons
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
            // State management
            if (id.includes("mobx")) {
              return "vendor-state";
            }
            // Diff library
            if (id.includes("/diff/") || id.includes("@pierre/diffs")) {
              return "vendor-diff";
            }
            // Tauri plugins
            if (id.includes("@tauri-apps")) {
              return "vendor-tauri";
            }
          }
        },
      },
    },
  },

  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["src/test/setup.ts"],
    alias: {
      xterm: path.resolve(__dirname, "src/test/mocks/xterm.ts"),
      "@xterm/addon-fit": path.resolve(
        __dirname,
        "src/test/mocks/xterm-addon-fit.ts"
      ),
      "@xterm/addon-web-links": path.resolve(
        __dirname,
        "src/test/mocks/xterm-addon-web-links.ts"
      ),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));

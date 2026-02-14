import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Markdown and syntax highlighting are merged into one chunk
            // because react-markdown uses react-syntax-highlighter and they share hast utilities
            if (id.includes("react-syntax-highlighter") || id.includes("refractor") || id.includes("prismjs") ||
                id.includes("react-markdown") || id.includes("remark") || id.includes("unified") || id.includes("mdast") || id.includes("micromark") || id.includes("hast")) {
              return "vendor-markdown"
            }
            if (id.includes("/xterm") || id.includes("@xterm")) {
              return "vendor-terminal"
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons"
            }
            if (id.includes("mobx")) {
              return "vendor-state"
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

.PHONY: init build dev open start test checks checks-ui clean pstree install uninstall build-linux build-linux-app build-linux-daemon

init:
	pnpm install
	cd src-tauri && cargo install --locked tauri-cli

build-local:
	pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

# Linux: build both the headed desktop app and the headless daemon
build-linux: build-linux-app build-linux-daemon
	@echo ""
	@echo "Linux build complete:"
	@echo "  Headed app : target/release/bundle/{appimage,deb}/"
	@echo "  Daemon     : target/release/overseer-daemon"

# Headed desktop app (AppImage + deb). Runs pnpm vite-build via beforeBuildCommand.
build-linux-app:
	pnpm build:linux

# Headless daemon binary (builds the frontend it serves, then the release binary)
build-linux-daemon:
	pnpm daemon:dist

dev:
	pnpm dev

# Run all checks (format, lint, typecheck, rustcheck)
checks:
	pnpm checks

# Run UI-only checks (no Rust)
checks-ui:
	pnpm checks:ui

test:
	pnpm test
	cargo test -q

# macOS only: open the built app
open:
	OVERSEER_DEBUG=true open target/release/bundle/macos/Overseer.app

start: build-local open

# Show process tree (requires: brew install pstree)
pstree:
	pstree -p $$(pgrep -x Overseer)

# Install the built app to /Applications (macOS only)
install:
	@if [ ! -d "src-tauri/target/release/bundle/macos/Overseer.app" ]; then \
		echo "Error: App not found. Run 'make build' first."; \
		exit 1; \
	fi
	@echo "Installing Overseer.app to /Applications..."
	rm -rf /Applications/Overseer.app
	cp -R src-tauri/target/release/bundle/macos/Overseer.app /Applications/
	@echo "Done. Overseer is now available in /Applications."

# Uninstall the app from /Applications (macOS only)
uninstall:
	@echo "Removing Overseer.app from /Applications..."
	rm -rf /Applications/Overseer.app
	@echo "Done."

clean:
	rm -rf node_modules src-tauri/target

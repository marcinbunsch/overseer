.PHONY: init build dev open start test checks checks-ui clean pstree install uninstall

init:
	pnpm install
	cd src-tauri && cargo install --locked cargo-tauri

build-local:
	pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

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
	cd src-tauri && cargo test -q

# macOS only: open the built app
open:
	OVERSEER_DEBUG=true open src-tauri/target/release/bundle/macos/Overseer.app

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

.PHONY: init build dev open start test checks checks-ui clean pstree install uninstall open-installed start-installed

init:
	pnpm install
	cd src-tauri && cargo install --locked tauri-cli

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
	cargo test -q

# macOS only: open the built app
open:
	OVERSEER_DEBUG=true open target/release/bundle/macos/Overseer.app

start: build-local open

# Show process tree (requires: brew install pstree)
pstree:
	pstree -p $$(pgrep -x Overseer)

# Build and install the app to /Applications (macOS only).
# Strips the quarantine flag so the app runs from a stable location without being
# App-Translocated to a random read-only path. Translocation breaks bundle identity,
# which stops UNUserNotificationCenter (the click-routable completion notifications)
# from delivering — so this step is required to test notifications, not just cosmetic.
install: build-local
	@echo "Installing Overseer.app to /Applications..."
	rm -rf /Applications/Overseer.app
	cp -R target/release/bundle/macos/Overseer.app /Applications/
	xattr -dr com.apple.quarantine /Applications/Overseer.app || true
	@echo "Done. Overseer is now available in /Applications."

# Open the installed app from /Applications (macOS only). Notification click routing
# only works from the installed, un-quarantined bundle — not from `make open` (build dir)
# or `pnpm dev` (debug binary, native path is release-only).
open-installed:
	OVERSEER_DEBUG=true open /Applications/Overseer.app

# One-shot: build, install to /Applications, and launch. Mirrors `make start`, but runs
# the installed bundle so completion-notification click routing actually works.
start-installed: install open-installed

# Uninstall the app from /Applications (macOS only)
uninstall:
	@echo "Removing Overseer.app from /Applications..."
	rm -rf /Applications/Overseer.app
	@echo "Done."

clean:
	rm -rf node_modules src-tauri/target

#!/bin/bash
set -euo pipefail

# Release orchestration script
# Usage: ./scripts/release.sh <patch|minor|major>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUMP_TYPE="${1:-}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh <patch|minor|major>"
  exit 1
fi

cd "$PROJECT_DIR"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Bump version in package.json and tauri.conf.json
echo "Bumping version ($BUMP_TYPE)..."
tsx scripts/bump-version.ts "$BUMP_TYPE"

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")

# Commit version bump
echo "Committing version bump..."
git add package.json src-tauri/tauri.conf.json
git commit -m "chore: bump version to v$NEW_VERSION"

# Create and push tag
echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo "Pushing to origin..."
git push origin main
git push origin "v$NEW_VERSION"

echo ""
echo "✅ Release v$NEW_VERSION created and pushed!"
echo "   GitHub Actions will now build Mac and Linux binaries."
echo "   Check: https://github.com/$(git remote get-url origin | sed 's/.*://;s/.git$//')/actions"

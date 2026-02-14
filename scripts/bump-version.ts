/**
 * Bump version in package.json and tauri.conf.json
 * Usage: tsx scripts/bump-version.ts <patch|minor|major>
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type BumpType = "patch" | "minor" | "major";

function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return parts as [number, number, number];
}

function bumpVersion(current: string, type: BumpType): string {
  const [major, minor, patch] = parseVersion(current);

  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function main() {
  const bumpType = process.argv[2] as BumpType;

  if (!["patch", "minor", "major"].includes(bumpType)) {
    console.error("Usage: tsx scripts/bump-version.ts <patch|minor|major>");
    process.exit(1);
  }

  const projectRoot = join(__dirname, "..");

  // Update package.json
  const packagePath = join(projectRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
  const oldVersion = packageJson.version;
  const newVersion = bumpVersion(oldVersion, bumpType);
  packageJson.version = newVersion;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");

  // Update tauri.conf.json
  const tauriPath = join(projectRoot, "src-tauri/tauri.conf.json");
  const tauriConf = JSON.parse(readFileSync(tauriPath, "utf-8"));
  tauriConf.version = newVersion;
  writeFileSync(tauriPath, JSON.stringify(tauriConf, null, 2) + "\n");

  console.log(`Bumped version: ${oldVersion} → ${newVersion}`);
}

main();

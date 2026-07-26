//! A written SBPL profile on disk, cleaned up when dropped.
//!
//! `sandbox-exec -f <path>` reads the profile at exec time, so the file only
//! needs to outlive the `spawn()` call. Hold the guard until spawn returns, then
//! let it drop — the file is removed. Toggling the sandbox restarts the agent
//! often, so leaking these would litter the temp directory.

use std::path::{Path, PathBuf};

/// An SBPL profile written to a temp file. Removes the file on drop.
pub struct SandboxProfileFile {
    path: PathBuf,
}

impl SandboxProfileFile {
    /// Write `sbpl` to a uniquely-named file in the system temp directory.
    pub fn write(sbpl: &str) -> Result<Self, String> {
        let name = format!("overseer-sandbox-{}.sb", uuid::Uuid::new_v4());
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, sbpl)
            .map_err(|e| format!("Failed to write sandbox profile to {}: {e}", path.display()))?;
        Ok(SandboxProfileFile { path })
    }

    /// Path to pass to `sandbox-exec -f`.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for SandboxProfileFile {
    fn drop(&mut self) {
        // Best-effort cleanup; a leftover temp file is harmless if this fails.
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_creates_a_readable_file_with_the_contents() {
        let guard = SandboxProfileFile::write("(version 1)\n(deny default)\n").unwrap();
        let path = guard.path().to_path_buf();
        assert!(path.exists());
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "(version 1)\n(deny default)\n");
    }

    #[test]
    fn file_is_removed_on_drop() {
        let path;
        {
            let guard = SandboxProfileFile::write("(version 1)\n").unwrap();
            path = guard.path().to_path_buf();
            assert!(path.exists());
        }
        assert!(!path.exists(), "profile file should be removed on drop");
    }

    #[test]
    fn each_write_gets_a_unique_path() {
        let a = SandboxProfileFile::write("a").unwrap();
        let b = SandboxProfileFile::write("b").unwrap();
        assert_ne!(a.path(), b.path());
    }
}

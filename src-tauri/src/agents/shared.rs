//! Shared utilities for agent process management.

use serde::Serialize;
use std::process::Command;

/// Exit status emitted when an agent process terminates.
#[derive(Clone, Serialize)]
pub struct AgentExit {
    pub code: i32,
    pub signal: Option<i32>,
}

/// Prepend the binary's parent directory to PATH so node/etc. are found.
pub fn prepare_path_env(cmd: &mut Command, binary_path: &str) {
    if binary_path.contains('/') {
        if let Some(dir) = std::path::Path::new(binary_path).parent() {
            if let Some(dir_str) = dir.to_str() {
                let existing = std::env::var("PATH").unwrap_or_default();
                let combined = if existing.is_empty() {
                    dir_str.to_string()
                } else {
                    format!("{}:{}", dir_str, existing)
                };
                cmd.env("PATH", combined);
            }
        }
    }
}

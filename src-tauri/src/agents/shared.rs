//! Shared utilities for agent process management.
//!
//! This module re-exports shell utilities from overseer-core for use
//! in agent spawning.

// Re-export from overseer-core
pub use overseer_core::shell::{build_login_shell_command, AgentExit};

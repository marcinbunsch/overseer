//! Tool approval logic.
//!
//! Determines whether tools should auto-approve based on:
//! - Safe commands list (git status, git diff, etc.)
//! - User-approved tools
//! - User-approved command prefixes

mod command_parser;
mod context;
mod safe_commands;

pub use command_parser::parse_command_prefixes;
pub use context::ApprovalContext;
pub use safe_commands::{SAFE_COMMANDS, SINGLE_WORD_COMMANDS};

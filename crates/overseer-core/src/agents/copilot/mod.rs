//! Copilot agent: spawn configuration plus re-exports of the shared ACP parser.
//!
//! Copilot speaks ACP (`copilot --acp --stdio`); the protocol parser and JSON
//! types live in [`crate::agents::acp`] and are shared with Hermes. Only the
//! spawn configuration is Copilot-specific.

pub mod spawn;

pub use crate::agents::acp::AcpParser as CopilotParser;
pub use crate::agents::acp::*;
pub use spawn::CopilotConfig;

//! Hermes agent: spawn configuration plus re-exports of the shared ACP parser.
//!
//! Hermes (Nous Research) speaks ACP over stdio via `hermes acp`; the
//! protocol parser and JSON types live in [`crate::agents::acp`] and are
//! shared with Copilot. Only the spawn configuration is Hermes-specific.

pub mod spawn;

pub use crate::agents::acp::*;
pub use spawn::HermesConfig;

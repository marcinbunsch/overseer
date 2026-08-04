//! Claude skill discovery for Tauri commands.
//!
//! Thin async wrapper around `overseer_core::skills`.

use overseer_core::paths;
use overseer_core::skills::{self, Skill};

/// List the Claude skills available to an agent running in `workspace_path`.
///
/// Discovers project skills (`<workspace>/.claude/skills`) and user skills
/// (`<config_dir>/skills`); project skills shadow user skills of the same name.
/// `claude_config_dir` is the project's per-account `CLAUDE_CONFIG_DIR` override
/// (raw `~`/`$HOME` allowed); absent = the default `~/.claude`.
#[tauri::command]
pub async fn list_skills(
    workspace_path: String,
    claude_config_dir: Option<String>,
) -> Result<Vec<Skill>, String> {
    let home = paths::get_home_dir().ok();
    let config_dir = paths::resolve_claude_config_dir(claude_config_dir.as_deref(), home.as_deref());
    Ok(skills::list_skills(&workspace_path, config_dir.as_deref()))
}

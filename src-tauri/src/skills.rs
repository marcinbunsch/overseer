//! Claude skill discovery for Tauri commands.
//!
//! Thin async wrapper around `overseer_core::skills`.

use overseer_core::paths;
use overseer_core::skills::{self, Skill};

/// List the Claude skills available to an agent running in `workspace_path`.
///
/// Discovers project skills (`<workspace>/.claude/skills`) and user skills
/// (`<home>/.claude/skills`); project skills shadow user skills of the same name.
#[tauri::command]
pub async fn list_skills(workspace_path: String) -> Result<Vec<Skill>, String> {
    let home = paths::get_home_dir().ok();
    Ok(skills::list_skills(&workspace_path, home.as_deref()))
}

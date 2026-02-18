//! Per-project approval context management.
//!
//! Stores and manages `ApprovalContext` instances per project, handling
//! auto-approval decisions and persistence.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use overseer_core::approval::ApprovalContext;
use overseer_core::persistence::approvals::{load_approvals, save_approvals};
use overseer_core::persistence::types::ApprovalsData;

/// Manages approval contexts for all projects.
///
/// Thread-safe storage that lazily loads approvals from disk
/// and caches them for the duration of the app.
#[derive(Default)]
pub struct ProjectApprovalManager {
    /// Map of project_name -> ApprovalContext
    contexts: Mutex<HashMap<String, ApprovalContext>>,
    /// Config directory for persistence
    config_dir: Mutex<Option<PathBuf>>,
}

impl ProjectApprovalManager {
    /// Set the config directory for persistence.
    pub fn set_config_dir(&self, dir: PathBuf) {
        *self.config_dir.lock().unwrap() = Some(dir);
    }

    /// Get the approvals directory for a project.
    fn get_project_dir(&self, project_name: &str) -> Option<PathBuf> {
        self.config_dir
            .lock()
            .unwrap()
            .as_ref()
            .map(|dir| dir.join("chats").join(project_name))
    }

    /// Get or load the ApprovalContext for a project.
    ///
    /// If the context is already cached, returns it.
    /// Otherwise, loads from disk (or creates empty if not found).
    pub fn get_or_load(&self, project_name: &str) -> ApprovalContext {
        let mut contexts = self.contexts.lock().unwrap();

        if let Some(ctx) = contexts.get(project_name) {
            log::info!(
                "Returning cached context for '{}': {} tools, {} prefixes",
                project_name,
                ctx.approved_tools.len(),
                ctx.approved_prefixes.len()
            );
            return ctx.clone();
        }

        // Load from disk
        let dir = self.get_project_dir(project_name);
        log::info!("Loading approvals from disk for '{}', dir: {:?}", project_name, dir);

        let ctx = if let Some(dir) = dir {
            match load_approvals(&dir) {
                Ok(data) => {
                    log::info!(
                        "Loaded from disk: {} tools ({:?}), {} prefixes ({:?})",
                        data.tool_names.len(),
                        data.tool_names,
                        data.command_prefixes.len(),
                        data.command_prefixes
                    );
                    let mut ctx = ApprovalContext::new();
                    for tool in data.tool_names {
                        ctx.add_tool(tool);
                    }
                    for prefix in data.command_prefixes {
                        ctx.add_prefix(prefix);
                    }
                    ctx
                }
                Err(e) => {
                    log::warn!("Failed to load approvals for {}: {}", project_name, e);
                    ApprovalContext::new()
                }
            }
        } else {
            log::warn!("No project dir for '{}', using empty context", project_name);
            ApprovalContext::new()
        };

        contexts.insert(project_name.to_string(), ctx.clone());
        ctx
    }

    /// Check if a tool should auto-approve.
    #[allow(dead_code)] // Used in tests and available for other agents
    pub fn should_auto_approve(
        &self,
        project_name: &str,
        tool_name: &str,
        prefixes: &[String],
    ) -> bool {
        let ctx = self.get_or_load(project_name);
        log::info!(
            "[should_auto_approve] project='{}', tool='{}', prefixes={:?}, in-memory: tools={:?}, prefixes={:?}",
            project_name,
            tool_name,
            prefixes,
            ctx.approved_tools,
            ctx.approved_prefixes
        );
        ctx.should_auto_approve(tool_name, prefixes)
    }

    /// Add a tool or prefix approval and save to disk.
    pub fn add_approval(
        &self,
        project_name: &str,
        tool_or_prefix: &str,
        is_prefix: bool,
    ) -> Result<(), String> {
        // First, ensure we have a context loaded (this acquires and releases the lock)
        let _ = self.get_or_load(project_name);

        // Now update the cached context
        {
            let mut contexts = self.contexts.lock().unwrap();
            if let Some(ctx) = contexts.get_mut(project_name) {
                log::info!(
                    "[add_approval] BEFORE: project='{}', tools={:?}, prefixes={:?}",
                    project_name,
                    ctx.approved_tools,
                    ctx.approved_prefixes
                );
                if is_prefix {
                    ctx.add_prefix(tool_or_prefix.to_string());
                } else {
                    ctx.add_tool(tool_or_prefix.to_string());
                }
                log::info!(
                    "[add_approval] AFTER: project='{}', tools={:?}, prefixes={:?}",
                    project_name,
                    ctx.approved_tools,
                    ctx.approved_prefixes
                );
            } else {
                log::warn!("[add_approval] No context found for project '{}'", project_name);
            }
        }

        self.save(project_name)
    }

    /// Remove a tool or prefix approval and save to disk.
    pub fn remove_approval(
        &self,
        project_name: &str,
        tool_or_prefix: &str,
        is_prefix: bool,
    ) -> Result<(), String> {
        {
            let mut contexts = self.contexts.lock().unwrap();
            if let Some(ctx) = contexts.get_mut(project_name) {
                log::info!(
                    "[remove_approval] BEFORE: project='{}', tools={:?}, prefixes={:?}",
                    project_name,
                    ctx.approved_tools,
                    ctx.approved_prefixes
                );
                if is_prefix {
                    ctx.remove_prefix(tool_or_prefix);
                } else {
                    ctx.remove_tool(tool_or_prefix);
                }
                log::info!(
                    "[remove_approval] AFTER: project='{}', tools={:?}, prefixes={:?}",
                    project_name,
                    ctx.approved_tools,
                    ctx.approved_prefixes
                );
            } else {
                log::warn!("[remove_approval] No context found for project '{}'", project_name);
            }
        }

        self.save(project_name)
    }

    /// Clear all approvals for a project and save to disk.
    pub fn clear_approvals(&self, project_name: &str) -> Result<(), String> {
        {
            let mut contexts = self.contexts.lock().unwrap();
            if let Some(ctx) = contexts.get_mut(project_name) {
                ctx.clear();
            }
        }

        self.save(project_name)
    }

    /// Save approvals for a project to disk.
    fn save(&self, project_name: &str) -> Result<(), String> {
        let dir = self
            .get_project_dir(project_name)
            .ok_or_else(|| "Config directory not set".to_string())?;

        let data = {
            let contexts = self.contexts.lock().unwrap();
            if let Some(ctx) = contexts.get(project_name) {
                ApprovalsData {
                    tool_names: ctx.approved_tools.iter().cloned().collect(),
                    command_prefixes: ctx.approved_prefixes.iter().cloned().collect(),
                }
            } else {
                ApprovalsData::default()
            }
        };

        save_approvals(&dir, &data).map_err(|e| format!("Failed to save approvals: {}", e))
    }

    /// Load approvals for a project (for frontend display).
    pub fn load_approvals(&self, project_name: &str) -> ApprovalsData {
        let ctx = self.get_or_load(project_name);
        ApprovalsData {
            tool_names: ctx.approved_tools.iter().cloned().collect(),
            command_prefixes: ctx.approved_prefixes.iter().cloned().collect(),
        }
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Load approvals for a project (for settings display).
#[tauri::command]
pub fn load_project_approvals(
    state: tauri::State<ProjectApprovalManager>,
    project_name: String,
) -> ApprovalsData {
    state.load_approvals(&project_name)
}

/// Add a tool or prefix approval.
#[tauri::command]
pub fn add_approval(
    state: tauri::State<ProjectApprovalManager>,
    project_name: String,
    tool_or_prefix: String,
    is_prefix: bool,
) -> Result<(), String> {
    log::info!(
        "add_approval called: project='{}', tool_or_prefix='{}', is_prefix={}",
        project_name,
        tool_or_prefix,
        is_prefix
    );
    let result = state.add_approval(&project_name, &tool_or_prefix, is_prefix);
    log::info!("add_approval result: {:?}", result);
    result
}

/// Remove a tool or prefix approval.
#[tauri::command]
pub fn remove_approval(
    state: tauri::State<ProjectApprovalManager>,
    project_name: String,
    tool_or_prefix: String,
    is_prefix: bool,
) -> Result<(), String> {
    state.remove_approval(&project_name, &tool_or_prefix, is_prefix)
}

/// Clear all approvals for a project.
#[tauri::command]
pub fn clear_project_approvals(
    state: tauri::State<ProjectApprovalManager>,
    project_name: String,
) -> Result<(), String> {
    state.clear_approvals(&project_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_should_auto_approve_safe_command() {
        let manager = ProjectApprovalManager::default();
        // Safe commands should auto-approve even without any stored approvals
        assert!(manager.should_auto_approve("test-project", "Bash", &["git status".to_string()]));
    }

    #[test]
    fn test_should_not_auto_approve_unsafe_command() {
        let manager = ProjectApprovalManager::default();
        assert!(!manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));
    }

    #[test]
    fn test_add_and_check_approval() {
        let dir = tempdir().unwrap();
        let manager = ProjectApprovalManager::default();
        manager.set_config_dir(dir.path().to_path_buf());

        // Initially not approved
        assert!(!manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));

        // Add approval
        manager
            .add_approval("test-project", "pnpm install", true)
            .unwrap();

        // Now should be approved
        assert!(manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));
    }

    #[test]
    fn test_add_tool_approval() {
        let dir = tempdir().unwrap();
        let manager = ProjectApprovalManager::default();
        manager.set_config_dir(dir.path().to_path_buf());

        // Initially not approved
        assert!(!manager.should_auto_approve("test-project", "Write", &[]));

        // Add tool approval
        manager.add_approval("test-project", "Write", false).unwrap();

        // Now should be approved
        assert!(manager.should_auto_approve("test-project", "Write", &[]));
    }

    #[test]
    fn test_remove_approval() {
        let dir = tempdir().unwrap();
        let manager = ProjectApprovalManager::default();
        manager.set_config_dir(dir.path().to_path_buf());

        // Add and verify
        manager
            .add_approval("test-project", "pnpm install", true)
            .unwrap();
        assert!(manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));

        // Remove and verify
        manager
            .remove_approval("test-project", "pnpm install", true)
            .unwrap();
        assert!(!manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));
    }

    #[test]
    fn test_clear_approvals() {
        let dir = tempdir().unwrap();
        let manager = ProjectApprovalManager::default();
        manager.set_config_dir(dir.path().to_path_buf());

        // Add some approvals
        manager
            .add_approval("test-project", "pnpm install", true)
            .unwrap();
        manager.add_approval("test-project", "Write", false).unwrap();

        // Verify they work
        assert!(manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));
        assert!(manager.should_auto_approve("test-project", "Write", &[]));

        // Clear all
        manager.clear_approvals("test-project").unwrap();

        // Verify cleared (but safe commands still work)
        assert!(!manager.should_auto_approve(
            "test-project",
            "Bash",
            &["pnpm install".to_string()]
        ));
        assert!(!manager.should_auto_approve("test-project", "Write", &[]));
    }

    #[test]
    fn test_load_approvals() {
        let dir = tempdir().unwrap();
        let manager = ProjectApprovalManager::default();
        manager.set_config_dir(dir.path().to_path_buf());

        // Add some approvals
        manager
            .add_approval("test-project", "pnpm install", true)
            .unwrap();
        manager.add_approval("test-project", "Write", false).unwrap();

        // Load and verify
        let data = manager.load_approvals("test-project");
        assert!(data.tool_names.contains(&"Write".to_string()));
        assert!(data.command_prefixes.contains(&"pnpm install".to_string()));
    }
}

//! Project registry persistence.
//!
//! # Files
//!
//! - `projects.json` - Primary project registry
//! - `repos.json` - Legacy alias (backward compatibility)
//!
//! # Migration
//!
//! Supports legacy format with automatic migration:
//! - `worktrees` → `workspaces`
//! - `worktreeFilter` → `workspaceFilter`
//! - `repoId` → `projectId` in workspaces

use std::fs;
use std::path::Path;

use super::types::{
    LegacyProject, LegacyProjectRegistry, LegacyWorkspace, Project, ProjectRegistry, Workspace,
};

/// Error type for project operations.
#[derive(Debug)]
pub enum ProjectError {
    /// IO error
    Io(std::io::Error),
    /// JSON error
    Json(serde_json::Error),
    /// Project not found
    NotFound(String),
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectError::Io(e) => write!(f, "IO error: {e}"),
            ProjectError::Json(e) => write!(f, "JSON error: {e}"),
            ProjectError::NotFound(id) => write!(f, "Project not found: {id}"),
        }
    }
}

impl std::error::Error for ProjectError {}

impl From<std::io::Error> for ProjectError {
    fn from(e: std::io::Error) -> Self {
        ProjectError::Io(e)
    }
}

impl From<serde_json::Error> for ProjectError {
    fn from(e: serde_json::Error) -> Self {
        ProjectError::Json(e)
    }
}

/// Save the project registry to disk.
///
/// Writes to both `projects.json` and `repos.json` (for backward compat).
pub fn save_project_registry(dir: &Path, registry: &ProjectRegistry) -> Result<(), ProjectError> {
    fs::create_dir_all(dir)?;

    // Save to projects.json
    let file_path = dir.join("projects.json");
    let temp_path = dir.join("projects.json.tmp");

    let json = serde_json::to_string_pretty(registry)?;
    fs::write(&temp_path, &json)?;
    fs::rename(&temp_path, &file_path)?;

    // Also save to repos.json for backward compatibility
    // Convert to legacy format
    let legacy = to_legacy_registry(registry);
    let legacy_path = dir.join("repos.json");
    let legacy_temp = dir.join("repos.json.tmp");

    let legacy_json = serde_json::to_string_pretty(&legacy)?;
    fs::write(&legacy_temp, legacy_json)?;
    fs::rename(&legacy_temp, &legacy_path)?;

    Ok(())
}

/// Load the project registry from disk.
///
/// Tries `projects.json` first, falls back to `repos.json`.
/// Automatically migrates legacy format to new format.
pub fn load_project_registry(dir: &Path) -> Result<ProjectRegistry, ProjectError> {
    let projects_path = dir.join("projects.json");
    let repos_path = dir.join("repos.json");

    // Try projects.json first
    if projects_path.exists() {
        let contents = fs::read_to_string(&projects_path)?;
        let registry: ProjectRegistry = serde_json::from_str(&contents)?;
        return Ok(registry);
    }

    // Fall back to repos.json (legacy)
    if repos_path.exists() {
        let contents = fs::read_to_string(&repos_path)?;
        let legacy: LegacyProjectRegistry = serde_json::from_str(&contents)?;
        return Ok(from_legacy_registry(&legacy));
    }

    // No registry exists, return empty
    Ok(ProjectRegistry::default())
}

/// Convert legacy registry to new format.
fn from_legacy_registry(legacy: &LegacyProjectRegistry) -> ProjectRegistry {
    ProjectRegistry {
        projects: legacy.projects.iter().map(from_legacy_project).collect(),
    }
}

/// Convert legacy project to new format.
fn from_legacy_project(legacy: &LegacyProject) -> Project {
    Project {
        id: legacy.id.clone(),
        name: legacy.name.clone(),
        path: legacy.path.clone(),
        is_git_repo: legacy.is_git_repo,
        workspaces: legacy.worktrees.iter().map(from_legacy_workspace).collect(),
        init_prompt: legacy.init_prompt.clone(),
        pr_prompt: legacy.pr_prompt.clone(),
        post_create: legacy.post_create.clone(),
        workspace_filter: legacy.worktree_filter.clone(),
        use_github: legacy.use_github,
        allow_merge_to_main: legacy.allow_merge_to_main,
    }
}

/// Convert legacy workspace to new format.
fn from_legacy_workspace(legacy: &LegacyWorkspace) -> Workspace {
    Workspace {
        id: legacy.id.clone(),
        project_id: legacy.repo_id.clone(), // repoId → projectId
        branch: legacy.branch.clone(),
        path: legacy.path.clone(),
        is_archived: legacy.is_archived,
        created_at: legacy.created_at,
        pr_number: legacy.pr_number,
        pr_url: legacy.pr_url.clone(),
        pr_state: legacy.pr_state.clone(),
    }
}

/// Convert registry to legacy format.
fn to_legacy_registry(registry: &ProjectRegistry) -> LegacyProjectRegistry {
    LegacyProjectRegistry {
        projects: registry.projects.iter().map(to_legacy_project).collect(),
    }
}

/// Convert project to legacy format.
fn to_legacy_project(project: &Project) -> LegacyProject {
    LegacyProject {
        id: project.id.clone(),
        name: project.name.clone(),
        path: project.path.clone(),
        is_git_repo: project.is_git_repo,
        worktrees: project.workspaces.iter().map(to_legacy_workspace).collect(),
        init_prompt: project.init_prompt.clone(),
        pr_prompt: project.pr_prompt.clone(),
        post_create: project.post_create.clone(),
        worktree_filter: project.workspace_filter.clone(),
        use_github: project.use_github,
        allow_merge_to_main: project.allow_merge_to_main,
    }
}

/// Convert workspace to legacy format.
fn to_legacy_workspace(workspace: &Workspace) -> LegacyWorkspace {
    LegacyWorkspace {
        id: workspace.id.clone(),
        repo_id: workspace.project_id.clone(), // projectId → repoId
        branch: workspace.branch.clone(),
        path: workspace.path.clone(),
        is_archived: workspace.is_archived,
        created_at: workspace.created_at,
        pr_number: workspace.pr_number,
        pr_url: workspace.pr_url.clone(),
        pr_state: workspace.pr_state.clone(),
    }
}

// ============================================================================
// Project Operations
// ============================================================================

/// Find a project by ID.
pub fn find_project<'a>(registry: &'a ProjectRegistry, id: &str) -> Option<&'a Project> {
    registry.projects.iter().find(|p| p.id == id)
}

/// Find a project by path.
pub fn find_project_by_path<'a>(registry: &'a ProjectRegistry, path: &str) -> Option<&'a Project> {
    registry.projects.iter().find(|p| p.path == path)
}

/// Add or update a project.
pub fn upsert_project(registry: &mut ProjectRegistry, project: Project) {
    registry.projects.retain(|p| p.id != project.id);
    registry.projects.push(project);
}

/// Remove a project.
pub fn remove_project(registry: &mut ProjectRegistry, id: &str) {
    registry.projects.retain(|p| p.id != id);
}

// ============================================================================
// Workspace Operations
// ============================================================================

/// Find a workspace in a project.
pub fn find_workspace<'a>(project: &'a Project, workspace_id: &str) -> Option<&'a Workspace> {
    project.workspaces.iter().find(|w| w.id == workspace_id)
}

/// Find a workspace by branch name.
pub fn find_workspace_by_branch<'a>(project: &'a Project, branch: &str) -> Option<&'a Workspace> {
    project.workspaces.iter().find(|w| w.branch == branch)
}

/// Add a workspace to a project.
pub fn add_workspace(project: &mut Project, workspace: Workspace) {
    project.workspaces.push(workspace);
}

/// Remove a workspace from a project.
pub fn remove_workspace(project: &mut Project, workspace_id: &str) {
    project.workspaces.retain(|w| w.id != workspace_id);
}

/// Get non-archived workspaces.
pub fn get_active_workspaces(project: &Project) -> Vec<&Workspace> {
    project
        .workspaces
        .iter()
        .filter(|w| !w.is_archived)
        .collect()
}

/// Get archived workspaces.
pub fn get_archived_workspaces(project: &Project) -> Vec<&Workspace> {
    project
        .workspaces
        .iter()
        .filter(|w| w.is_archived)
        .collect()
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;

    fn make_project(id: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/path/to/{}", name),
            is_git_repo: true,
            workspaces: vec![],
            init_prompt: None,
            pr_prompt: None,
            post_create: None,
            workspace_filter: None,
            use_github: None,
            allow_merge_to_main: None,
        }
    }

    fn make_workspace(id: &str, branch: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            project_id: "proj-1".to_string(),
            branch: branch.to_string(),
            path: format!("/path/to/{}", branch),
            is_archived: false,
            created_at: Utc::now(),
            pr_number: None,
            pr_url: None,
            pr_state: None,
        }
    }

    #[test]
    fn save_and_load_registry() {
        let dir = tempdir().unwrap();
        let registry = ProjectRegistry {
            projects: vec![make_project("proj-1", "test-project")],
        };

        save_project_registry(dir.path(), &registry).unwrap();
        let loaded = load_project_registry(dir.path()).unwrap();

        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].name, "test-project");
    }

    #[test]
    fn save_creates_both_files() {
        let dir = tempdir().unwrap();
        let registry = ProjectRegistry {
            projects: vec![make_project("proj-1", "test")],
        };

        save_project_registry(dir.path(), &registry).unwrap();

        assert!(dir.path().join("projects.json").exists());
        assert!(dir.path().join("repos.json").exists());
    }

    #[test]
    fn load_from_legacy_repos_json() {
        let dir = tempdir().unwrap();

        // Write legacy format
        let legacy = r#"{
            "projects": [{
                "id": "proj-1",
                "name": "legacy-project",
                "path": "/path/to/legacy",
                "isGitRepo": true,
                "worktrees": [{
                    "id": "ws-1",
                    "repoId": "proj-1",
                    "branch": "main",
                    "path": "/path/to/main",
                    "isArchived": false,
                    "createdAt": "2024-01-01T00:00:00Z"
                }],
                "worktreeFilter": "feature/*"
            }]
        }"#;
        fs::write(dir.path().join("repos.json"), legacy).unwrap();

        let loaded = load_project_registry(dir.path()).unwrap();

        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].name, "legacy-project");
        assert_eq!(
            loaded.projects[0].workspace_filter,
            Some("feature/*".to_string())
        );
        assert_eq!(loaded.projects[0].workspaces.len(), 1);
        assert_eq!(loaded.projects[0].workspaces[0].project_id, "proj-1"); // repoId → projectId
    }

    #[test]
    fn load_nonexistent_returns_empty() {
        let dir = tempdir().unwrap();
        let loaded = load_project_registry(dir.path()).unwrap();

        assert!(loaded.projects.is_empty());
    }

    #[test]
    fn find_project_by_id() {
        let registry = ProjectRegistry {
            projects: vec![
                make_project("proj-1", "first"),
                make_project("proj-2", "second"),
            ],
        };

        let found = find_project(&registry, "proj-2");
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "second");

        let not_found = find_project(&registry, "proj-3");
        assert!(not_found.is_none());
    }

    #[test]
    fn find_project_by_path_works() {
        let registry = ProjectRegistry {
            projects: vec![make_project("proj-1", "test")],
        };

        let found = find_project_by_path(&registry, "/path/to/test");
        assert!(found.is_some());

        let not_found = find_project_by_path(&registry, "/path/to/other");
        assert!(not_found.is_none());
    }

    #[test]
    fn upsert_project_adds() {
        let mut registry = ProjectRegistry::default();

        upsert_project(&mut registry, make_project("proj-1", "first"));
        upsert_project(&mut registry, make_project("proj-2", "second"));

        assert_eq!(registry.projects.len(), 2);
    }

    #[test]
    fn upsert_project_replaces() {
        let mut registry = ProjectRegistry::default();

        upsert_project(&mut registry, make_project("proj-1", "original"));
        upsert_project(&mut registry, make_project("proj-1", "updated"));

        assert_eq!(registry.projects.len(), 1);
        assert_eq!(registry.projects[0].name, "updated");
    }

    #[test]
    fn remove_project_works() {
        let mut registry = ProjectRegistry {
            projects: vec![
                make_project("proj-1", "first"),
                make_project("proj-2", "second"),
            ],
        };

        remove_project(&mut registry, "proj-1");

        assert_eq!(registry.projects.len(), 1);
        assert_eq!(registry.projects[0].id, "proj-2");
    }

    #[test]
    fn workspace_operations() {
        let mut project = make_project("proj-1", "test");

        add_workspace(&mut project, make_workspace("ws-1", "main"));
        add_workspace(&mut project, make_workspace("ws-2", "feature"));

        assert_eq!(project.workspaces.len(), 2);

        let found = find_workspace(&project, "ws-1");
        assert!(found.is_some());

        let by_branch = find_workspace_by_branch(&project, "feature");
        assert!(by_branch.is_some());
        assert_eq!(by_branch.unwrap().id, "ws-2");

        remove_workspace(&mut project, "ws-1");
        assert_eq!(project.workspaces.len(), 1);
    }

    #[test]
    fn active_and_archived_workspaces() {
        let mut project = make_project("proj-1", "test");

        let active = make_workspace("ws-1", "main");
        let mut archived = make_workspace("ws-2", "old-feature");
        archived.is_archived = true;

        add_workspace(&mut project, active);
        add_workspace(&mut project, archived);

        let active_list = get_active_workspaces(&project);
        assert_eq!(active_list.len(), 1);
        assert_eq!(active_list[0].branch, "main");

        let archived_list = get_archived_workspaces(&project);
        assert_eq!(archived_list.len(), 1);
        assert_eq!(archived_list[0].branch, "old-feature");
    }
}

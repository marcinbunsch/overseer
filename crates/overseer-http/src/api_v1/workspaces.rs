//! Project listing and workspace creation.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};

use overseer_core::persistence::{
    load_project_registry, save_project_registry, Workspace as StoredWorkspace,
};

use super::{workspace_name_from_path, ApiEnvelope, ApiError};
use crate::HttpSharedState;

/// A project the driver can target.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectDto {
    id: String,
    name: String,
    path: String,
}

/// A workspace the driver just created.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDto {
    id: String,
    project_id: String,
    /// Workspace directory name (the animal folder), used as the second
    /// chat-path segment.
    name: String,
    branch: String,
    path: String,
}

/// GET /api/v1/projects
pub(crate) async fn list_projects(
    State(state): State<Arc<HttpSharedState>>,
) -> Result<Json<ApiEnvelope<Vec<ProjectDto>>>, ApiError> {
    let config_dir = state
        .get_config_dir()
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;
    let registry =
        load_project_registry(&config_dir).map_err(|e| ApiError::internal(e.to_string()))?;

    let projects = registry
        .projects
        .into_iter()
        .map(|project| ProjectDto {
            id: project.id,
            name: project.name,
            path: project.path,
        })
        .collect();

    Ok(ApiEnvelope::ok(projects))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CreateWorkspaceBody {
    branch: Option<String>,
}

/// POST /api/v1/projects/{projectId}/workspaces
///
/// Creates a git worktree in the project and records it in `projects.json` so the
/// desktop app lists it.
pub(crate) async fn create_workspace(
    State(state): State<Arc<HttpSharedState>>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateWorkspaceBody>,
) -> Result<Json<ApiEnvelope<WorkspaceDto>>, ApiError> {
    let branch = body
        .branch
        .filter(|b| !b.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("Missing required field: branch"))?;

    let config_dir = state
        .get_config_dir()
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;

    // Find the project's root path.
    let project_path = {
        let registry =
            load_project_registry(&config_dir).map_err(|e| ApiError::internal(e.to_string()))?;
        registry
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .map(|p| p.path.clone())
            .ok_or_else(|| ApiError::not_found(format!("Project not found: {project_id}")))?
    };

    // Create the git worktree (picks a unique animal-name directory).
    let worktree_path =
        overseer_core::git::add_workspace(std::path::Path::new(&project_path), &branch)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let worktree_path = worktree_path.to_string_lossy().to_string();
    let workspace_name = workspace_name_from_path(&worktree_path);

    // Record the workspace in the registry so the desktop app shows it. Reload
    // fresh to avoid clobbering concurrent edits.
    let workspace = StoredWorkspace {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: Some(project_id.clone()),
        repo_id: None,
        branch: branch.clone(),
        path: worktree_path.clone(),
        is_archived: false,
        created_at: chrono::Utc::now(),
        pr_number: None,
        pr_url: None,
        pr_state: None,
        is_creating: None,
        is_archiving: None,
        ssh_host_id: None,
    };
    let workspace_id = workspace.id.clone();

    let mut registry =
        load_project_registry(&config_dir).map_err(|e| ApiError::internal(e.to_string()))?;
    let project = registry
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| ApiError::not_found(format!("Project not found: {project_id}")))?;
    project.workspaces.push(workspace);
    save_project_registry(&config_dir, &registry).map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(ApiEnvelope::ok(WorkspaceDto {
        id: workspace_id,
        project_id,
        name: workspace_name,
        branch,
        path: worktree_path,
    }))
}

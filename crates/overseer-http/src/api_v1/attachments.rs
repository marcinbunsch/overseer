//! File attachments: upload bytes, then reference them when sending a message.
//!
//! Overseer has no special attachment channel to the agent — attaching a file
//! means storing it and putting its path in the prompt, so the agent reads it
//! with its normal file tools. This mirrors the desktop app (`ChatStore.ts`):
//! the stored file's path is prepended to the message the agent sees, while the
//! displayed user message keeps the raw text and carries the attachment metadata
//! for the UI.
//!
//! Flow for a driver:
//! 1. `POST /api/v1/sessions/{id}/attachments?filename=foo.md` with the file
//!    bytes as the body → get back `{ id, filename, path, mimeType, size }`.
//! 2. Pass that object (at least its `path`) in the `attachments` array of the
//!    send-message body.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};

use super::{resolve_session, ApiEnvelope, ApiError};
use crate::HttpSharedState;

/// Max upload size (32 MiB). Overrides axum's 2 MiB default for this route so
/// reasonably sized files (logs, images, PDFs) go through.
pub(crate) const MAX_ATTACHMENT_BYTES: usize = 32 * 1024 * 1024;

/// A stored attachment, as returned by the upload endpoint. Same shape as the
/// desktop app's `Attachment` type and the low-level `save_attachment` command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentDto {
    id: String,
    filename: String,
    path: String,
    mime_type: String,
    size: u64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(crate) struct UploadQuery {
    filename: Option<String>,
}

/// POST /api/v1/sessions/{sessionId}/attachments?filename=NAME
///
/// Body is the raw file bytes. Stores the file under
/// `{config}/attachments/{uuid}/{filename}` and returns its metadata.
pub(crate) async fn upload_attachment(
    State(state): State<Arc<HttpSharedState>>,
    Path(session_id): Path<String>,
    Query(query): Query<UploadQuery>,
    body: axum::body::Bytes,
) -> Result<Json<ApiEnvelope<AttachmentDto>>, ApiError> {
    // Validate the session exists (also gives the driver a clear 404).
    resolve_session(&state, &session_id)?;

    let filename = query
        .filename
        .as_deref()
        .map(sanitize_filename)
        .transpose()?
        .ok_or_else(|| ApiError::bad_request("Missing required query parameter: filename"))?;

    if body.is_empty() {
        return Err(ApiError::bad_request("Attachment body is empty"));
    }

    let config_dir = state
        .get_config_dir()
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;

    // Each attachment gets its own uuid directory, so identical filenames never
    // collide (same layout as the `save_attachment` command).
    let id = uuid::Uuid::new_v4().to_string();
    let dir = config_dir.join("attachments").join(&id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| ApiError::internal(format!("Failed to create attachment directory: {e}")))?;
    let path = dir.join(&filename);
    std::fs::write(&path, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write attachment: {e}")))?;

    Ok(ApiEnvelope::ok(AttachmentDto {
        id,
        mime_type: crate::routes::guess_mime_type(&filename).to_string(),
        path: path.to_string_lossy().to_string(),
        size: body.len() as u64,
        filename,
    }))
}

/// Strip any directory components — an uploaded filename must be a bare name, so
/// it can't escape the attachment directory.
fn sanitize_filename(name: &str) -> Result<String, ApiError> {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str());
    match base {
        Some(b) if !b.is_empty() && b != "." && b != ".." => Ok(b.to_string()),
        _ => Err(ApiError::bad_request(format!("Invalid filename: {name}"))),
    }
}

// ============================================================================
// SEND-MESSAGE SUPPORT
// ============================================================================

/// An attachment referenced in a send-message request. Only `path` is required;
/// a driver that uploaded via this API passes back the whole object.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentInput {
    path: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

/// Build the prompt the agent actually receives: the attachment paths prepended
/// to the message, so the agent can read the files. Matches `ChatStore.ts`.
pub(crate) fn build_agent_prompt(text: &str, attachments: &[AttachmentInput]) -> String {
    if attachments.is_empty() {
        return text.to_string();
    }
    let path_list = attachments
        .iter()
        .map(|attachment| format!("- {}", attachment.path))
        .collect::<Vec<_>>()
        .join("\n");
    format!("[Attached files:\n{path_list}]\n\n{text}")
}

/// Build the `meta` stored on the displayed user message, so the desktop UI shows
/// the attachment chips. Returns None when there are no attachments.
pub(crate) fn attachments_meta(attachments: &[AttachmentInput]) -> Option<serde_json::Value> {
    if attachments.is_empty() {
        return None;
    }
    let list: Vec<serde_json::Value> = attachments
        .iter()
        .map(|attachment| {
            let filename = attachment
                .filename
                .clone()
                .unwrap_or_else(|| basename(&attachment.path));
            serde_json::json!({
                "id": attachment.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                "filename": filename,
                "mimeType": attachment
                    .mime_type
                    .clone()
                    .unwrap_or_else(|| crate::routes::guess_mime_type(&filename).to_string()),
                "size": attachment.size.unwrap_or(0),
                "path": attachment.path,
            })
        })
        .collect();
    Some(serde_json::json!({ "attachments": list }))
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn attachment(path: &str) -> AttachmentInput {
        AttachmentInput {
            path: path.to_string(),
            id: None,
            filename: None,
            mime_type: None,
            size: None,
        }
    }

    #[test]
    fn prompt_unchanged_without_attachments() {
        assert_eq!(build_agent_prompt("do the thing", &[]), "do the thing");
    }

    #[test]
    fn prompt_prepends_attachment_paths() {
        let attachments = vec![
            attachment("/cfg/attachments/a/spec.md"),
            attachment("/cfg/attachments/b/log.txt"),
        ];
        let prompt = build_agent_prompt("summarize these", &attachments);
        assert_eq!(
            prompt,
            "[Attached files:\n- /cfg/attachments/a/spec.md\n- /cfg/attachments/b/log.txt]\n\nsummarize these"
        );
    }

    #[test]
    fn meta_is_none_without_attachments() {
        assert!(attachments_meta(&[]).is_none());
    }

    #[test]
    fn meta_fills_defaults_from_path() {
        let meta = attachments_meta(&[attachment("/cfg/attachments/a/report.pdf")]).unwrap();
        let entry = &meta["attachments"][0];
        assert_eq!(entry["filename"], "report.pdf");
        assert_eq!(entry["mimeType"], "application/pdf");
        assert_eq!(entry["size"], 0);
        assert!(entry["id"].as_str().is_some());
    }

    #[test]
    fn sanitize_filename_strips_directories() {
        assert_eq!(sanitize_filename("../../etc/passwd").unwrap(), "passwd");
        assert_eq!(sanitize_filename("notes.md").unwrap(), "notes.md");
        assert!(sanitize_filename("..").is_err());
        assert!(sanitize_filename("").is_err());
    }
}

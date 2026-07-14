//! Overdrive task ledger persistence.
//!
//! Each repo's task queue lives in its own file at `tasks/{repo}.json` under the
//! config directory. Mirrors the atomic-write + default-on-missing pattern in
//! [`super::projects`]. This phase is CRUD + reorder only; nothing runs tasks.

use std::fs;
use std::path::{Component, Path, PathBuf};

use super::types::{OverdriveTask, TaskLedger};

/// Error type for task ledger operations.
#[derive(Debug)]
pub enum TaskError {
    /// IO error.
    Io(std::io::Error),
    /// JSON (de)serialization error.
    Json(serde_json::Error),
    /// The repo identifier is not a safe single path component.
    InvalidRepo(String),
}

impl std::fmt::Display for TaskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskError::Io(e) => write!(f, "IO error: {e}"),
            TaskError::Json(e) => write!(f, "JSON error: {e}"),
            TaskError::InvalidRepo(r) => write!(f, "Invalid repo name: {r}"),
        }
    }
}

impl std::error::Error for TaskError {}

impl From<std::io::Error> for TaskError {
    fn from(e: std::io::Error) -> Self {
        TaskError::Io(e)
    }
}

impl From<serde_json::Error> for TaskError {
    fn from(e: serde_json::Error) -> Self {
        TaskError::Json(e)
    }
}

/// Reject repo names that aren't a single normal path component, to prevent
/// path traversal into the config dir (same guard as chat persistence).
fn validate_repo(repo: &str) -> Result<(), TaskError> {
    if repo.is_empty() {
        return Err(TaskError::InvalidRepo(repo.to_string()));
    }
    let mut components = Path::new(repo).components();
    match components.next() {
        Some(Component::Normal(_)) if components.next().is_none() => Ok(()),
        _ => Err(TaskError::InvalidRepo(repo.to_string())),
    }
}

/// Path to a repo's ledger file: `{dir}/tasks/{repo}.json`.
fn ledger_path(dir: &Path, repo: &str) -> Result<PathBuf, TaskError> {
    validate_repo(repo)?;
    Ok(dir.join("tasks").join(format!("{repo}.json")))
}

/// Load a repo's task ledger, returning an empty ledger if the file is missing.
pub fn load_tasks(dir: &Path, repo: &str) -> Result<TaskLedger, TaskError> {
    let path = ledger_path(dir, repo)?;
    if !path.exists() {
        return Ok(TaskLedger::default());
    }
    let contents = fs::read_to_string(&path)?;
    let ledger: TaskLedger = serde_json::from_str(&contents)?;
    Ok(ledger)
}

/// Save a repo's task ledger atomically (temp file + rename).
pub fn save_tasks(dir: &Path, repo: &str, ledger: &TaskLedger) -> Result<(), TaskError> {
    let path = ledger_path(dir, repo)?;
    let tasks_dir = path
        .parent()
        .ok_or_else(|| TaskError::InvalidRepo(repo.to_string()))?;
    fs::create_dir_all(tasks_dir)?;

    let temp_path = tasks_dir.join(format!("{repo}.json.tmp"));
    let json = serde_json::to_string_pretty(ledger)?;
    fs::write(&temp_path, &json)?;
    fs::rename(&temp_path, &path)?;
    Ok(())
}

/// List a repo's tasks, sorted by queue `order` (top of the queue first).
pub fn list_tasks(dir: &Path, repo: &str) -> Result<Vec<OverdriveTask>, TaskError> {
    let mut tasks = load_tasks(dir, repo)?.tasks;
    tasks.sort_by_key(|t| t.order);
    Ok(tasks)
}

/// Insert a task, or replace the existing task with the same id.
pub fn upsert_task(dir: &Path, repo: &str, task: OverdriveTask) -> Result<(), TaskError> {
    let mut ledger = load_tasks(dir, repo)?;
    match ledger.tasks.iter_mut().find(|t| t.id == task.id) {
        Some(existing) => *existing = task,
        None => ledger.tasks.push(task),
    }
    save_tasks(dir, repo, &ledger)
}

/// Remove a task by id. Missing ids are a no-op (idempotent delete).
pub fn delete_task(dir: &Path, repo: &str, task_id: &str) -> Result<(), TaskError> {
    let mut ledger = load_tasks(dir, repo)?;
    ledger.tasks.retain(|t| t.id != task_id);
    save_tasks(dir, repo, &ledger)
}

/// Reassign queue order from `ordered_ids` (position in the list becomes the
/// new `order`). Ids not present in `ordered_ids` keep their relative order and
/// are appended after the listed ones.
pub fn reorder_tasks(dir: &Path, repo: &str, ordered_ids: &[String]) -> Result<(), TaskError> {
    let mut ledger = load_tasks(dir, repo)?;

    let rank = |id: &str| ordered_ids.iter().position(|x| x == id);
    // Listed ids first (in the given order), then any leftovers after them.
    ledger.tasks.sort_by_key(|t| match rank(&t.id) {
        Some(pos) => (0usize, pos),
        None => (1usize, 0usize),
    });
    for (i, task) in ledger.tasks.iter_mut().enumerate() {
        task.order = i as u32;
    }
    save_tasks(dir, repo, &ledger)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;

    fn task(id: &str, order: u32) -> OverdriveTask {
        OverdriveTask {
            id: id.to_string(),
            repo_id: "myrepo".to_string(),
            title: format!("task {id}"),
            description: String::new(),
            verification: None,
            expect_green_harness: false,
            status: Default::default(),
            order,
            created_at: Utc::now(),
            run_ids: Vec::new(),
            source_ref: None,
        }
    }

    #[test]
    fn load_missing_returns_empty() {
        let dir = tempdir().unwrap();
        let ledger = load_tasks(dir.path(), "myrepo").unwrap();
        assert!(ledger.tasks.is_empty());
    }

    #[test]
    fn upsert_then_list_sorted_by_order() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("b", 1)).unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();

        let tasks = list_tasks(dir.path(), "myrepo").unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "a");
        assert_eq!(tasks[1].id, "b");
    }

    #[test]
    fn upsert_replaces_existing_id() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();

        let mut updated = task("a", 0);
        updated.title = "renamed".to_string();
        upsert_task(dir.path(), "myrepo", updated).unwrap();

        let tasks = list_tasks(dir.path(), "myrepo").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "renamed");
    }

    #[test]
    fn delete_removes_task() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();
        upsert_task(dir.path(), "myrepo", task("b", 1)).unwrap();

        delete_task(dir.path(), "myrepo", "a").unwrap();

        let tasks = list_tasks(dir.path(), "myrepo").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "b");
    }

    #[test]
    fn delete_missing_is_noop() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();
        delete_task(dir.path(), "myrepo", "does-not-exist").unwrap();
        assert_eq!(list_tasks(dir.path(), "myrepo").unwrap().len(), 1);
    }

    #[test]
    fn reorder_reassigns_order_by_position() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();
        upsert_task(dir.path(), "myrepo", task("b", 1)).unwrap();
        upsert_task(dir.path(), "myrepo", task("c", 2)).unwrap();

        // New order: c, a, b
        reorder_tasks(
            dir.path(),
            "myrepo",
            &["c".to_string(), "a".to_string(), "b".to_string()],
        )
        .unwrap();

        let tasks = list_tasks(dir.path(), "myrepo").unwrap();
        assert_eq!(tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["c", "a", "b"]);
        assert_eq!(tasks[0].order, 0);
        assert_eq!(tasks[1].order, 1);
        assert_eq!(tasks[2].order, 2);
    }

    #[test]
    fn reorder_appends_unlisted_ids_after_listed() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();
        upsert_task(dir.path(), "myrepo", task("b", 1)).unwrap();

        // Only mention "b"; "a" should land after it.
        reorder_tasks(dir.path(), "myrepo", &["b".to_string()]).unwrap();

        let tasks = list_tasks(dir.path(), "myrepo").unwrap();
        assert_eq!(tasks[0].id, "b");
        assert_eq!(tasks[1].id, "a");
    }

    #[test]
    fn ledger_persists_to_named_file() {
        let dir = tempdir().unwrap();
        upsert_task(dir.path(), "myrepo", task("a", 0)).unwrap();
        assert!(dir.path().join("tasks/myrepo.json").exists());
    }

    #[test]
    fn invalid_repo_names_are_rejected() {
        let dir = tempdir().unwrap();
        for bad in ["..", "a/b", "", "/etc"] {
            assert!(load_tasks(dir.path(), bad).is_err(), "should reject {bad:?}");
            assert!(upsert_task(dir.path(), bad, task("a", 0)).is_err());
        }
    }
}

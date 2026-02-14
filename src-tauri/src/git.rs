use crate::agents::build_login_shell_command;
use ignore::WalkBuilder;
use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct WorkspaceInfo {
    pub path: String,
    pub branch: String,
}

#[derive(Serialize, Clone)]
pub struct ChangedFile {
    pub status: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ChangedFilesResult {
    pub files: Vec<ChangedFile>,
    pub uncommitted: Vec<ChangedFile>,
    pub is_default_branch: bool,
}

#[derive(Serialize, Clone)]
pub struct MergeResult {
    pub success: bool,
    pub conflicts: Vec<String>,
    pub message: String,
}

pub const ANIMALS: &[&str] = &[
    "alpaca",
    "badger",
    "capybara",
    "dingo",
    "elephant",
    "falcon",
    "gazelle",
    "heron",
    "ibex",
    "jackal",
    "koala",
    "lemur",
    "meerkat",
    "narwhal",
    "ocelot",
    "pangolin",
    "quokka",
    "raccoon",
    "serval",
    "tapir",
    "urial",
    "viper",
    "walrus",
    "xerus",
    "yak",
    "zebu",
    "armadillo",
    "bison",
    "chinchilla",
    "dugong",
    "ermine",
    "ferret",
    "grouse",
    "hedgehog",
    "impala",
    "jaguar",
    "kestrel",
    "lynx",
    "marten",
    "newt",
    "osprey",
    "puma",
    "quail",
    "raven",
    "stoat",
    "toucan",
    "urchin",
    "vulture",
    "wombat",
    "xenops",
    "yapok",
    "zorilla",
];

pub fn pick_workspace_dir(repo_path: &str) -> Result<std::path::PathBuf, String> {
    let repo_name = std::path::Path::new(repo_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let workspaces_dir = if cfg!(debug_assertions) {
        "workspaces-dev"
    } else {
        "workspaces"
    };
    let base = std::path::PathBuf::from(home)
        .join("overseer")
        .join(workspaces_dir)
        .join(&repo_name);
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create workspaces dir: {}", e))?;

    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as usize;

    // Shuffle candidates using seed
    let mut candidates: Vec<&str> = ANIMALS.to_vec();
    let len = candidates.len();
    let mut s = seed;
    for i in (1..len).rev() {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let j = s % (i + 1);
        candidates.swap(i, j);
    }

    for name in &candidates {
        let dir = base.join(name);
        if !dir.exists() {
            return Ok(dir);
        }
    }

    // All base names taken — append version suffix
    for name in &candidates {
        for v in 1u32.. {
            let dir = base.join(format!("{}-v{}", name, v));
            if !dir.exists() {
                return Ok(dir);
            }
        }
    }

    Err("Could not find available workspace name".to_string())
}

pub fn get_default_branch(workspace_path: &str) -> String {
    // Check local main/master first, then remote tracking branches
    for candidate in &["main", "master", "origin/main", "origin/master"] {
        let check = Command::new("git")
            .args(["rev-parse", "--verify", candidate])
            .current_dir(workspace_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if let Ok(status) = check {
            if status.success() {
                return candidate.to_string();
            }
        }
    }

    "main".to_string()
}

pub fn parse_diff_name_status(stdout: &str) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() == 2 {
            files.push(ChangedFile {
                status: parts[0].chars().next().unwrap_or('?').to_string(),
                path: parts[1].to_string(),
            });
        }
    }
    files
}

#[tauri::command]
pub fn list_workspaces(repo_path: &str) -> Result<Vec<WorkspaceInfo>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut workspaces = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = path.to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = branch.to_string();
        } else if line.is_empty() && !current_path.is_empty() {
            workspaces.push(WorkspaceInfo {
                path: current_path.clone(),
                branch: if current_branch.is_empty() {
                    "HEAD (detached)".to_string()
                } else {
                    current_branch.clone()
                },
            });
            current_path.clear();
            current_branch.clear();
        }
    }

    // Handle last entry if no trailing newline
    if !current_path.is_empty() {
        workspaces.push(WorkspaceInfo {
            path: current_path,
            branch: if current_branch.is_empty() {
                "HEAD (detached)".to_string()
            } else {
                current_branch
            },
        });
    }

    Ok(workspaces)
}

#[tauri::command]
pub fn list_changed_files(workspace_path: &str) -> Result<ChangedFilesResult, String> {
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut uncommitted: Vec<ChangedFile> = Vec::new();

    // Detect current branch
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    // === Uncommitted changes (staged + unstaged against HEAD) ===
    // This shows what hasn't been committed yet
    let uncommitted_output = Command::new("git")
        .args(["diff", "--name-status", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git diff HEAD: {}", e))?;

    uncommitted.extend(parse_diff_name_status(&String::from_utf8_lossy(
        &uncommitted_output.stdout,
    )));

    // Include untracked files in uncommitted
    let untracked = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git ls-files: {}", e))?;

    let untracked_stdout = String::from_utf8_lossy(&untracked.stdout);
    for line in untracked_stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            uncommitted.push(ChangedFile {
                status: "?".to_string(),
                path: trimmed.to_string(),
            });
        }
    }

    // Sort uncommitted: tracked changes first (alphabetical), then untracked
    uncommitted.sort_by(|a, b| {
        let a_untracked = a.status == "?";
        let b_untracked = b.status == "?";
        a_untracked.cmp(&b_untracked).then(a.path.cmp(&b.path))
    });

    // === Branch changes (committed changes vs main branch) ===
    // Only relevant if not on default branch
    if !is_default_branch {
        let default_branch = get_default_branch(workspace_path);

        let merge_base = Command::new("git")
            .args(["merge-base", "HEAD", &default_branch])
            .current_dir(workspace_path)
            .output()
            .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

        if merge_base.status.success() {
            let base_ref = String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string();

            // Diff base ref against HEAD (committed changes only)
            let output = Command::new("git")
                .args(["diff", "--name-status", &base_ref, "HEAD"])
                .current_dir(workspace_path)
                .output()
                .map_err(|e| format!("Failed to run git diff: {}", e))?;

            files.extend(parse_diff_name_status(&String::from_utf8_lossy(
                &output.stdout,
            )));

            // Sort branch changes alphabetically
            files.sort_by(|a, b| a.path.cmp(&b.path));
        }
    }

    Ok(ChangedFilesResult {
        files,
        uncommitted,
        is_default_branch,
    })
}

#[tauri::command]
pub async fn add_workspace(repo_path: String, branch: String) -> Result<String, String> {
    let workspace_path = pick_workspace_dir(&repo_path)?;
    let workspace_str = workspace_path.to_string_lossy().to_string();

    let output = Command::new("git")
        .args(["worktree", "add", &workspace_str, "-b", &branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        // Try without -b (branch already exists)
        let output2 = Command::new("git")
            .args(["worktree", "add", &workspace_str, &branch])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output2.status.success() {
            return Err(String::from_utf8_lossy(&output2.stderr).to_string());
        }
    }

    // Resolve to absolute path
    let abs_path = std::fs::canonicalize(&workspace_path)
        .map_err(|e| format!("Failed to resolve path: {}", e))?;

    Ok(abs_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn archive_workspace(repo_path: String, workspace_path: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "remove", &workspace_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        // Force remove if needed
        let output2 = Command::new("git")
            .args(["worktree", "remove", "--force", &workspace_path])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output2.status.success() {
            return Err(String::from_utf8_lossy(&output2.stderr).to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn check_merge(workspace_path: &str) -> Result<MergeResult, String> {
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let feature_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    if feature_branch == "main" || feature_branch == "master" {
        return Ok(MergeResult {
            success: false,
            conflicts: vec![],
            message: "Already on the default branch, nothing to merge.".to_string(),
        });
    }

    let default_remote = get_default_branch(workspace_path);
    let default_branch = default_remote
        .strip_prefix("origin/")
        .unwrap_or(&default_remote)
        .to_string();

    // Check if fast-forward is possible
    let is_ancestor = Command::new("git")
        .args([
            "merge-base",
            "--is-ancestor",
            &default_branch,
            &feature_branch,
        ])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

    if is_ancestor.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!(
                "Clean fast-forward merge of '{}' into '{}'.",
                feature_branch, default_branch
            ),
        });
    }

    // Try merge-tree to check for conflicts without modifying anything
    let merge_tree = Command::new("git")
        .args([
            "merge-tree",
            "--write-tree",
            &default_branch,
            &feature_branch,
        ])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git merge-tree: {}", e))?;

    if merge_tree.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!(
                "Clean merge of '{}' into '{}'.",
                feature_branch, default_branch
            ),
        });
    }

    let mt_stdout = String::from_utf8_lossy(&merge_tree.stdout);
    let conflicts: Vec<String> = mt_stdout
        .lines()
        .filter(|l| l.contains('\t'))
        .filter_map(|l| l.split('\t').last().map(|s| s.to_string()))
        .collect();

    Ok(MergeResult {
        success: false,
        conflicts,
        message: format!(
            "Merge of '{}' into '{}' has conflicts that need resolution.",
            feature_branch, default_branch
        ),
    })
}

#[tauri::command]
pub fn merge_into_main(workspace_path: &str) -> Result<MergeResult, String> {
    // Get current branch name (the feature branch)
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let feature_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    if feature_branch == "main" || feature_branch == "master" {
        return Ok(MergeResult {
            success: false,
            conflicts: vec![],
            message: "Already on the default branch, nothing to merge.".to_string(),
        });
    }

    // Determine default branch name
    let default_remote = get_default_branch(workspace_path);
    let default_branch = default_remote
        .strip_prefix("origin/")
        .unwrap_or(&default_remote)
        .to_string();

    // Find the main workspace path by listing all workspaces and finding the one
    // checked out on the default branch
    let wt_output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to list workspaces: {}", e))?;

    let wt_stdout = String::from_utf8_lossy(&wt_output.stdout);
    let mut main_workspace_path: Option<String> = None;
    let mut current_wt_path = String::new();

    for line in wt_stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_wt_path = path.to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if branch == default_branch {
                main_workspace_path = Some(current_wt_path.clone());
            }
        } else if line.is_empty() {
            current_wt_path.clear();
        }
    }

    let main_path = main_workspace_path.ok_or_else(|| {
        format!(
            "Could not find a workspace checked out on '{}'. \
             Make sure the main branch has a workspace.",
            default_branch
        )
    })?;

    // Run git merge from the main workspace directory
    let merge_output = Command::new("git")
        .args([
            "merge",
            &feature_branch,
            "--no-edit",
            "-m",
            &format!("Merge branch '{}'", feature_branch),
        ])
        .current_dir(&main_path)
        .output()
        .map_err(|e| format!("Failed to run git merge: {}", e))?;

    if merge_output.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!(
                "Successfully merged '{}' into '{}'.",
                feature_branch, default_branch
            ),
        });
    }

    // Merge failed — check if it's due to conflicts
    let stderr = String::from_utf8_lossy(&merge_output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&merge_output.stdout).to_string();

    // Try to extract conflict file names from the output
    let conflicts: Vec<String> = stdout
        .lines()
        .filter(|l| l.starts_with("CONFLICT"))
        .map(|l| l.to_string())
        .collect();

    if !conflicts.is_empty() {
        // Abort the failed merge so we don't leave the main workspace dirty
        let _ = Command::new("git")
            .args(["merge", "--abort"])
            .current_dir(&main_path)
            .output();

        return Ok(MergeResult {
            success: false,
            conflicts,
            message: format!(
                "Merge of '{}' into '{}' has conflicts that need resolution.",
                feature_branch, default_branch
            ),
        });
    }

    // Abort any partial merge state
    let _ = Command::new("git")
        .args(["merge", "--abort"])
        .current_dir(&main_path)
        .output();

    Ok(MergeResult {
        success: false,
        conflicts: vec![],
        message: format!("Merge failed: {} {}", stderr, stdout),
    })
}

#[tauri::command]
pub fn get_file_diff(
    workspace_path: &str,
    file_path: &str,
    file_status: &str,
) -> Result<String, String> {
    // Untracked and newly added files: diff against /dev/null to show full content as additions
    if file_status == "?" || file_status == "A" {
        let output = Command::new("git")
            .args(["diff", "--no-index", "/dev/null", file_path])
            .current_dir(workspace_path)
            .output()
            .map_err(|e| format!("Failed to run git diff: {}", e))?;

        // git diff --no-index exits with 1 when files differ, which is expected
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    let base_ref = if is_default_branch {
        "HEAD".to_string()
    } else {
        let default_branch = get_default_branch(workspace_path);

        let merge_base = Command::new("git")
            .args(["merge-base", "HEAD", &default_branch])
            .current_dir(workspace_path)
            .output()
            .map_err(|e| format!("Failed to run git merge-base: {}", e))?;

        if merge_base.status.success() {
            String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string()
        } else {
            "HEAD".to_string()
        }
    };

    let output = Command::new("git")
        .args(["diff", &base_ref, "--", file_path])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get diff for uncommitted changes (staged + unstaged vs HEAD)
#[tauri::command]
pub fn get_uncommitted_diff(
    workspace_path: &str,
    file_path: &str,
    file_status: &str,
) -> Result<String, String> {
    // Untracked files: diff against /dev/null to show full content as additions
    if file_status == "?" {
        let output = Command::new("git")
            .args(["diff", "--no-index", "/dev/null", file_path])
            .current_dir(workspace_path)
            .output()
            .map_err(|e| format!("Failed to run git diff: {}", e))?;

        // git diff --no-index exits with 1 when files differ, which is expected
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // Diff against HEAD (uncommitted changes)
    let output = Command::new("git")
        .args(["diff", "HEAD", "--", file_path])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Serialize)]
pub struct PrStatus {
    pub number: i64,
    pub state: String,
    pub url: String,
    pub is_draft: bool,
}

#[tauri::command]
pub async fn get_pr_status(
    workspace_path: String,
    branch: String,
    agent_shell: Option<String>,
) -> Result<Option<PrStatus>, String> {
    let args = vec![
        "pr".to_string(),
        "view".to_string(),
        branch,
        "--json".to_string(),
        "number,state,url,isDraft".to_string(),
    ];

    let mut cmd = build_login_shell_command("gh", &args, Some(&workspace_path), agent_shell.as_deref())?;

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse gh output: {}", e))?;

    Ok(Some(PrStatus {
        number: parsed["number"].as_i64().unwrap_or(0),
        state: parsed["state"].as_str().unwrap_or("OPEN").to_string(),
        url: parsed["url"].as_str().unwrap_or("").to_string(),
        is_draft: parsed["isDraft"].as_bool().unwrap_or(false),
    }))
}

#[tauri::command]
pub fn rename_branch(workspace_path: &str, new_name: &str) -> Result<(), String> {
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    if current_branch == "main" || current_branch == "master" {
        return Err("Cannot rename the main branch".to_string());
    }

    let output = Command::new("git")
        .args(["branch", "-m", new_name])
        .current_dir(workspace_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn delete_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["branch", "-d", branch_name])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

/// List all files in a directory, respecting .gitignore.
/// Returns relative paths from the workspace root.
/// Marked async so Tauri runs it on a background thread pool.
#[tauri::command]
pub async fn list_files(workspace_path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let root = std::path::Path::new(&workspace_path);

    let walker = WalkBuilder::new(&workspace_path)
        .hidden(false) // Include hidden files
        .git_ignore(true) // Respect .gitignore
        .git_global(true) // Respect global gitignore
        .git_exclude(true) // Respect .git/info/exclude
        .build();

    for entry in walker {
        match entry {
            Ok(e) => {
                if e.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                    if let Ok(rel) = e.path().strip_prefix(root) {
                        files.push(rel.to_string_lossy().to_string());
                    }
                }
            }
            Err(_) => continue,
        }
    }

    files.sort();
    Ok(files)
}

/// Check if a directory is a git repository.
#[tauri::command]
pub fn is_git_repo(path: &str) -> bool {
    std::path::Path::new(path).join(".git").exists()
}

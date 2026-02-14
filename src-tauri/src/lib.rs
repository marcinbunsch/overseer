mod agents;
mod git;
mod logging;
mod pty;

use std::process::Command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, WindowEvent};

#[tauri::command]
async fn show_main_window(window: tauri::Window) {
    window.show().unwrap();
}

#[tauri::command]
async fn is_debug_mode() -> bool {
    std::env::var("OVERSEER_DEBUG").is_ok()
}

#[tauri::command]
async fn open_external(command: String, path: String) -> Result<(), String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }
    Command::new(parts[0])
        .args(&parts[1..])
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to run '{}': {}", command, e))?;
    Ok(())
}

#[derive(serde::Serialize)]
struct CommandCheckResult {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn check_command_exists(command: String) -> CommandCheckResult {
    // Try running the command with --version to check if it exists
    let output = Command::new(&command).arg("--version").output();

    match output {
        Ok(result) => {
            if result.status.success() {
                // Extract first line of stdout as version
                let stdout = String::from_utf8_lossy(&result.stdout);
                let version = stdout.lines().next().map(|s| s.trim().to_string());
                CommandCheckResult {
                    available: true,
                    version,
                    error: None,
                }
            } else {
                // Command exists but --version failed, try without args
                let simple_check = Command::new(&command).output();
                match simple_check {
                    Ok(_) => CommandCheckResult {
                        available: true,
                        version: None,
                        error: None,
                    },
                    Err(e) => CommandCheckResult {
                        available: false,
                        version: None,
                        error: Some(format!("{}", e)),
                    },
                }
            }
        }
        Err(e) => {
            // Check if it's a "not found" error
            let error_msg = format!("{}", e);
            CommandCheckResult {
                available: false,
                version: None,
                error: Some(error_msg),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(agents::AgentProcessMap::default())
        .manage(agents::CodexServerMap::default())
        .manage(agents::CopilotServerMap::default())
        .manage(agents::GeminiServerMap::default())
        .manage(agents::OpenCodeServerMap::default())
        .manage(pty::PtyMap::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .menu(|handle| {
            let app_menu = SubmenuBuilder::new(handle, "Overseer")
                .about(None)
                .separator()
                .item(
                    &MenuItemBuilder::new("Settings...")
                        .id("settings")
                        .accelerator("CmdOrCtrl+,")
                        .build(handle)?,
                )
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                let _ = app.emit("menu:settings", ());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git::list_workspaces,
            git::list_changed_files,
            git::list_files,
            git::add_workspace,
            git::archive_workspace,
            git::check_merge,
            git::merge_into_main,
            git::rename_branch,
            git::get_file_diff,
            git::get_uncommitted_diff,
            git::get_pr_status,
            git::delete_branch,
            git::is_git_repo,
            agents::claude::start_agent,
            agents::claude::stop_agent,
            agents::claude::agent_stdin,
            agents::claude::list_running,
            agents::codex::start_codex_server,
            agents::codex::stop_codex_server,
            agents::codex::codex_stdin,
            agents::copilot::start_copilot_server,
            agents::copilot::stop_copilot_server,
            agents::copilot::copilot_stdin,
            agents::gemini::start_gemini_server,
            agents::gemini::stop_gemini_server,
            agents::gemini::gemini_stdin,
            agents::opencode::start_opencode_server,
            agents::opencode::stop_opencode_server,
            agents::opencode::get_opencode_port,
            agents::opencode::get_opencode_password,
            agents::opencode::opencode_get_models,
            agents::opencode::opencode_list_models,
            agents::opencode::opencode_subscribe_events,
            agents::opencode::opencode_unsubscribe_events,
            open_external,
            check_command_exists,
            show_main_window,
            is_debug_mode,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the default close behavior so the frontend can handle it
                api.prevent_close();
                // Emit an event to the frontend to handle the close request
                let _ = window.emit("window-close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Ready = event {
                #[cfg(target_os = "macos")]
                if cfg!(debug_assertions) {
                    set_macos_dev_icon();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use crate::agents::AgentExit;
    use crate::check_command_exists;
    use crate::git::{
        delete_branch, parse_diff_name_status, rename_branch, ChangedFile, MergeResult, PrStatus,
        WorkspaceInfo, ANIMALS,
    };
    use std::process::Command;

    #[test]
    fn parse_diff_name_status_basic() {
        let input = "M\tsrc/main.rs\nA\tsrc/new.rs\nD\told.txt\n";
        let files = parse_diff_name_status(input);

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[1].status, "A");
        assert_eq!(files[1].path, "src/new.rs");
        assert_eq!(files[2].status, "D");
        assert_eq!(files[2].path, "old.txt");
    }

    #[test]
    fn parse_diff_name_status_empty_input() {
        let files = parse_diff_name_status("");
        assert!(files.is_empty());
    }

    #[test]
    fn parse_diff_name_status_ignores_malformed_lines() {
        let input = "M\tgood.rs\nbadline\nA\talso_good.rs\n";
        let files = parse_diff_name_status(input);

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "good.rs");
        assert_eq!(files[1].path, "also_good.rs");
    }

    #[test]
    fn parse_diff_name_status_renamed_file() {
        let input = "R\told_name.rs\tnew_name.rs\n";
        let files = parse_diff_name_status(input);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "R");
        assert_eq!(files[0].path, "old_name.rs\tnew_name.rs");
    }

    #[test]
    fn parse_diff_name_status_path_with_spaces() {
        let input = "M\tpath with spaces/file.txt\n";
        let files = parse_diff_name_status(input);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "path with spaces/file.txt");
    }

    #[test]
    fn animals_list_is_not_empty() {
        assert!(!ANIMALS.is_empty());
        for animal in ANIMALS {
            assert!(!animal.is_empty());
        }
    }

    #[test]
    fn animals_list_has_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for animal in ANIMALS {
            assert!(seen.insert(*animal), "Duplicate animal name: {}", animal);
        }
    }

    #[test]
    fn workspace_info_serializes() {
        let info = WorkspaceInfo {
            path: "/tmp/test".to_string(),
            branch: "main".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"path\":\"/tmp/test\""));
        assert!(json.contains("\"branch\":\"main\""));
    }

    #[test]
    fn changed_file_serializes() {
        let file = ChangedFile {
            status: "M".to_string(),
            path: "src/lib.rs".to_string(),
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(json.contains("\"status\":\"M\""));
        assert!(json.contains("\"path\":\"src/lib.rs\""));
    }

    #[test]
    fn merge_result_serializes() {
        let result = MergeResult {
            success: true,
            conflicts: vec!["file.rs".to_string()],
            message: "Done".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"conflicts\":[\"file.rs\"]"));
        assert!(json.contains("\"message\":\"Done\""));
    }

    #[test]
    fn pr_status_serializes() {
        let status = PrStatus {
            number: 42,
            state: "OPEN".to_string(),
            url: "https://github.com/org/repo/pull/42".to_string(),
            is_draft: false,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"number\":42"));
        assert!(json.contains("\"state\":\"OPEN\""));
        assert!(json.contains("\"is_draft\":false"));
    }

    #[test]
    fn agent_exit_serializes() {
        let exit = AgentExit {
            code: 1,
            signal: Some(9),
        };
        let json = serde_json::to_string(&exit).unwrap();
        assert!(json.contains("\"code\":1"));
        assert!(json.contains("\"signal\":9"));
    }

    #[test]
    fn agent_exit_serializes_without_signal() {
        let exit = AgentExit {
            code: 0,
            signal: None,
        };
        let json = serde_json::to_string(&exit).unwrap();
        assert!(json.contains("\"code\":0"));
        assert!(json.contains("\"signal\":null"));
    }

    fn init_temp_repo(branch_name: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();

        // Use GIT_CONFIG_GLOBAL to isolate from user's global config
        // This prevents flaky tests due to parallel execution affecting git state
        let empty_config = path.join(".gitconfig-empty");
        std::fs::write(&empty_config, "").unwrap();

        Command::new("git")
            .args(["init", "-b", branch_name])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        // Need at least one commit so HEAD is valid
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        dir
    }

    #[test]
    fn rename_branch_blocks_main() {
        let dir = init_temp_repo("main");
        let result = rename_branch(dir.path().to_str().unwrap(), "new-name");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot rename the main branch");
    }

    #[test]
    fn rename_branch_blocks_master() {
        let dir = init_temp_repo("master");
        let result = rename_branch(dir.path().to_str().unwrap(), "new-name");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot rename the main branch");
    }

    #[test]
    fn rename_branch_allows_feature_branch() {
        let dir = init_temp_repo("feature-branch");
        let result = rename_branch(dir.path().to_str().unwrap(), "renamed-branch");
        assert!(result.is_ok());

        let output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(branch, "renamed-branch");
    }

    #[test]
    fn delete_branch_removes_merged_branch() {
        let dir = init_temp_repo("main");
        let path = dir.path().to_str().unwrap();

        // Create and checkout a feature branch
        Command::new("git")
            .args(["checkout", "-b", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();

        // Make a commit on feature branch
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "feature commit"])
            .current_dir(path)
            .output()
            .unwrap();

        // Switch back to main and merge
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["merge", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();

        // Now delete the branch
        let result = delete_branch(path, "feature-to-delete");
        assert!(result.is_ok());

        // Verify branch no longer exists
        let output = Command::new("git")
            .args(["branch", "--list", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).trim().is_empty());
    }

    #[test]
    fn delete_branch_fails_for_unmerged_branch() {
        let dir = init_temp_repo("main");
        let path = dir.path().to_str().unwrap();

        // Create a feature branch with unmerged changes
        Command::new("git")
            .args(["checkout", "-b", "unmerged-feature"])
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "unmerged commit"])
            .current_dir(path)
            .output()
            .unwrap();

        // Switch back to main (don't merge)
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(path)
            .output()
            .unwrap();

        // Try to delete - should fail with -d (safe delete)
        let result = delete_branch(path, "unmerged-feature");
        assert!(result.is_err());
    }

    #[test]
    fn delete_branch_fails_for_nonexistent_branch() {
        let dir = init_temp_repo("main");
        let result = delete_branch(dir.path().to_str().unwrap(), "nonexistent-branch");
        assert!(result.is_err());
    }

    #[test]
    fn check_command_exists_finds_git() {
        // git should be available on all systems running these tests
        let result = check_command_exists("git".to_string());
        assert!(result.available);
        assert!(result.version.is_some());
        assert!(result.error.is_none());
    }

    #[test]
    fn check_command_exists_reports_missing_command() {
        // A command that definitely doesn't exist
        let result =
            check_command_exists("this-command-definitely-does-not-exist-12345".to_string());
        assert!(!result.available);
        assert!(result.version.is_none());
        assert!(result.error.is_some());
    }

    #[test]
    fn check_command_result_serializes() {
        let result = crate::CommandCheckResult {
            available: true,
            version: Some("1.0.0".to_string()),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"version\":\"1.0.0\""));
    }
}

#[cfg(target_os = "macos")]
fn set_macos_dev_icon() {
    use objc2::AnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSData;

    unsafe {
        let bytes = include_bytes!("../icons/icon-dev.png");

        let data = NSData::with_bytes(bytes);
        let image = NSImage::initWithData(NSImage::alloc(), &data);
        if let Some(image) = image {
            if let Some(mtm) = MainThreadMarker::new() {
                let app = NSApplication::sharedApplication(mtm);
                app.setApplicationIconImage(Some(&image));
            }
        }
    }
}

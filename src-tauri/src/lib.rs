mod agents;
mod approvals;
mod chat_session;
mod git;
mod logging;
mod persistence;
mod pty;

use overseer_core::shell::build_login_shell_command;
use overseer_core::overseer_actions::{extract_overseer_blocks, OverseerAction};
use overseer_core::paths;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WindowEvent};

#[tauri::command]
async fn show_main_window(window: tauri::Window) {
    window.show().unwrap();
}

#[tauri::command]
async fn is_debug_mode() -> bool {
    std::env::var("OVERSEER_DEBUG").is_ok()
}

#[tauri::command]
async fn is_demo_mode() -> bool {
    std::env::var("OVERSEER_DEMO").is_ok()
}

#[tauri::command]
async fn get_home_dir() -> Result<String, String> {
    paths::get_home_dir()
}

/// Result of extracting overseer action blocks from content.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractOverseerBlocksResult {
    clean_content: String,
    actions: Vec<OverseerAction>,
}

/// Extract overseer action blocks from content.
///
/// Returns the cleaned content (with blocks removed) and the list of parsed actions.
#[tauri::command]
fn extract_overseer_blocks_cmd(content: String) -> ExtractOverseerBlocksResult {
    let (clean_content, actions) = extract_overseer_blocks(&content);
    ExtractOverseerBlocksResult {
        clean_content,
        actions,
    }
}

#[tauri::command]
async fn open_external(command: String, path: String) -> Result<(), String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }
    // Use login shell to ensure PATH includes user's shell profile (e.g., for VS Code's `code` command)
    let mut args: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();
    args.push(path);
    let mut cmd = build_login_shell_command(parts[0], &args, None, None)?;
    cmd.spawn()
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
async fn check_command_exists(command: String) -> CommandCheckResult {
    let run_command = |args: Vec<String>| -> Result<std::process::Output, String> {
        let mut cmd = build_login_shell_command(&command, &args, None, None)?;
        cmd.output()
            .map_err(|e| format!("Failed to run '{}': {}", command, e))
    };

    // Try running the command with --version to check if it exists
    match run_command(vec!["--version".to_string()]) {
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
                match run_command(vec![]) {
                    Ok(result) if result.status.success() => CommandCheckResult {
                        available: true,
                        version: None,
                        error: None,
                    },
                    Ok(result) => {
                        // Command likely doesn't exist - extract error from stderr
                        let stderr = String::from_utf8_lossy(&result.stderr);
                        CommandCheckResult {
                            available: false,
                            version: None,
                            error: Some(stderr.trim().to_string()),
                        }
                    }
                    Err(e) => CommandCheckResult {
                        available: false,
                        version: None,
                        error: Some(e),
                    },
                }
            }
        }
        Err(e) => CommandCheckResult {
            available: false,
            version: None,
            error: Some(e),
        },
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
        .manage(approvals::ProjectApprovalManager::default())
        .manage(chat_session::ChatSessionManager::default())
        .manage(persistence::PersistenceConfig::default())
        .manage(pty::PtyMap::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .menu(|handle| {
            // Build custom quit menu item so we can intercept Cmd+Q
            let quit_item = MenuItemBuilder::new("Quit Overseer")
                .id("quit")
                .accelerator("CmdOrCtrl+Q")
                .build(handle)?;

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
                .item(&quit_item)
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
            } else if event.id() == "quit" {
                // Emit quit request to frontend so it can show confirmation dialog
                // The frontend will call window.destroy() when ready to actually quit
                let _ = app.emit("menu:quit", ());
            }
        })
        .setup(|app| {
            // Determine config directory: ~/.config/overseer-dev (dev) or ~/.config/overseer (prod)
            // This matches the frontend's getConfigPath() behavior
            let config_dir = if let Some(home) = app.path().home_dir().ok() {
                let dir_name = if cfg!(debug_assertions) {
                    "overseer-dev"
                } else {
                    "overseer"
                };
                home.join(".config").join(dir_name)
            } else {
                // Fallback to Tauri's config_dir if home is not available
                app.path().config_dir().ok().unwrap_or_default()
            };

            // Set up file logging to config_dir/logs/
            let log_dir = config_dir.join("logs");
            // Create logs directory if it doesn't exist
            let _ = std::fs::create_dir_all(&log_dir);

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Folder {
                            path: log_dir,
                            file_name: Some("overseer".into()),
                        },
                    ))
                    .build(),
            )?;

            // Set up the config directory for approvals persistence
            let approval_manager = app.state::<approvals::ProjectApprovalManager>();
            approval_manager.set_config_dir(config_dir.clone());

            // Set up the config directory for chat session persistence
            let chat_session_manager = app.state::<chat_session::ChatSessionManager>();
            chat_session_manager.set_config_dir(config_dir.clone());

            // Set up the config directory for general persistence
            let persistence_config = app.state::<persistence::PersistenceConfig>();
            persistence_config.set_config_dir(config_dir);

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
            is_demo_mode,
            get_home_dir,
            extract_overseer_blocks_cmd,
            approvals::load_project_approvals,
            approvals::add_approval,
            approvals::remove_approval,
            approvals::clear_project_approvals,
            chat_session::register_chat_session,
            chat_session::unregister_chat_session,
            chat_session::append_chat_event,
            chat_session::load_chat_events,
            chat_session::load_chat_metadata,
            chat_session::save_chat_metadata,
            chat_session::add_user_message,
            persistence::save_chat,
            persistence::load_chat,
            persistence::delete_chat,
            persistence::list_chat_ids,
            persistence::migrate_chat_if_needed,
            persistence::save_chat_index,
            persistence::load_chat_index,
            persistence::upsert_chat_entry,
            persistence::remove_chat_entry,
            persistence::save_workspace_state,
            persistence::load_workspace_state,
            persistence::save_project_registry,
            persistence::load_project_registry,
            persistence::upsert_project,
            persistence::remove_project,
            persistence::save_json_config,
            persistence::load_json_config,
            persistence::config_file_exists,
            persistence::get_config_dir,
            persistence::archive_chat_dir,
            persistence::ensure_chat_dir,
            persistence::remove_chat_file,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .on_window_event(|_window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the default close behavior so the frontend can handle it
                // The frontend uses window.onCloseRequested() to show confirmation dialogs
                // and calls window.destroy() when ready to actually close
                api.prevent_close();
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

/// Tests for Tauri-specific functionality.
/// Core library tests are in overseer-core.
#[cfg(test)]
mod tests {
    use crate::check_command_exists;
    use crate::git::PrStatus;

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
    fn check_command_exists_finds_git() {
        // git should be available on all systems running these tests
        let result = tauri::async_runtime::block_on(check_command_exists("git".to_string()));
        assert!(result.available);
        assert!(result.version.is_some());
        assert!(result.error.is_none());
    }

    #[test]
    fn check_command_exists_reports_missing_command() {
        // A command that definitely doesn't exist
        let result = tauri::async_runtime::block_on(check_command_exists(
            "this-command-definitely-does-not-exist-12345".to_string(),
        ));
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

use std::env;

/// Return the user's home directory path.
///
/// Uses HOME on Unix-like systems and USERPROFILE on Windows.
pub fn get_home_dir() -> Result<String, String> {
    if let Ok(home) = env::var("HOME") {
        if !home.is_empty() {
            return Ok(home);
        }
    }

    if let Ok(profile) = env::var("USERPROFILE") {
        if !profile.is_empty() {
            return Ok(profile);
        }
    }

    Err("Home directory not set".to_string())
}

/// Expand a raw `CLAUDE_CONFIG_DIR` value against `home`.
///
/// The value comes from project settings and isn't shell-expanded, so a leading
/// `~`/`$HOME` is replaced with `home` here. Blank or `None` yields `None`; an
/// absolute path passes through, trimmed.
pub fn expand_config_dir(raw: Option<&str>, home: &str) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }

    let home = home.trim_end_matches('/');
    let expanded = if trimmed == "~" || trimmed == "$HOME" {
        home.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("$HOME/") {
        format!("{home}/{rest}")
    } else {
        trimmed.to_string()
    };
    Some(expanded)
}

/// The effective Claude config dir: the expanded `CLAUDE_CONFIG_DIR` override, or
/// the default `<home>/.claude`. This is the directory that holds `skills/`,
/// `.credentials.json`, etc.
///
/// Returns `None` only when there's no override and no home to build a default
/// from.
pub fn resolve_claude_config_dir(raw: Option<&str>, home: Option<&str>) -> Option<String> {
    if let Some(dir) = expand_config_dir(raw, home.unwrap_or_default()) {
        return Some(dir);
    }
    home.map(|home| format!("{}/.claude", home.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::{expand_config_dir, get_home_dir, resolve_claude_config_dir};
    use std::env;
    use std::sync::Mutex;

    const HOME: &str = "/Users/dev";

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<F: FnOnce()>(home: Option<&str>, userprofile: Option<&str>, f: F) {
        let _guard = ENV_LOCK.lock().unwrap();
        let prev_home = env::var("HOME").ok();
        let prev_userprofile = env::var("USERPROFILE").ok();

        match home {
            Some(value) => env::set_var("HOME", value),
            None => env::remove_var("HOME"),
        }
        match userprofile {
            Some(value) => env::set_var("USERPROFILE", value),
            None => env::remove_var("USERPROFILE"),
        }

        f();

        match prev_home {
            Some(value) => env::set_var("HOME", value),
            None => env::remove_var("HOME"),
        }
        match prev_userprofile {
            Some(value) => env::set_var("USERPROFILE", value),
            None => env::remove_var("USERPROFILE"),
        }
    }

    #[test]
    fn get_home_dir_prefers_home() {
        with_env(Some("/tmp/home"), Some("/tmp/profile"), || {
            let home = get_home_dir().expect("home dir");
            assert_eq!(home, "/tmp/home");
        });
    }

    #[test]
    fn get_home_dir_falls_back_to_userprofile() {
        with_env(None, Some("/tmp/profile"), || {
            let home = get_home_dir().expect("home dir");
            assert_eq!(home, "/tmp/profile");
        });
    }

    #[test]
    fn expand_config_dir_expands_tilde_and_home_var() {
        assert_eq!(
            expand_config_dir(Some("~/.claude-work"), HOME),
            Some("/Users/dev/.claude-work".to_string())
        );
        assert_eq!(
            expand_config_dir(Some("$HOME/.claude-work"), HOME),
            Some("/Users/dev/.claude-work".to_string())
        );
    }

    #[test]
    fn expand_config_dir_bare_tilde_and_home_become_home() {
        assert_eq!(expand_config_dir(Some("~"), HOME), Some(HOME.to_string()));
        assert_eq!(
            expand_config_dir(Some("$HOME"), HOME),
            Some(HOME.to_string())
        );
    }

    #[test]
    fn expand_config_dir_passes_absolute_through_trimmed() {
        assert_eq!(
            expand_config_dir(Some("  /opt/claude-work  "), HOME),
            Some("/opt/claude-work".to_string())
        );
    }

    #[test]
    fn expand_config_dir_blank_and_none_yield_none() {
        assert_eq!(expand_config_dir(Some(""), HOME), None);
        assert_eq!(expand_config_dir(Some("   "), HOME), None);
        assert_eq!(expand_config_dir(None, HOME), None);
    }

    #[test]
    fn expand_config_dir_normalizes_trailing_slash_on_home() {
        assert_eq!(
            expand_config_dir(Some("~/.claude"), "/Users/dev/"),
            Some("/Users/dev/.claude".to_string())
        );
    }

    #[test]
    fn resolve_claude_config_dir_prefers_override() {
        assert_eq!(
            resolve_claude_config_dir(Some("~/.claude-work"), Some(HOME)),
            Some("/Users/dev/.claude-work".to_string())
        );
    }

    #[test]
    fn resolve_claude_config_dir_defaults_to_home_dot_claude() {
        assert_eq!(
            resolve_claude_config_dir(None, Some(HOME)),
            Some("/Users/dev/.claude".to_string())
        );
        // Blank override also falls back to the default.
        assert_eq!(
            resolve_claude_config_dir(Some("   "), Some(HOME)),
            Some("/Users/dev/.claude".to_string())
        );
        // Trailing slash on home doesn't double up.
        assert_eq!(
            resolve_claude_config_dir(None, Some("/Users/dev/")),
            Some("/Users/dev/.claude".to_string())
        );
    }

    #[test]
    fn resolve_claude_config_dir_without_home_needs_absolute_override() {
        assert_eq!(resolve_claude_config_dir(None, None), None);
        assert_eq!(
            resolve_claude_config_dir(Some("/opt/claude"), None),
            Some("/opt/claude".to_string())
        );
    }
}

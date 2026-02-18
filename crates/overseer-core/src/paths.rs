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

#[cfg(test)]
mod tests {
    use super::get_home_dir;
    use std::env;
    use std::sync::Mutex;

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
}

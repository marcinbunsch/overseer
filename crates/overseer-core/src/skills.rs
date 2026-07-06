//! Claude Code skill discovery.
//!
//! Skills are Markdown-defined capabilities the Claude agent can invoke. Each
//! skill is a directory containing a `SKILL.md` file whose YAML frontmatter
//! declares a `name` and `description`. They are discovered from two locations:
//!
//! - Project: `<workspace>/.claude/skills/<skill>/SKILL.md`
//! - User:    `<home>/.claude/skills/<skill>/SKILL.md`
//!
//! A project skill shadows a user skill with the same name.

use serde::Serialize;
use std::fs;
use std::path::Path;

/// A discovered Claude skill.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// The skill's invocation name (from frontmatter `name`, falling back to the directory name).
    pub name: String,
    /// One-line summary used to decide relevance (from frontmatter `description`).
    pub description: String,
    /// Where the skill was found: "project" or "user".
    pub source: String,
}

/// Discover all skills available to a Claude agent running in `workspace_path`.
///
/// Returns skills sorted by name. Project skills take precedence over user
/// skills of the same name.
pub fn list_skills(workspace_path: &str, home_dir: Option<&str>) -> Vec<Skill> {
    let mut skills: Vec<Skill> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Project skills first so they win on name collisions.
    let project_dir = Path::new(workspace_path).join(".claude").join("skills");
    collect_skills(&project_dir, "project", &mut skills, &mut seen);

    if let Some(home) = home_dir {
        let user_dir = Path::new(home).join(".claude").join("skills");
        collect_skills(&user_dir, "user", &mut skills, &mut seen);
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// Scan a `.claude/skills` directory, appending any skills not already `seen`.
fn collect_skills(
    skills_dir: &Path,
    source: &str,
    out: &mut Vec<Skill>,
    seen: &mut std::collections::HashSet<String>,
) {
    let entries = match fs::read_dir(skills_dir) {
        Ok(e) => e,
        Err(_) => return, // Directory doesn't exist — no skills from this source.
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        let contents = match fs::read_to_string(&skill_file) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let dir_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let (name, description) = parse_frontmatter(&contents, &dir_name);

        if seen.insert(name.clone()) {
            out.push(Skill {
                name,
                description,
                source: source.to_string(),
            });
        }
    }
}

/// Extract `name` and `description` from a SKILL.md's YAML frontmatter.
///
/// Falls back to `dir_name` for the name and an empty description when fields
/// are absent. This is a deliberately small line-based parser — skill
/// frontmatter only needs these two scalar fields.
fn parse_frontmatter(contents: &str, dir_name: &str) -> (String, String) {
    let mut name = dir_name.to_string();
    let mut description = String::new();

    let trimmed = contents.trim_start();
    if !trimmed.starts_with("---") {
        return (name, description);
    }

    // Walk lines between the opening `---` and the closing `---`.
    let mut lines = trimmed.lines();
    lines.next(); // opening ---
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            let v = unquote(value.trim());
            if !v.is_empty() {
                name = v;
            }
        } else if let Some(value) = line.strip_prefix("description:") {
            description = unquote(value.trim());
        }
    }

    (name, description)
}

/// Strip a single layer of matching surrounding quotes from a frontmatter value.
fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if value.len() >= 2
        && ((bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\''))
    {
        return value[1..value.len() - 1].to_string();
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_skill(root: &Path, dir: &str, body: &str) {
        let skill_dir = root.join(".claude").join("skills").join(dir);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn parses_name_and_description() {
        let (name, desc) = parse_frontmatter(
            "---\nname: code-review\ndescription: Review the diff for bugs.\n---\n\nBody here.",
            "fallback",
        );
        assert_eq!(name, "code-review");
        assert_eq!(desc, "Review the diff for bugs.");
    }

    #[test]
    fn falls_back_to_dir_name_without_frontmatter() {
        let (name, desc) = parse_frontmatter("# Just a heading\n", "my-skill");
        assert_eq!(name, "my-skill");
        assert_eq!(desc, "");
    }

    #[test]
    fn strips_surrounding_quotes() {
        let (name, desc) =
            parse_frontmatter("---\nname: \"x\"\ndescription: 'hi there'\n---", "d");
        assert_eq!(name, "x");
        assert_eq!(desc, "hi there");
    }

    #[test]
    fn lists_project_and_user_skills_sorted() {
        let project = tempdir();
        let home = tempdir();
        write_skill(
            project.path(),
            "verify",
            "---\nname: verify\ndescription: Verify a change.\n---",
        );
        write_skill(
            home.path(),
            "deep-research",
            "---\nname: deep-research\ndescription: Research deeply.\n---",
        );

        let skills = list_skills(
            project.path().to_str().unwrap(),
            home.path().to_str(),
        );
        assert_eq!(skills.len(), 2);
        // Sorted alphabetically by name.
        assert_eq!(skills[0].name, "deep-research");
        assert_eq!(skills[0].source, "user");
        assert_eq!(skills[1].name, "verify");
        assert_eq!(skills[1].source, "project");
    }

    #[test]
    fn project_skill_shadows_user_skill_of_same_name() {
        let project = tempdir();
        let home = tempdir();
        write_skill(
            project.path(),
            "review",
            "---\nname: review\ndescription: project version\n---",
        );
        write_skill(
            home.path(),
            "review",
            "---\nname: review\ndescription: user version\n---",
        );

        let skills = list_skills(project.path().to_str().unwrap(), home.path().to_str());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].source, "project");
        assert_eq!(skills[0].description, "project version");
    }

    #[test]
    fn missing_directories_yield_no_skills() {
        let skills = list_skills("/nonexistent/path/xyz", Some("/also/missing"));
        assert!(skills.is_empty());
    }

    /// Minimal tempdir helper that doesn't pull in an external crate.
    fn tempdir() -> TempDir {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("overseer-skills-test-{pid}-{n}"));
        fs::create_dir_all(&path).unwrap();
        TempDir { path }
    }

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

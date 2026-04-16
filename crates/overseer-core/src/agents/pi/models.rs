//! Pi model listing.
//!
//! Runs `pi --list-models` and parses the whitespace-delimited table output
//! into structured model metadata.

use crate::shell::build_login_shell_command;
use serde::{Deserialize, Serialize};
use std::process::Stdio;

/// A model exposed by the Pi CLI.
///
/// `id` is a "provider/model_id" alias suitable for Pi's `set_model` RPC
/// command — the substring before the first `/` is the provider, the rest is
/// the model id (which may itself contain `/`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiModel {
    pub id: String,
    pub name: String,
    pub provider: String,
}

/// Fetch available models by running `pi --list-models` and parsing the table.
///
/// The Pi CLI prints a header row followed by data rows. Columns are
/// whitespace-padded; fields never contain embedded double-spaces, so we split
/// each data row on runs of 2+ whitespace characters. The first two fields are
/// `provider` and `model`; additional columns (context, max-out, thinking,
/// images) are ignored.
pub fn list_pi_models_from_cli(
    pi_path: &str,
    agent_shell: Option<&str>,
) -> Result<Vec<PiModel>, String> {
    let args = vec!["--list-models".to_string()];
    let mut cmd = build_login_shell_command(pi_path, &args, None, agent_shell)?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run pi --list-models: {e}"))?;

    if !output.status.success() {
        return Err("pi --list-models command failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_list_models_output(&stdout))
}

/// Parse the text table emitted by `pi --list-models`.
fn parse_list_models_output(stdout: &str) -> Vec<PiModel> {
    let mut models = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        // Split on runs of 2+ whitespace to get table columns.
        let fields: Vec<&str> = trimmed
            .split("  ")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();

        // Skip the header row and anything with fewer than 2 fields.
        if fields.len() < 2 {
            continue;
        }
        if fields[0].eq_ignore_ascii_case("provider") && fields[1].eq_ignore_ascii_case("model") {
            continue;
        }

        let provider = fields[0].to_string();
        let model = fields[1].to_string();

        models.push(PiModel {
            id: format!("{provider}/{model}"),
            name: model,
            provider,
        });
    }

    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_table() {
        let output = "\
provider   model                 context  max-out  thinking  images
ollama     qwen/qwen3.5-9b       128K     16.4K    no        no
anthropic  claude-sonnet-4-5     200K     8K       yes       yes
";
        let models = parse_list_models_output(output);
        assert_eq!(models.len(), 2);
        assert_eq!(
            models[0],
            PiModel {
                id: "ollama/qwen/qwen3.5-9b".to_string(),
                name: "qwen/qwen3.5-9b".to_string(),
                provider: "ollama".to_string(),
            }
        );
        assert_eq!(
            models[1],
            PiModel {
                id: "anthropic/claude-sonnet-4-5".to_string(),
                name: "claude-sonnet-4-5".to_string(),
                provider: "anthropic".to_string(),
            }
        );
    }

    #[test]
    fn skips_header_and_blank_lines() {
        let output = "\
provider  model

ollama    qwen/foo    ctx
";
        let models = parse_list_models_output(output);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].provider, "ollama");
        assert_eq!(models[0].name, "qwen/foo");
    }

    #[test]
    fn empty_output_returns_empty_vec() {
        assert!(parse_list_models_output("").is_empty());
    }

    #[test]
    fn parses_real_pi_output() {
        // Captured from `pi --list-models` (0.67.2). The table uses variable
        // whitespace padding; fields never contain consecutive spaces.
        let output = "\
provider  model                                              context  max-out  thinking  images
ollama    google/gemma-4-31b                                 128K     16.4K    yes       no
ollama    qwen/qwen3.5-35b-a3b                               128K     16.4K    no        no
ollama    qwen/qwen3.5-9b                                    128K     16.4K    no        no
ollama    qwen3.5-27b-claude-4.6-opus-reasoning-distilled    128K     16.4K    no        no
ollama    qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2  128K     16.4K    no        no
";
        let models = parse_list_models_output(output);
        assert_eq!(models.len(), 5);
        assert_eq!(models[0].provider, "ollama");
        assert_eq!(models[0].name, "google/gemma-4-31b");
        assert_eq!(models[0].id, "ollama/google/gemma-4-31b");
        assert_eq!(
            models[4].name,
            "qwen3.5-9b-claude-4.6-opus-reasoning-distilled-v2"
        );
    }
}

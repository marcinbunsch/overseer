//! Overdrive Phase 1 spike — drive one headless agent turn from the CLI.
//!
//! This is the manual trigger for Overdrive Phase 1: it builds an
//! [`OverseerContext`], spawns a Claude turn in a workspace, streams the output
//! live, and prints the final [`TurnOutcome`] — all with **no frontend and no
//! WebSocket attached**, which is exactly the property Phase 1 must prove.
//!
//! # Usage
//!
//! ```text
//! cargo run -p overseer-core --example overdrive_spike -- \
//!     --workspace ~/some/checkout \
//!     --prompt "create a file hello.txt containing hi" \
//!     [--agent-path /path/to/claude] \
//!     [--model claude-opus-4-8]
//! ```
//!
//! Then confirm `hello.txt` exists in the workspace and the printed outcome is
//! `Completed`.

use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use overseer_core::overdrive::{run_turn, TurnOutcome, TurnParams};
use overseer_core::{AgentEvent, OverseerContext};

#[tokio::main]
async fn main() {
    let args = match Args::parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{USAGE}");
            std::process::exit(1);
        }
    };

    // Isolated temp config dir so the spike doesn't touch real Overseer data.
    let config_dir = std::env::temp_dir().join("overseer-overdrive-spike");
    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        eprintln!("error: failed to create config dir {config_dir:?}: {e}");
        std::process::exit(1);
    }

    let ctx = Arc::new(
        OverseerContext::builder()
            .config_dir(config_dir.clone())
            .build(),
    );
    ctx.approval_manager.set_config_dir(config_dir.clone());
    ctx.chat_sessions.set_config_dir(config_dir);

    let conversation_id = format!("spike-{}", uuid_like());
    println!("▶ conversation: {conversation_id}");
    println!("▶ workspace:    {}", args.workspace);
    println!("▶ prompt:       {}\n", args.prompt);

    // Live printer: a second subscriber that echoes streamed text as it lands.
    let printer = spawn_printer(&ctx, conversation_id.clone());

    let outcome = run_turn(
        &ctx,
        TurnParams {
            conversation_id,
            project_name: "overdrive-spike".to_string(),
            workspace_name: "spike".to_string(),
            working_dir: args.workspace,
            agent_path: args.agent_path,
            prompt: args.prompt,
            model: args.model,
            session_id: None,
            log_dir: None,
            log_id: None,
            timeout: Duration::from_secs(600),
        },
    )
    .await;

    printer.abort();

    println!("\n\n─── outcome ───");
    match &outcome {
        TurnOutcome::Completed { text } => {
            println!("Completed ({} chars of text)", text.len());
        }
        TurnOutcome::NeedsInput { question } => println!("NeedsInput: {question}"),
        TurnOutcome::Failed { reason } => println!("Failed: {reason}"),
        TurnOutcome::TimedOut => println!("TimedOut"),
    }

    if !matches!(outcome, TurnOutcome::Completed { .. }) {
        std::process::exit(1);
    }
}

/// Spawn a background task that streams this conversation's text to stdout.
fn spawn_printer(
    ctx: &Arc<OverseerContext>,
    conversation_id: String,
) -> tokio::task::JoinHandle<()> {
    let mut rx = ctx.event_bus.subscribe();
    let event_topic = format!("agent:event:{conversation_id}");
    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if event.event_type != event_topic {
                continue;
            }
            if let Ok(agent_event) = serde_json::from_value::<AgentEvent>(event.payload) {
                match agent_event {
                    AgentEvent::Text { text } | AgentEvent::Message { content: text, .. } => {
                        print!("{text}");
                        let _ = std::io::stdout().flush();
                    }
                    AgentEvent::Thinking { text } => {
                        eprint!("\x1b[2m{text}\x1b[0m");
                        let _ = std::io::stderr().flush();
                    }
                    _ => {}
                }
            }
        }
    })
}

/// Parsed CLI arguments.
struct Args {
    workspace: String,
    prompt: String,
    agent_path: String,
    model: Option<String>,
}

const USAGE: &str = "usage: overdrive_spike --workspace <dir> --prompt <text> \
[--agent-path <path>] [--model <name>]";

impl Args {
    fn parse(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
        let mut workspace = None;
        let mut prompt = None;
        let mut agent_path = None;
        let mut model = None;

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--workspace" => workspace = Some(next_value(&mut args, "--workspace")?),
                "--prompt" => prompt = Some(next_value(&mut args, "--prompt")?),
                "--agent-path" => agent_path = Some(next_value(&mut args, "--agent-path")?),
                "--model" => model = Some(next_value(&mut args, "--model")?),
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        Ok(Args {
            workspace: workspace.ok_or("--workspace is required")?,
            prompt: prompt.ok_or("--prompt is required")?,
            // Default to bare "claude"; the login-shell spawn resolves it on PATH.
            agent_path: agent_path.unwrap_or_else(|| "claude".to_string()),
            model,
        })
    }
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{flag} requires a value"))
}

/// A cheap unique-ish suffix without pulling extra deps into the example.
fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

//! Overdrive Phase 4 manual trigger — run one task end-to-end, headless.
//!
//! Provisions a worktree off `--repo`, gets the agent to register a harness,
//! proves it fails, runs the impl→review loop, final-verifies, and lands the run
//! at `needs-review` — with no frontend attached (the `run-next` precursor).
//!
//! # Usage
//!
//! ```text
//! cargo run -p overseer-core --example overdrive_run -- \
//!     --repo ~/some/checkout \
//!     --title "Add a slugify() helper" \
//!     --description "lowercase, hyphen-separated; add a unit test first" \
//!     [--verification "slugify('A B') == 'a-b'"] \
//!     [--check-command "cargo test"] \
//!     [--agent-path /path/to/claude] [--model claude-opus-4-8]
//! ```

use std::path::Path;
use std::sync::Arc;

use overseer_core::config::read_app_config;
use overseer_core::overdrive::{execute_run, RunBudgets, RunParams};
use overseer_core::persistence::{OverdriveTask, TaskStatus};
use overseer_core::{AgentEvent, OverseerContext};

#[tokio::main]
async fn main() {
    let args = match Args::parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("error: {msg}\n\n{USAGE}");
            std::process::exit(1);
        }
    };

    let config_dir = std::env::temp_dir().join("overseer-overdrive-run");
    std::fs::create_dir_all(&config_dir).expect("create config dir");

    let ctx = Arc::new(
        OverseerContext::builder()
            .config_dir(config_dir.clone())
            .build(),
    );
    ctx.approval_manager.set_config_dir(config_dir.clone());
    ctx.chat_sessions.set_config_dir(config_dir.clone());

    // Resolve the agent binary / shell: explicit flag wins, else config.json, else "claude".
    let app_config = read_app_config(&config_dir);
    let agent_path = args
        .agent_path
        .clone()
        .unwrap_or_else(|| app_config.resolved_claude_path());
    let agent_shell = app_config.resolved_agent_shell();

    let project_name = Path::new(&args.repo)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());

    let task = OverdriveTask {
        id: format!("task-{}", stamp()),
        repo_id: project_name.clone(),
        title: args.title.clone(),
        description: args.description.clone(),
        verification: args.verification.clone(),
        expect_green_harness: false,
        status: TaskStatus::Todo,
        order: 0,
        created_at: chrono::Utc::now(),
        run_ids: vec![],
        source_ref: None,
    };

    println!("▶ repo:    {}", args.repo);
    println!("▶ task:    {}", task.title);
    println!("▶ agent:   {agent_path}");
    println!(
        "▶ runs at: {}\n",
        config_dir.join("overdrive-runs.json").display()
    );

    let printer = spawn_printer(&ctx);

    let run = execute_run(
        &ctx,
        RunParams {
            task,
            repo_path: args.repo.clone(),
            project_name,
            agent_path,
            model: args.model.clone(),
            agent_shell,
            check_command: args.check_command.clone(),
            overdrive_instructions: None,
            budgets: RunBudgets::default(),
        },
    )
    .await;

    printer.abort();

    println!("\n\n─── run {} ───", run.id);
    println!("status:    {:?}", run.status);
    if let Some(e) = &run.error {
        println!("error:     {e}");
    }
    if let Some(b) = &run.branch {
        println!("branch:    {b}");
    }
    if let Some(w) = &run.workspace_path {
        println!("workspace: {w}");
    }
    if let Some(v) = &run.verification {
        println!("commands:  {:?}", v.commands);
        println!(
            "red/final: {}/{}",
            v.red_check
                .as_ref()
                .map(|c| c.passed)
                .map(|p| if p { "green" } else { "red" })
                .unwrap_or("-"),
            v.final_check
                .as_ref()
                .map(|c| c.passed)
                .map(|p| if p { "green" } else { "red" })
                .unwrap_or("-"),
        );
        if let Some(d) = &v.harness_drift {
            println!("drift:\n{d}");
        }
    }
    if let Some(r) = &run.result {
        println!("summary:   {}", r.summary);
    }
    println!("iterations: {}", run.iterations_used);
}

/// Stream run-status transitions and agent text as they happen.
fn spawn_printer(ctx: &Arc<OverseerContext>) -> tokio::task::JoinHandle<()> {
    let mut rx = ctx.event_bus.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if event.event_type == "overdrive:run-status" {
                if let Some(status) = event.payload.get("status").and_then(|s| s.as_str()) {
                    eprintln!("\x1b[36m[status → {status}]\x1b[0m");
                }
            } else if event.event_type.starts_with("agent:event:") {
                if let Ok(AgentEvent::Text { text } | AgentEvent::Message { content: text, .. }) =
                    serde_json::from_value::<AgentEvent>(event.payload)
                {
                    print!("{text}");
                    use std::io::Write;
                    let _ = std::io::stdout().flush();
                }
            }
        }
    })
}

struct Args {
    repo: String,
    title: String,
    description: String,
    verification: Option<String>,
    check_command: Option<String>,
    agent_path: Option<String>,
    model: Option<String>,
}

const USAGE: &str = "usage: overdrive_run --repo <path> --title <text> [--description <text>] \
[--verification <text>] [--check-command <cmd>] [--agent-path <path>] [--model <name>]";

impl Args {
    fn parse(mut it: impl Iterator<Item = String>) -> Result<Args, String> {
        let mut repo = None;
        let mut title = None;
        let mut description = String::new();
        let mut verification = None;
        let mut check_command = None;
        let mut agent_path = None;
        let mut model = None;

        while let Some(arg) = it.next() {
            let mut next = |flag: &str| it.next().ok_or_else(|| format!("{flag} requires a value"));
            match arg.as_str() {
                "--repo" => repo = Some(next("--repo")?),
                "--title" => title = Some(next("--title")?),
                "--description" => description = next("--description")?,
                "--verification" => verification = Some(next("--verification")?),
                "--check-command" => check_command = Some(next("--check-command")?),
                "--agent-path" => agent_path = Some(next("--agent-path")?),
                "--model" => model = Some(next("--model")?),
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        Ok(Args {
            repo: repo.ok_or("--repo is required")?,
            title: title.ok_or("--title is required")?,
            description,
            verification,
            check_command,
            agent_path,
            model,
        })
    }
}

fn stamp() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

export type CliFeature = {
  name: string;
  stage: "stable" | "preview";
  source: "cli" | "host" | "worker";
  description: string;
};

export const cliFeatures: CliFeature[] = [
  { name: "interactive_chat", stage: "stable", source: "cli", description: "Stateful terminal REPL with a typed slash-command registry" },
  { name: "unicode_input", stage: "stable", source: "cli", description: "Inline grapheme-aware editor with CJK input and deterministic reflow" },
  { name: "interactive_completion", stage: "stable", source: "cli", description: "Keyboard completion for commands, sessions, models, goals, and plans" },
  { name: "slash_command_palette", stage: "stable", source: "cli", description: "Live filtered command and subcommand palette with descriptions and selection" },
  { name: "interactive_session_selector", stage: "stable", source: "cli", description: "TTY session picker for resume --all with keyboard navigation" },
  { name: "provisional_session_titles", stage: "stable", source: "cli", description: "First natural-language prompt replaces the neutral title of a new session" },
  { name: "markdown_streaming", stage: "stable", source: "cli", description: "Width-aware incremental Markdown, code block, and table rendering" },
  { name: "reasoning_summaries", stage: "stable", source: "worker", description: "Provider-approved or deterministic execution summaries without private reasoning traces" },
  { name: "structured_run_results", stage: "stable", source: "worker", description: "Final Id-Vg replies grounded in fixed extractor metrics rather than pre-run expectations" },
  { name: "artifact_events", stage: "stable", source: "cli", description: "Typed terminal and JSONL events for published simulation files and plots" },
  { name: "non_interactive_exec", stage: "stable", source: "cli", description: "Single-turn execution with stdin support" },
  { name: "jsonl_events", stage: "stable", source: "cli", description: "Streaming machine-readable events for automation" },
  { name: "output_last_message", stage: "stable", source: "cli", description: "Write the final agent response to a file" },
  { name: "session_lifecycle", stage: "stable", source: "cli", description: "Create, resume, rename, archive, unarchive, and delete sessions" },
  { name: "sentaurus_review", stage: "stable", source: "cli", description: "Findings-first review of decks, scripts, logs, and results" },
  { name: "attachments_and_images", stage: "stable", source: "cli", description: "Upload local files and images into a VM session" },
  { name: "shell_completion", stage: "stable", source: "cli", description: "Generate PowerShell, Bash, Zsh, and Fish completions" },
  { name: "model_switching", stage: "stable", source: "worker", description: "Allowlisted VM model switching with max reasoning and family context limits" },
  { name: "host_bootstrap", stage: "stable", source: "host", description: "Start loopback Web API and wake the CentOS worker without exposing the token" },
  { name: "sse_streaming", stage: "stable", source: "host", description: "Incremental replies and structured worklog progress" },
  { name: "session_workflow", stage: "stable", source: "worker", description: "Revisioned per-session goal and plan state shared by CLI and Web" },
  { name: "durable_goals", stage: "stable", source: "worker", description: "Session-scoped /goal lifecycle with pause, block, and completion" },
  { name: "plan_mode", stage: "stable", source: "worker", description: "Read-only /plan state that locks file publishing and simulation execution" },
  { name: "side_investigation", stage: "stable", source: "worker", description: "Isolated /side investigation that does not replace the main goal" },
  { name: "safe_sentaurus_runner", stage: "stable", source: "worker", description: "Allowlisted Sentaurus execution and artifact collection" }
];

export function formatFeatureList(features = cliFeatures): string {
  const header = "Feature                       Stage    Source  Description";
  const rows = features.map((feature) =>
    `${feature.name.padEnd(29)} ${feature.stage.padEnd(8)} ${feature.source.padEnd(7)} ${feature.description}`
  );
  return `${header}\n${rows.join("\n")}\n`;
}

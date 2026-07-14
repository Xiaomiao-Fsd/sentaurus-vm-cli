export type CliFeature = {
  name: string;
  stage: "stable" | "preview";
  source: "cli" | "host" | "worker";
  description: string;
};

export const cliFeatures: CliFeature[] = [
  { name: "interactive_chat", stage: "stable", source: "cli", description: "Persistent terminal chat with local slash commands" },
  { name: "unicode_input", stage: "stable", source: "cli", description: "Boxed UTF-8 terminal input with CJK text support" },
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
  { name: "durable_goals", stage: "stable", source: "worker", description: "Session-scoped /goal state" },
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

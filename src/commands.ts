export type CommandTarget = "local" | "workflow" | "remote";

export type DynamicValueSource = "commands" | "models" | "planStatuses" | "planSteps" | "sessions";

export type CommandSubcommandSpec = {
  name: string;
  summary: string;
  takesValue?: boolean;
  valueSource?: DynamicValueSource;
  nextValueSource?: DynamicValueSource;
};

export type CommandSpec = {
  name: string;
  aliases?: readonly string[];
  summary: string;
  usage: string;
  target: CommandTarget;
  takesArguments?: boolean;
  dynamicValues?: DynamicValueSource;
  subcommands?: readonly CommandSubcommandSpec[];
};

export type ParsedCommand = {
  name: string;
  invokedAs: string;
  args: string[];
  spec?: CommandSpec;
};

export type DynamicCommandValues = {
  sessions?: readonly string[];
  models?: readonly string[];
  planSteps?: readonly string[];
};

export type CommandSuggestion = {
  label: string;
  replacement: string;
  description: string;
};

const specs: readonly CommandSpec[] = [
  { name: "help", summary: "Show available commands", usage: "/help [command]", target: "local", takesArguments: true, dynamicValues: "commands" },
  { name: "exit", aliases: ["quit"], summary: "Exit the CLI", usage: "/exit", target: "local" },
  { name: "clear", summary: "Clear the terminal", usage: "/clear", target: "local" },
  { name: "session", summary: "Show the active session", usage: "/session", target: "local" },
  {
    name: "sessions", summary: "List sessions", usage: "/sessions [--all]", target: "local", takesArguments: true,
    subcommands: [{ name: "--all", summary: "Include locally archived sessions" }]
  },
  { name: "new", summary: "Create and switch session", usage: "/new [title]", target: "local", takesArguments: true },
  { name: "resume", summary: "Switch to an existing session", usage: "/resume <id-prefix|title>", target: "local", takesArguments: true, dynamicValues: "sessions" },
  { name: "rename", summary: "Rename the active session", usage: "/rename <title>", target: "local", takesArguments: true },
  { name: "archive", summary: "Archive the active session locally", usage: "/archive", target: "local" },
  { name: "history", summary: "Reload recent conversation", usage: "/history", target: "local" },
  { name: "attach", summary: "Attach files to the next turn", usage: "/attach <path> [...]", target: "local", takesArguments: true },
  { name: "paste-image", summary: "Attach the Windows clipboard image", usage: "/paste-image", target: "local" },
  { name: "attachments", summary: "List pending attachments", usage: "/attachments", target: "local" },
  {
    name: "detach", summary: "Remove pending attachments", usage: "/detach <number|all>", target: "local", takesArguments: true,
    subcommands: [{ name: "all", summary: "Remove every pending attachment" }]
  },
  { name: "files", summary: "List VM session files", usage: "/files", target: "local" },
  { name: "download", summary: "Download a VM session file", usage: "/download <number|path> [output]", target: "local", takesArguments: true },
  { name: "artifact", summary: "Download a run artifact", usage: "/artifact <run-id> <path> [output]", target: "local", takesArguments: true },
  { name: "connect", summary: "Deploy and restart the VM worker", usage: "/connect", target: "local" },
  {
    name: "model", aliases: ["models"], summary: "Show or switch the VM model", usage: "/model [list|set <name>|name]", target: "local", takesArguments: true, dynamicValues: "models",
    subcommands: [
      { name: "list", summary: "List allowlisted VM models" },
      { name: "current", summary: "Show the active VM model" },
      { name: "set", summary: "Switch to an allowlisted VM model", takesValue: true, valueSource: "models" }
    ]
  },
  { name: "doctor", summary: "Check API and VM worker health", usage: "/doctor", target: "local" },
  {
    name: "goal", summary: "View or update the durable goal lifecycle", usage: "/goal [show|set|edit|pause|resume|block|complete|clear]", target: "workflow", takesArguments: true,
    subcommands: [
      { name: "show", summary: "Show the durable session goal" },
      { name: "set", summary: "Set and activate a new goal", takesValue: true },
      { name: "edit", summary: "Replace and reactivate the goal", takesValue: true },
      { name: "pause", summary: "Pause goal injection into new turns" },
      { name: "resume", summary: "Resume the paused or blocked goal" },
      { name: "block", summary: "Mark the goal blocked with an optional reason", takesValue: true },
      { name: "complete", summary: "Mark the goal complete" },
      { name: "clear", summary: "Remove the durable goal" }
    ]
  },
  {
    name: "plan", summary: "Enter or manage read-only plan mode", usage: "/plan [show|enter|approve|exit|clear|step]", target: "workflow", takesArguments: true,
    subcommands: [
      { name: "show", summary: "Show the current persisted plan" },
      { name: "enter", summary: "Enter read-only planning mode" },
      { name: "approve", summary: "Approve the plan without starting a run" },
      { name: "exit", summary: "Leave plan mode without approval" },
      { name: "clear", summary: "Clear the plan and leave plan mode" },
      { name: "step", summary: "Update a persisted plan step", takesValue: true, valueSource: "planSteps", nextValueSource: "planStatuses" }
    ]
  },
  { name: "side", summary: "Run an isolated side investigation", usage: "/side <question>", target: "remote", takesArguments: true },
  { name: "status", aliases: ["skill"], summary: "Show VM Sentaurus skill status", usage: "/status", target: "remote" },
  { name: "tools", summary: "Show allowlisted Sentaurus tools", usage: "/tools", target: "remote" },
  { name: "instances", aliases: ["instance"], summary: "Show agent and simulation instances", usage: "/instances", target: "remote" },
  { name: "sentaurus-status", summary: "Show Sentaurus-specific status", usage: "/sentaurus-status", target: "remote" }
];

export function splitCommandLine(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!character) continue;
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"' && (value[index + 1] === '"' || value[index + 1] === "\\")) current += value[++index];
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Unclosed quote");
  if (current) result.push(current);
  return result;
}

function uniqueSuggestions(values: CommandSuggestion[]): CommandSuggestion[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

export class CommandRegistry {
  private readonly byName = new Map<string, CommandSpec>();

  constructor(readonly commands: readonly CommandSpec[] = specs) {
    for (const spec of commands) {
      this.byName.set(spec.name, spec);
      for (const alias of spec.aliases || []) this.byName.set(alias, spec);
    }
  }

  parse(input: string): ParsedCommand | undefined {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return undefined;
    const parts = splitCommandLine(trimmed);
    const token = parts.shift() || "/";
    const invokedAs = token.slice(1).toLowerCase();
    const spec = this.byName.get(invokedAs);
    return {
      name: spec?.name || invokedAs,
      invokedAs,
      args: parts,
      ...(spec ? { spec } : {})
    };
  }

  find(name: string): CommandSpec | undefined {
    return this.byName.get(name.replace(/^\//u, "").toLowerCase());
  }

  suggestions(input: string, values: DynamicCommandValues = {}): CommandSuggestion[] {
    if (!input.startsWith("/") || /[\r\n]/u.test(input)) return [];
    const match = input.match(/^\/([^\s]*)(?:\s(.*))?$/u);
    if (!match) return [];
    const invokedAs = (match[1] || "").toLowerCase();
    const argumentText = match[2];
    if (argumentText === undefined) return this.rootSuggestions(invokedAs);
    const spec = this.byName.get(invokedAs);
    if (!spec) return [];
    return this.argumentSuggestions(`/${invokedAs}`, spec, argumentText, input, values);
  }

  completions(values: DynamicCommandValues = {}): string[] {
    const result = new Set<string>();
    for (const item of this.suggestions("/", values)) result.add(item.replacement);
    for (const spec of this.commands) {
      for (const alias of spec.aliases || []) result.add(`/${alias}${spec.takesArguments ? " " : ""}`);
      if (!spec.takesArguments) continue;
      const base = `/${spec.name} `;
      for (const item of this.suggestions(base, values)) result.add(item.replacement);
      for (const subcommand of spec.subcommands || []) {
        if (!subcommand.takesValue) continue;
        const nested = `${base}${subcommand.name} `;
        for (const item of this.suggestions(nested, values)) result.add(item.replacement);
        if (subcommand.nextValueSource) {
          for (const first of this.dynamicItems(subcommand.valueSource, values)) {
            for (const item of this.suggestions(`${nested}${first.value} `, values)) result.add(item.replacement);
          }
        }
      }
    }
    return [...result].sort((left, right) => left.localeCompare(right));
  }

  help(command?: string): string {
    if (command) {
      const spec = this.find(command);
      if (!spec) return `Unknown command: /${command.replace(/^\//u, "")}`;
      return `${spec.usage}\n\n${spec.summary}\nExecution: ${spec.target}`;
    }
    return [
      "Commands:",
      ...this.commands.flatMap((spec) => [
        `  ${spec.usage}`,
        `      ${spec.summary} (${spec.target})`
      ]),
      "",
      "Slash suggestions open while typing. Up/Down selects and Tab completes.",
      "Shift+Enter or Ctrl+J inserts a newline.",
      "On Windows, Ctrl+V or Ctrl+Alt+V attaches the clipboard image."
    ].join("\n");
  }

  private rootSuggestions(query: string): CommandSuggestion[] {
    const prefix = `/${query}`;
    const result: CommandSuggestion[] = [];
    for (const spec of this.commands) {
      const label = `/${spec.name}`;
      if (label.startsWith(prefix)) {
        result.push({
          label,
          replacement: `${label}${spec.takesArguments ? " " : ""}`,
          description: spec.summary
        });
      }
      if (!query) continue;
      for (const alias of spec.aliases || []) {
        const aliasLabel = `/${alias}`;
        if (!aliasLabel.startsWith(prefix)) continue;
        result.push({
          label: aliasLabel,
          replacement: `${aliasLabel}${spec.takesArguments ? " " : ""}`,
          description: `Alias for /${spec.name}: ${spec.summary}`
        });
      }
    }
    return uniqueSuggestions(result);
  }

  private argumentSuggestions(
    base: string,
    spec: CommandSpec,
    argumentText: string,
    input: string,
    values: DynamicCommandValues
  ): CommandSuggestion[] {
    const nested = argumentText.match(/^(\S+)\s(.*)$/u);
    if (nested) {
      const subcommand = spec.subcommands?.find((item) => item.name === nested[1]?.toLowerCase());
      if (!subcommand?.takesValue || !subcommand.valueSource) return [];
      return this.nestedValueSuggestions(base, subcommand, nested[2] || "", input, values);
    }

    const result: CommandSuggestion[] = [];
    for (const subcommand of spec.subcommands || []) {
      const label = `${base} ${subcommand.name}`;
      result.push({
        label,
        replacement: `${label}${subcommand.takesValue ? " " : ""}`,
        description: subcommand.summary
      });
    }
    for (const item of this.dynamicItems(spec.dynamicValues, values)) {
      const label = `${base} ${item.value}`;
      result.push({ label, replacement: label, description: item.summary });
    }
    const normalized = input.toLowerCase();
    return uniqueSuggestions(result).filter((item) => item.label.toLowerCase().startsWith(normalized));
  }

  private nestedValueSuggestions(
    base: string,
    subcommand: CommandSubcommandSpec,
    argumentText: string,
    input: string,
    values: DynamicCommandValues
  ): CommandSuggestion[] {
    let prefix = `${base} ${subcommand.name}`;
    let source = subcommand.valueSource;
    if (subcommand.nextValueSource) {
      const nested = argumentText.match(/^(\S+)\s(.*)$/u);
      if (nested) {
        prefix = `${prefix} ${nested[1]}`;
        source = subcommand.nextValueSource;
      }
    }
    const normalized = input.toLowerCase();
    return this.dynamicItems(source, values).map((item) => {
      const label = `${prefix} ${item.value}`;
      const continues = source === subcommand.valueSource && Boolean(subcommand.nextValueSource);
      return {
        label,
        replacement: `${label}${continues ? " " : ""}`,
        description: item.summary
      };
    }).filter((item) => item.label.toLowerCase().startsWith(normalized));
  }

  private dynamicItems(
    source: DynamicValueSource | undefined,
    values: DynamicCommandValues
  ): Array<{ value: string; summary: string }> {
    const safeTokens = (items: readonly string[]): string[] => items.filter((value) =>
      /^[A-Za-z0-9_.:-]{1,160}$/u.test(value)
    );
    if (source === "models") {
      return safeTokens(values.models || []).map((value) => ({ value, summary: "Switch to this allowlisted VM model" }));
    }
    if (source === "sessions") {
      return safeTokens(values.sessions || []).map((value) => ({ value, summary: "Resume this existing session" }));
    }
    if (source === "planSteps") {
      return safeTokens(values.planSteps || []).map((value) => ({ value, summary: "Select this persisted plan step" }));
    }
    if (source === "planStatuses") {
      return [
        { value: "pending", summary: "Mark the step as not started" },
        { value: "in_progress", summary: "Mark the step as active" },
        { value: "completed", summary: "Mark the step as completed" }
      ];
    }
    if (source === "commands") {
      return this.commands.map((spec) => ({ value: spec.name, summary: spec.summary }));
    }
    return [];
  }
}

export const commandRegistry = new CommandRegistry();

const commands = [
  "chat", "exec", "review", "resume", "new", "sessions", "history", "rename",
  "archive", "unarchive", "delete", "files", "download", "artifact", "status",
  "connect", "doctor", "features", "completion", "login", "logout", "config", "local"
];

const options = [
  "--help", "--version", "--host", "--url", "--token", "--session", "--last",
  "--all", "--title", "--attach", "--image", "--timeout", "--output", "--category",
  "--cd", "--ephemeral", "--force", "--json", "--no-history", "--web-repo",
  "--task-name", "--restart-worker"
];

export type CompletionShell = "bash" | "fish" | "powershell" | "zsh";

export function completionScript(shell: string): string {
  if (!(["bash", "fish", "powershell", "zsh"] as string[]).includes(shell)) {
    throw new Error(`Unsupported shell: ${shell}. Use bash, fish, powershell, or zsh.`);
  }
  const words = [...commands, ...options].join(" ");

  if (shell === "powershell") {
    const quoted = [...commands, ...options].map((item) => `'${item}'`).join(", ");
    return `# Sentaurus VM CLI completion\n$sentaurusVmCliWords = @(${quoted})\nRegister-ArgumentCompleter -Native -CommandName @('sentaurus-vm', 'svm', 'vm-agent', 'sentaurus-vm-ssh') -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  $sentaurusVmCliWords | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)\n  }\n}\n`;
  }

  if (shell === "fish") {
    return `# Sentaurus VM CLI completion\nfor command in sentaurus-vm svm vm-agent sentaurus-vm-ssh\n  complete -c $command -f -a '${words}'\nend\n`;
  }

  if (shell === "zsh") {
    return `#compdef sentaurus-vm svm vm-agent sentaurus-vm-ssh\n_sentaurus_vm_cli() {\n  local -a words\n  words=(${words})\n  _describe 'command or option' words\n}\ncompdef _sentaurus_vm_cli sentaurus-vm svm vm-agent sentaurus-vm-ssh\n`;
  }

  return `# Sentaurus VM CLI completion\n_sentaurus_vm_cli() {\n  local cur\n  cur=\"\${COMP_WORDS[COMP_CWORD]}\"\n  COMPREPLY=( $(compgen -W '${words}' -- \"$cur\") )\n}\ncomplete -F _sentaurus_vm_cli sentaurus-vm svm vm-agent sentaurus-vm-ssh\n`;
}

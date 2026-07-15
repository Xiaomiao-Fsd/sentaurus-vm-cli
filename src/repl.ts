import process from "node:process";
import { SentaurusApi, ApiError } from "./api.js";
import { matchingFile, uploadAttachments, type PendingAttachment } from "./attachments.js";
import type { ChatOptions } from "./chat-options.js";
import { commandRegistry, type ParsedCommand } from "./commands.js";
import { InlineEditor } from "./input-editor.js";
import { mergeMessages } from "./messages.js";
import { parseVmAgentModel } from "./models.js";
import { SessionController } from "./session-controller.js";
import { TurnController } from "./turn-controller.js";
import type {
  VmAgentStatus,
  VmAgentWorkflow,
  VmAgentWorkflowUpdate,
  VmSessionOutputFile
} from "./types.js";
import {
  printBanner,
  printError,
  printFiles,
  printHistory,
  printModelCatalog,
  printRuns,
  shortId,
  statusLine,
  style
} from "./ui.js";
import { formatWorkflow, goalWorkflowUpdate, planWorkflowUpdate } from "./workflow.js";

type ReplState = {
  status: VmAgentStatus;
  workflow: VmAgentWorkflow | undefined;
  files: VmSessionOutputFile[];
  pending: PendingAttachment[];
  sessionCandidates: string[];
};

export class ReplApp {
  private readonly sessions: SessionController;
  private readonly turns: TurnController;
  private readonly state: ReplState;
  private editor?: InlineEditor;

  constructor(
    private readonly api: SentaurusApi,
    private readonly options: ChatOptions,
    private readonly fallbackSessionId?: string
  ) {
    this.sessions = new SessionController(api, options.configPath, options.archivedSessionIds || []);
    this.turns = new TurnController(api, options.timeoutMs || 30 * 60_000);
    this.state = {
      status: options.initialStatus || {
        ok: false,
        checkedAt: new Date().toISOString(),
        sshTarget: "",
        connected: false
      },
      workflow: undefined,
      files: [],
      pending: [],
      sessionCandidates: []
    };
  }

  async run(): Promise<void> {
    const session = await this.sessions.initialize(
      this.options.sessionId,
      this.fallbackSessionId,
      this.options.title
    );
    this.state.status = this.options.initialStatus || await this.api.status();
    const initialSessions = await this.sessions.list(false);
    this.state.sessionCandidates = [...new Set([session.id, ...initialSessions.runs.map((run) => run.id)])];
    await this.refreshWorkflow();
    this.state.pending = await uploadAttachments(this.api, session.id, this.options.attachments || [], this.options);
    printBanner(this.api.baseUrl, session, this.state.status, this.state.workflow);

    if (this.options.showHistory !== false) await this.printRecentHistory();

    this.editor = new InlineEditor((value) => commandRegistry.suggestions(value, {
      sessions: this.state.sessionCandidates,
      models: this.state.status.llmModels || (this.state.status.llmModel ? [this.state.status.llmModel] : []),
      planSteps: this.state.workflow?.plan.steps.map((step) => step.id) || []
    }));

    const onSigint = () => {
      if (this.turns.cancel()) process.stdout.write(`\n${style.yellow("Cancelling active turn...")}\n`);
      else this.editor?.interrupt();
    };
    process.on("SIGINT", onSigint);
    try {
      while (true) {
        const outcome = await this.editor.read();
        if (outcome.type === "exit") break;
        if (outcome.type === "cancel") continue;
        const input = outcome.value.trim();
        if (!input) continue;
        try {
          const command = commandRegistry.parse(input);
          if (command) {
            if (!command.spec) throw new Error(`Unknown command: /${command.invokedAs}. Use /help to list supported commands.`);
            if (command.name === "exit") break;
            if (command.spec.target === "local") await this.handleLocal(command);
            else if (command.spec.target === "workflow") await this.handleWorkflow(command);
            else await this.runTurn(input);
          } else {
            await this.runTurn(input);
          }
        } catch (error) {
          printError(error);
        }
      }
    } finally {
      process.off("SIGINT", onSigint);
      this.editor.close();
    }
  }

  private async handleLocal(command: ParsedCommand): Promise<void> {
    switch (command.name) {
      case "help":
        process.stdout.write(`${commandRegistry.help(command.args[0])}\n\n`);
        return;
      case "clear":
        process.stdout.write("\u001bc");
        return;
      case "session":
        process.stdout.write(`${this.sessions.current.id}  ${this.sessions.current.status}  ${this.sessions.current.title}\n`);
        if (this.state.workflow) process.stdout.write(`${formatWorkflow(this.state.workflow)}\n`);
        return;
      case "sessions": {
        const listed = await this.sessions.list(command.args[0] === "--all");
        this.state.sessionCandidates = listed.runs.map((run) => run.id);
        printRuns(listed.runs, this.sessions.current.id, listed.archived);
        return;
      }
      case "new":
        await this.sessions.create(command.args.join(" ").trim() || undefined);
        await this.resetSessionState();
        process.stdout.write(`${style.green("session created")} ${this.sessions.current.id}\n`);
        return;
      case "resume":
        if (!command.args.length) throw new Error(command.spec?.usage || "Usage: /resume <session>");
        await this.sessions.resume(command.args.join(" "));
        await this.resetSessionState();
        process.stdout.write(`${style.green("resumed")} ${this.sessions.current.id}\n\n`);
        await this.printRecentHistory();
        return;
      case "rename":
        if (!command.args.length) throw new Error(command.spec?.usage || "Usage: /rename <title>");
        await this.sessions.rename(command.args.join(" "));
        process.stdout.write(`${style.green("renamed")} ${this.sessions.current.id}  ${this.sessions.current.title}\n`);
        return;
      case "archive": {
        const previous = this.sessions.current.id;
        await this.sessions.archive();
        await this.resetSessionState();
        process.stdout.write(`${style.green("archived")} ${previous}; switched to ${this.sessions.current.id}\n`);
        return;
      }
      case "history":
        await this.printRecentHistory(30);
        return;
      case "attach":
        if (!command.args.length) throw new Error(command.spec?.usage || "Usage: /attach <path>");
        this.state.pending.push(...await uploadAttachments(this.api, this.sessions.current.id, command.args, this.options));
        return;
      case "attachments":
        if (!this.state.pending.length) process.stdout.write("No pending attachments.\n");
        this.state.pending.forEach((item, index) => process.stdout.write(`${index + 1}  ${item.ref.name}  ${item.ref.source}\n`));
        return;
      case "detach":
        this.detach(command.args[0]);
        return;
      case "files":
        this.state.files = (await this.api.sessionFiles(this.sessions.current.id)).files;
        printFiles(this.state.files);
        return;
      case "download":
        await this.download(command);
        return;
      case "artifact":
        await this.downloadArtifact(command);
        return;
      case "connect": {
        process.stdout.write(`${style.dim("Deploying and restarting the VM worker...")}\n`);
        const connected = await this.api.connect();
        this.state.status = connected.status;
        await this.refreshWorkflow();
        process.stdout.write(`${statusLine(this.state.status)}\n`);
        return;
      }
      case "model":
        await this.model(command);
        return;
      case "doctor": {
        const health = await this.api.health();
        this.state.status = await this.api.status();
        process.stdout.write(`API ${health.ok ? "ok" : "failed"} | ${statusLine(this.state.status)}\n`);
        return;
      }
      default:
        throw new Error(`Local command handler is missing for /${command.name}`);
    }
  }

  private async handleWorkflow(command: ParsedCommand): Promise<void> {
    this.requireWorkflowCapability();
    if (!this.state.workflow) await this.refreshWorkflow(false, true);
    if (command.name === "goal") {
      const update = goalWorkflowUpdate(command.args);
      if (!update) {
        await this.refreshWorkflow(true);
        return;
      }
      await this.applyWorkflow(update);
      return;
    }

    const update = planWorkflowUpdate(command.args, this.state.workflow?.plan.mode);
    if (!update) {
      await this.refreshWorkflow(true);
      return;
    }
    await this.applyWorkflow(update);
  }

  private async applyWorkflow(update: VmAgentWorkflowUpdate): Promise<void> {
    const expectedRevision = this.state.workflow?.revision;
    if (expectedRevision === undefined) {
      throw new Error("Workflow state is unavailable; run /connect or retry after the VM worker is reachable.");
    }
    try {
      const result = await this.api.updateWorkflow(this.sessions.current.id, {
        ...update,
        expectedRevision
      });
      this.state.workflow = result.workflow;
      process.stdout.write(`${formatWorkflow(result.workflow)}\n`);
      if (update.action === "plan.enter") {
        process.stdout.write(`${style.yellow("Plan mode is read-only. Send the planning task as the next message.")}\n`);
      } else if (update.action === "plan.approve") {
        process.stdout.write(`${style.green("Plan approved. Execution is unlocked; no simulation was started.")}\n`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.refreshWorkflow(false, true);
        throw new Error(`Workflow changed in another client. Current revision is ${this.state.workflow?.revision ?? "unknown"}; review it and retry.`);
      }
      throw error;
    }
  }

  private async runTurn(input: string): Promise<void> {
    process.stdout.write(`${style.dim(`session ${shortId(this.sessions.current.id)} - working`)}\n`);
    const sent = this.state.pending;
    this.state.pending = [];
    try {
      await this.turns.run(this.sessions.current.id, input, sent, {
        onSubmitted: async () => {
          try {
            await this.sessions.titleFromFirstPrompt(input);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            process.stderr.write(`${style.dim(`Could not update the session title (${detail}).`)}\n`);
          }
        }
      });
      if (this.state.workflow?.plan.mode === "plan") await this.refreshWorkflow();
    } catch (error) {
      this.state.pending.unshift(...sent);
      throw error;
    }
  }

  private async refreshWorkflow(print = false, strict = false): Promise<void> {
    if (!this.state.status.capabilities?.includes("session_workflow_v1")) {
      this.state.workflow = undefined;
      return;
    }
    try {
      this.state.workflow = (await this.api.workflow(this.sessions.current.id)).workflow;
      if (print) process.stdout.write(`${formatWorkflow(this.state.workflow)}\n`);
    } catch (error) {
      this.state.workflow = undefined;
      if (print || strict) throw error;
    }
  }

  private requireWorkflowCapability(): void {
    if (!this.state.status.capabilities?.includes("session_workflow_v1")) {
      throw new Error("The VM worker does not expose session workflow v1. Run /connect to deploy the updated worker.");
    }
  }

  private async resetSessionState(): Promise<void> {
    this.state.pending = [];
    this.state.files = [];
    if (!this.state.sessionCandidates.includes(this.sessions.current.id)) {
      this.state.sessionCandidates.push(this.sessions.current.id);
    }
    await this.refreshWorkflow();
  }

  private async printRecentHistory(limit = 16): Promise<void> {
    const history = await this.api.messages(0, { limit: 200, sessionId: this.sessions.current.id });
    printHistory(mergeMessages([], history.messages), limit);
  }

  private detach(selector?: string): void {
    if (!selector) throw new Error("Usage: /detach <number|all>");
    if (selector.toLowerCase() === "all") this.state.pending = [];
    else {
      const index = Number.parseInt(selector, 10) - 1;
      if (!this.state.pending[index]) throw new Error(`Attachment not found: ${selector}`);
      this.state.pending.splice(index, 1);
    }
  }

  private async download(command: ParsedCommand): Promise<void> {
    const selector = command.args[0];
    if (!selector) throw new Error(command.spec?.usage || "Usage: /download <file>");
    if (!this.state.files.length) this.state.files = (await this.api.sessionFiles(this.sessions.current.id)).files;
    const file = matchingFile(this.state.files, selector);
    const destination = await this.api.downloadSessionFile(
      this.sessions.current.id,
      file.category,
      file.path,
      command.args[1]
    );
    process.stdout.write(`${style.green("downloaded")} ${destination}\n`);
  }

  private async downloadArtifact(command: ParsedCommand): Promise<void> {
    const [runId, artifactPath, output] = command.args;
    if (!runId || !artifactPath) throw new Error(command.spec?.usage || "Usage: /artifact <run> <path>");
    const destination = await this.api.downloadArtifact(runId, artifactPath, output);
    process.stdout.write(`${style.green("downloaded")} ${destination}\n`);
  }

  private async model(command: ParsedCommand): Promise<void> {
    const action = command.args[0]?.toLowerCase();
    if (!action || ["list", "status", "current"].includes(action)) {
      printModelCatalog(await this.api.models());
      return;
    }
    const selected = parseVmAgentModel(action === "set" ? command.args[1] : command.args[0]);
    const changed = await this.api.setModel(selected, AbortSignal.timeout(180_000));
    this.state.status = changed.status;
    printModelCatalog(changed);
  }
}

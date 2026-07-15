export type JsonObject = Record<string, unknown>;

export type VmAgentMessageMeta = {
  kind?: string;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  groupId?: string;
  streamId?: string;
  targetMessageId?: string;
  messageId?: string;
  phase?: string;
  status?: string;
  foldable?: boolean;
  collapsedByDefault?: boolean;
  publicWorklog?: boolean;
  displayLanguage?: string;
  streamState?: string;
  delta?: boolean;
  append?: boolean;
  done?: boolean;
  thinkingStage?: string;
  thinkingStatus?: string;
  summaryIndex?: number;
  summaryOfGroup?: boolean;
  runStatus?: string;
  tool?: string;
  commandLabel?: string;
  exitCode?: number;
  durationMs?: number;
  worklogDurationMs?: number;
  attachmentCount?: number;
  imageAttachmentCount?: number;
} & JsonObject;

export type VmAgentAttachmentSource = "run-input" | "vm-session-file" | "vm-run-artifact";

export type VmSessionOutputCategory =
  | "我的输入"
  | "仿真结果文件"
  | "仿真日志文件"
  | "仿真参数文件"
  | "其它文件";

export type VmAgentAttachmentRef = {
  id: string;
  source: VmAgentAttachmentSource;
  name: string;
  path: string;
  size: number;
  runId?: string;
  category?: VmSessionOutputCategory;
  contentType?: string;
};

export type VmAgentMessageAttachment = VmAgentAttachmentRef & {
  kind: "file" | "image";
  width?: number;
  height?: number;
  thumbnailPath?: string;
};

export type VmAgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
  sequence?: number;
  meta?: VmAgentMessageMeta;
  attachments?: Array<Partial<VmAgentMessageAttachment>>;
};

export type VmAgentStatus = {
  ok: boolean;
  checkedAt: string;
  sshTarget: string;
  connected: boolean;
  agent?: string;
  version?: string;
  hostname?: string;
  user?: string;
  capabilities?: string[];
  workerRunning?: boolean;
  workerPid?: number | null;
  llmConfigured?: boolean;
  llmModel?: string;
  llmModels?: string[];
  llmReasoningEffort?: "max";
  llmContextWindowTokens?: number;
  llmContextTargetTokens?: number;
  llmContextHardTokens?: number;
  llmTimeoutSeconds?: number;
  queueDepth?: number;
  sentaurusTools?: Record<string, string | null>;
  clockSkewMs?: number;
  clockSkewWarning?: boolean;
  error?: string;
};

export type VmAgentModelId =
  | "gpt-5.4"
  | "gpt-5.5"
  | "gpt-5.6-luna"
  | "gpt-5.6-terra"
  | "gpt-5.6-sol";

export type VmAgentModelOption = {
  id: VmAgentModelId;
  contextWindowTokens: 272000 | 353000;
};

export type VmAgentModelsResponse = {
  ok: boolean;
  currentModel: VmAgentModelId;
  activeModels: string[];
  reasoningEffort: "max";
  contextWindowTokens: 272000 | 353000;
  models: VmAgentModelOption[];
  status: VmAgentStatus;
};

export type VmHostStatus = {
  ok: boolean;
  checkedAt: string;
  sshTarget: string;
  hostname?: string;
  user?: string;
  sentaurusVersion?: string;
  tools?: Record<string, string | null>;
  error?: string;
};

export type VmAgentHistoryResponse = {
  ok: boolean;
  status: VmAgentStatus;
  messages: VmAgentMessage[];
  cursor: number;
  truncated?: boolean;
  continuation?: string;
  error?: string;
  message?: string;
  retryable?: boolean;
};

export type VmAgentMessageResponse = VmAgentHistoryResponse & {
  message: VmAgentMessage;
};

export type VmAgentGoalStatus = "active" | "paused" | "blocked" | "complete";

export type VmAgentGoal = {
  objective: string;
  status: VmAgentGoalStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedReason?: string;
};

export type VmAgentPlanStepStatus = "pending" | "in_progress" | "completed";

export type VmAgentPlanStep = {
  id: string;
  step: string;
  status: VmAgentPlanStepStatus;
};

export type VmAgentPlan = {
  mode: "default" | "plan";
  explanation?: string;
  steps: VmAgentPlanStep[];
  updatedAt?: string;
  approvedAt?: string;
};

export type VmAgentWorkflow = {
  version: 1;
  revision: number;
  sessionId: string;
  goal: VmAgentGoal | null;
  plan: VmAgentPlan;
  updatedAt?: string;
};

export type VmAgentWorkflowAction =
  | "goal.set"
  | "goal.pause"
  | "goal.resume"
  | "goal.block"
  | "goal.complete"
  | "goal.clear"
  | "plan.enter"
  | "plan.set"
  | "plan.step"
  | "plan.approve"
  | "plan.exit"
  | "plan.clear";

type VmAgentWorkflowRevision = {
  expectedRevision?: number;
};

export type VmAgentWorkflowUpdate = VmAgentWorkflowRevision & (
  | { action: "goal.set"; payload: { objective: string } }
  | { action: "goal.block"; payload?: { reason?: string } }
  | { action: "plan.set"; payload: { explanation?: string; steps: VmAgentPlanStep[] } }
  | { action: "plan.step"; payload: { stepId: string; status: VmAgentPlanStepStatus } }
  | {
      action: Exclude<
        VmAgentWorkflowAction,
        "goal.set" | "goal.block" | "plan.set" | "plan.step"
      >;
      payload?: never;
    }
);

export type VmAgentWorkflowResponse = {
  ok: boolean;
  workflow: VmAgentWorkflow;
  capabilities: string[];
};

export type VmAgentConnectResponse = {
  ok: boolean;
  status: VmAgentStatus;
  message?: VmAgentMessage;
  messages?: VmAgentMessage[];
  cursor?: number;
};

export type RunStatus =
  | "created"
  | "queued"
  | "running"
  | "succeeded"
  | "incomplete"
  | "failed-postcondition"
  | "failed"
  | "cancelled";

export type RunSummary = {
  id: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  title: string;
  remoteDir?: string;
  lastError?: string;
};

export type VmSessionOutputFile = {
  category: VmSessionOutputCategory;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isImage: boolean;
};

export type VmSessionFilesResponse = {
  categories: VmSessionOutputCategory[];
  files: VmSessionOutputFile[];
};

export type VmSessionFileSyncStatus = {
  ok: boolean;
  category?: VmSessionOutputCategory;
  path?: string;
  size?: number;
  sha256?: string;
  deduplicated?: boolean;
  error?: string;
};

export type UploadRunFileResponse = {
  file: { name: string; kind: string; size: number; modifiedAt: string };
  run: RunSummary;
  vmSync: VmSessionFileSyncStatus;
};

export type StreamEvent = {
  event: string;
  data: unknown;
};

import type { VmAgentModelId } from "./types.js";

export const VM_AGENT_MODEL_IDS: readonly VmAgentModelId[] = [
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol"
];

export function parseVmAgentModel(value: unknown): VmAgentModelId {
  if (typeof value === "string" && VM_AGENT_MODEL_IDS.includes(value as VmAgentModelId)) {
    return value as VmAgentModelId;
  }
  throw new Error(`Model must be one of: ${VM_AGENT_MODEL_IDS.join(", ")}`);
}

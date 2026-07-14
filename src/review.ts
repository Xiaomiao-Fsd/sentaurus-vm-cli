export function buildReviewPrompt(customInstructions = ""): string {
  const custom = customInstructions.trim();
  return [
    "Perform a rigorous Sentaurus TCAD review of the attached files and the relevant files, setup, logs, and results already available in this session.",
    "Lead with concrete findings ordered by severity. Focus on correctness defects, unsafe assumptions, deck syntax or physics-model issues, geometry/contact/mesh problems, bias sequencing, convergence risks, result interpretation errors, and missing validation.",
    "Reference filenames and line numbers or parameter names when possible. Keep the summary brief and place it after the findings. If no defects are found, say so explicitly and identify residual validation gaps.",
    "Do not start or rerun a simulation unless the instructions explicitly request execution.",
    custom ? `Additional review instructions:\n${custom}` : ""
  ].filter(Boolean).join("\n\n");
}

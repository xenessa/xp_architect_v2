import type { Project } from "@db/schema";

/**
 * Compiler Agent prompts (build doc §6.4).
 * Two passes:
 *   1. Incremental alert pass — runs when a session completes; surfaces
 *      cross-session issues early so the lead isn't waiting for full compilation.
 *   2. Batch consolidation — runs over all completed sessions; produces the
 *      unified compiled dataset that deliverables are generated from.
 */

export interface SessionDigest {
  stakeholderName: string;
  roleTitle: string;
  summaries: { phase: number; content: string }[];
  flags: { type: string; severity: string; text: string }[];
}

function projectFrame(project: Project): string {
  return [
    `Project: ${project.name}`,
    project.clientName ? `Client: ${project.clientName}` : null,
    `Scope boundary:\n${project.scopeText}`,
    project.constraintsText ? `Constraints:\n${project.constraintsText}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function digestBlock(d: SessionDigest): string {
  const summaries = d.summaries
    .map((s) => `  Phase ${s.phase}: ${s.content}`)
    .join("\n");
  const flags = d.flags.length
    ? d.flags.map((f) => `  [${f.type}/${f.severity}] ${f.text}`).join("\n")
    : "  (none)";
  return `### ${d.stakeholderName} (${d.roleTitle})\nApproved phase summaries:\n${summaries}\nFlags raised during their discovery:\n${flags}`;
}

export function alertPassPrompt(
  project: Project,
  completed: SessionDigest,
  others: SessionDigest[],
): string {
  return `You are the Compiler Agent for XP Architect, monitoring an enterprise software discovery engagement.

${projectFrame(project)}

A stakeholder has just completed their discovery. Their material:
${digestBlock(completed)}

${
  others.length
    ? `Previously completed stakeholders:\n${others.map(digestBlock).join("\n\n")}`
    : "No other stakeholders have completed yet."
}

Identify NEW issues the project lead should know about now. Only report issues grounded in the material above — no speculation. Categories:
- "contradiction": two stakeholders (or two statements from one) materially disagree
- "risk": something that threatens delivery within the stated scope/constraints
- "scope_creep": demand or expectation accumulating outside the scope boundary
- "coverage_gap": a scope area no stakeholder has substantively addressed

Rules:
- Reference stakeholders by name in the message.
- severity: high = threatens the engagement, medium = needs attention before planning, low = note it.
- Return at most 5 alerts, most important first. Return an empty array if nothing rises to that bar.

Respond with STRICT JSON only:
{"alerts": [{"type": "contradiction|risk|scope_creep|coverage_gap", "severity": "low|medium|high", "message": "..."}]}`;
}

export function consolidationPrompt(
  project: Project,
  all: SessionDigest[],
): string {
  return `You are the Compiler Agent for XP Architect, consolidating a completed discovery engagement.

${projectFrame(project)}

Completed stakeholder material:
${all.map(digestBlock).join("\n\n")}

Produce the unified compiled dataset for this engagement. Be specific — every item must cite the stakeholders it draws from. Ground everything in the material; mark inference as inference.

Respond with STRICT JSON only:
{
  "stakeholder_coverage": [{"name": "...", "role_title": "...", "phases_covered": 4}],
  "contradictions": [{"topic": "...", "positions": [{"stakeholder": "...", "claim": "..."}], "severity": "low|medium|high"}],
  "patterns": [{"theme": "...", "supporting_stakeholders": ["..."], "detail": "..."}],
  "out_of_scope_ranked": [{"item": "...", "raised_by": ["..."], "recommendation": "defer|re-scope|reject", "detail": "..."}],
  "coverage_gaps": [{"area": "...", "severity": "low|medium|high", "detail": "..."}],
  "executive_summary": "3-5 sentences a sponsor could read",
  "readiness_score": 0
}
readiness_score is 0-100: how complete and coherent is this dataset for generating SA/PM deliverables (coverage breadth, contradiction load, gap severity).`;
}

import type { Project } from "@db/schema";
import type { CompiledDataset } from "../compiler";

/**
 * Team Agent prompts (build doc §6.5): generates the role-specific
 * deliverables from the Compiler's unified dataset.
 *   SA profile → Solution Design Document
 *   PM profile → Project Documentation
 * With the bundle, each deliverable also carries cross-role notes — the
 * cross-referencing layer that keeps the two documents consistent.
 */

export const PROFILE_SPECS = {
  SA: {
    docName: "Solution Design Document",
    guidance: `Write for the Solution Architect who owns the technical design. Sections:
1. Executive Overview — the engagement in technical terms
2. Current State Understanding — systems, processes, constraints discovered
3. Requirements Summary — functional and non-functional, grounded in stakeholder material
4. Proposed Solution Architecture — components, integrations, data flows
5. Integration & Data Considerations — specific risks and dependencies
6. Out-of-Scope Register — what was explicitly excluded and why
7. Open Questions & Assumptions — what still needs validation
8. Risks & Mitigations — technical risks from the compiled data`,
  },
  PM: {
    docName: "Project Documentation",
    guidance: `Write for the Project Manager who owns delivery. Sections:
1. Executive Summary — the engagement in delivery terms
2. Project Objectives & Success Criteria — as stated by stakeholders
3. Scope Statement — in scope / out of scope, grounded in the compiled register
4. Stakeholder Map — who said what, their concerns, their influence
5. Milestones & Phasing — proposed delivery structure
6. Dependencies & Constraints — external and internal
7. Risk Register — delivery risks from the compiled data, with owners and mitigations
8. Open Items & Next Steps`,
  },
} as const;

export type DeliverableProfile = keyof typeof PROFILE_SPECS;

function datasetBlock(d: CompiledDataset): string {
  return `COMPILED DATASET (readiness ${d.readiness_score}/100):
Executive summary: ${d.executive_summary}

Stakeholder coverage:
${d.stakeholder_coverage.map((s) => `- ${s.name} (${s.role_title}) — ${s.phases_covered}/4 phases`).join("\n")}

Contradictions:
${d.contradictions.map((c) => `- ${c.topic} [${c.severity}]: ${c.positions.map((p) => `${p.stakeholder}: "${p.claim}"`).join(" vs. ")}`).join("\n") || "(none)"}

Patterns:
${d.patterns.map((p) => `- ${p.theme} (support: ${p.supporting_stakeholders.join(", ")}): ${p.detail}`).join("\n") || "(none)"}

Out-of-scope register:
${d.out_of_scope_ranked.map((o) => `- ${o.item} [${o.recommendation}] (raised by ${o.raised_by.join(", ")}): ${o.detail}`).join("\n") || "(none)"}

Coverage gaps:
${d.coverage_gaps.map((g) => `- ${g.area} [${g.severity}]: ${g.detail}`).join("\n") || "(none)"}`;
}

export function deliverablePrompt(
  project: Project,
  profile: DeliverableProfile,
  dataset: CompiledDataset,
  otherDocSummary: string | null,
): string {
  const spec = PROFILE_SPECS[profile];
  return `You are the Team Agent for XP Architect, producing the ${spec.docName} for an enterprise software engagement.

Project: ${project.name}${project.clientName ? ` (client: ${project.clientName})` : ""}
Scope boundary:
${project.scopeText}
${project.constraintsText ? `Constraints:\n${project.constraintsText}` : ""}

${datasetBlock(dataset)}

${spec.guidance}

${
  otherDocSummary
    ? `CROSS-REFERENCING: the companion ${profile === "SA" ? "PM Project Documentation" : "SA Solution Design Document"} already exists. Its synopsis:\n${otherDocSummary}\nAdd cross-role notes: where this document depends on, contradicts, or hands off to the companion document.`
    : "No companion document exists yet — set cross_role_notes_md to null."
}

Rules:
- Every claim must trace to the compiled dataset; mark inference explicitly as "(inference)".
- Professional consulting tone; markdown body; no preamble outside the JSON.
- Body length: 600–1000 words of markdown.

Respond with STRICT JSON only:
{"title": "...", "body_md": "...markdown...", "cross_role_notes_md": "...markdown or null..."}`;
}

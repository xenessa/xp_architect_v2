import type { Project } from "@db/schema";
import type { CompiledDataset } from "../compiler";
import type { DeliverableTemplate, TemplateSection } from "../templates";

/**
 * Team Agent prompts (§6.5, v6): per-section generation against a template
 * skeleton. A shared system prompt carries role + document context; each
 * section gets its own user message with guidance + the compiled dataset.
 */

export function datasetBlock(d: CompiledDataset): string {
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

export function projectFrame(project: Project): string {
  return [
    `Project: ${project.name}`,
    project.clientName ? `Client: ${project.clientName}` : null,
    `Scope boundary:\n${project.scopeText}`,
    project.constraintsText ? `Constraints:\n${project.constraintsText}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function sectionSystemPrompt(template: DeliverableTemplate): string {
  return `You are the Team Agent for XP Architect, writing the ${template.name} for an enterprise software implementation engagement, one section at a time. Professional consulting tone. Write only the requested section's markdown body — no section heading, no preamble, no JSON.`;
}

export function sectionUserPrompt(
  project: Project,
  template: DeliverableTemplate,
  section: TemplateSection,
  dataset: CompiledDataset,
  feedback?: string,
): string {
  return `${projectFrame(project)}

${datasetBlock(dataset)}

You are writing this section of the ${template.name}:
Section: "${section.heading}"
Guidance: ${section.guidance}

${feedback ? `REVISION REQUEST from the project lead (apply faithfully): "${feedback}"\n` : ""}
Rules:
- Every claim must trace to the compiled dataset; mark inference explicitly as "(inference)".
- 80–200 words for this section's body; markdown lists welcome.
- Reference stakeholders by name where their input informs the point.`;
}

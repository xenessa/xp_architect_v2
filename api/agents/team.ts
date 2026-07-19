import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { llm, gatewayMode } from "./llm";
import { sectionSystemPrompt, sectionUserPrompt } from "./prompts/team";
import { templateById, type DeliverableTemplate, type TemplateId } from "./templates";
import { compiledDatasetSchema, type CompiledDataset } from "./compiler";
import { projects, compiledReports, deliverables, type Project } from "@db/schema";

/**
 * Team Agent (§6.5, v6): generates deliverables from templates — a fixed
 * section skeleton filled per section. Live mode writes each section with
 * the model; dev mode fills deterministically from the compiled dataset.
 */

export async function generateDeliverable(
  projectId: number,
  templateId: TemplateId,
  feedback?: string,
) {
  const db = getDb();
  const template = templateById(templateId);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const [report] = await db
    .select()
    .from(compiledReports)
    .where(eq(compiledReports.projectId, projectId))
    .orderBy(desc(compiledReports.version))
    .limit(1);
  if (!report) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Run the Compiler first — deliverables are built from the compiled dataset",
    });
  }
  const dataset = compiledDatasetSchema.parse(report.datasetJson);

  // Cross-referencing: synopsis of the companion profile's latest document.
  const otherProfile = template.profile === "SA" ? "PM" : "SA";
  const [otherDoc] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, projectId), eq(deliverables.profile, otherProfile)))
    .orderBy(desc(deliverables.updatedAt))
    .limit(1);
  const hasCompanion = Boolean(otherDoc?.contentMd);

  let sections: { heading: string; body: string }[];

  if (gatewayMode(project) === "live") {
    sections = [];
    for (const section of template.sections) {
      const result = await llm.complete(
        {
          agent: "team",
          purpose: `${templateId}:${section.heading.slice(0, 32)}`,
          projectId,
          temperature: 0.4,
          maxTokens: 1200,
          messages: [
            { role: "system", content: sectionSystemPrompt(template) },
            { role: "user", content: sectionUserPrompt(project, template, section, dataset, feedback) },
          ],
        },
        project,
      );
      sections.push({ heading: section.heading, body: result.text.trim() });
    }
  } else {
    sections = devSections(template, project, dataset, feedback);
    await llm.logDevCall(
      { agent: "team", purpose: `deliverable_${templateId}`, projectId, messages: [] },
      sections.reduce((n, s) => n + s.body.length, 0),
    );
  }

  const title = `${template.name} — ${project.name}${project.clientName ? ` for ${project.clientName}` : ""}`;
  const contentMd =
    `# ${title}\n\n` + sections.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n");

  const crossRoleNotesMd = hasCompanion
    ? `## Cross-Role Notes\nThe companion ${otherProfile} deliverable set exists for this project. Align shared sections (scope register, risks, open questions) whenever either document regenerates; divergences are flagged here after live-model comparison.`
    : null;

  const [prev] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, projectId), eq(deliverables.templateId, templateId)))
    .orderBy(desc(deliverables.version))
    .limit(1);
  const version = (prev?.version ?? 0) + 1;

  const priorLog = Array.isArray(prev?.feedbackLogJson)
    ? (prev.feedbackLogJson as unknown[])
    : [];
  const feedbackLog = feedback
    ? [...priorLog, { version, feedback, at: new Date().toISOString() }]
    : priorLog;

  const [inserted] = await db
    .insert(deliverables)
    .values({
      projectId,
      profile: template.profile,
      templateId,
      version,
      status: "draft",
      contentMd,
      crossRoleNotesMd,
      feedbackLogJson: feedbackLog,
    })
    .$returningId();

  return { id: inserted.id, templateId, profile: template.profile, version };
}

/* ------------------------------------------------------------------ */
/* Dev-mode deterministic fills — distinct content per template.       */
/* ------------------------------------------------------------------ */

function fragments(d: CompiledDataset) {
  const coverageList =
    d.stakeholder_coverage
      .map((s) => `- ${s.name}, ${s.role_title} — ${s.phases_covered}/4 phases complete`)
      .join("\n") || "- No stakeholders have completed discovery.";
  const oosList =
    d.out_of_scope_ranked
      .map((o) => `- **${o.item}** — recommendation: ${o.recommendation} (raised by ${o.raised_by.join(", ")})`)
      .join("\n") || "- No out-of-scope items were raised.";
  const gapList =
    d.coverage_gaps
      .map((g) => `- **${g.area}** [${g.severity}] — ${g.detail}`)
      .join("\n") || "- No coverage gaps detected.";
  const patternList =
    d.patterns
      .map((p) => `- **${p.theme}** (${p.supporting_stakeholders.join(", ")}): ${p.detail}`)
      .join("\n") || "- No cross-stakeholder patterns detected.";
  const contradictionList =
    d.contradictions
      .map(
        (c) =>
          `- **${c.topic}** [${c.severity}] — ${c.positions.map((p) => `${p.stakeholder}: "${p.claim}"`).join(" vs. ")}`,
      )
      .join("\n") || "- No contradictions between stakeholder positions detected.";
  return { coverageList, oosList, gapList, patternList, contradictionList };
}

const LIVE_NOTE =
  "(inference) Full narrative synthesis for this section runs when a live model endpoint is configured.";

function devSections(
  template: DeliverableTemplate,
  project: Project,
  d: CompiledDataset,
  feedback?: string,
): { heading: string; body: string }[] {
  const f = fragments(d);
  const bodies: Record<TemplateId, string[]> = {
    sdd: [
      `${d.executive_summary}\n\nDataset readiness: ${d.readiness_score}/100.`,
      `Discovery covered ${d.stakeholder_coverage.length} stakeholder(s):\n${f.coverageList}\n\nScope boundary as defined:\n> ${project.scopeText}`,
      `Signals recurring across stakeholders:\n${f.patternList}`,
      `${LIVE_NOTE} The architecture section will synthesize components, integrations, and data flows from the requirements above.`,
      `Items requiring validation before design sign-off:\n${f.gapList}`,
      f.oosList,
      `Unresolved positions to settle:\n${f.contradictionList}`,
      `Risks surfaced during discovery:\n${f.gapList}`,
    ],
    pm_charter: [
      `${d.executive_summary}`,
      `Objectives as consolidated from stakeholder input:\n${f.patternList}\n\nSuccess criteria to be confirmed against these objectives at kickoff.`,
      `In scope:\n> ${project.scopeText}\n\nOut of scope:\n${f.oosList}`,
      `Stakeholders of record:\n${f.coverageList}`,
      `${LIVE_NOTE} Milestone structure will be derived from constraints and stakeholder availability captured in discovery.`,
    ],
    pm_plan: [
      `${LIVE_NOTE} Delivery approach will be shaped by the constraint set and stakeholder availability.`,
      `Proposed phasing builds on completed discovery across ${d.stakeholder_coverage.length} stakeholder(s) (dataset readiness ${d.readiness_score}/100).`,
      `Open dependencies gating progress:\n${f.gapList}`,
      project.constraintsText
        ? `> ${project.constraintsText}`
        : "No formal constraints recorded for this engagement.",
      `${LIVE_NOTE} Cadence and governance recommendations will follow the stakeholder map.`,
    ],
    pm_risk_register: [
      `Ranked by severity, drawn from contradictions and coverage gaps:\n${f.contradictionList}\n${f.gapList}`,
      `${LIVE_NOTE} Mitigations and suggested owners will be drafted per risk.`,
      `Signals worth monitoring:\n${f.patternList}`,
    ],
    pm_stakeholder_map: [
      `Register of engaged stakeholders:\n${f.coverageList}`,
      `Alignment:\n${f.patternList}\n\nDivergence:\n${f.contradictionList}`,
      `${LIVE_NOTE} Per-stakeholder channel and cadence recommendations will be drafted from each person's stated concerns.`,
    ],
  };

  const revision = feedback
    ? `\n\n*Revision note: regenerated in response to lead feedback — "${feedback}".*`
    : "";

  return template.sections.map((section, i) => ({
    heading: section.heading,
    body: (bodies[template.id][i] ?? LIVE_NOTE) + (i === 0 ? revision : ""),
  }));
}

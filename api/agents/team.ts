import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { llm, gatewayMode } from "./llm";
import { deliverablePrompt, PROFILE_SPECS, type DeliverableProfile } from "./prompts/team";
import { compiledDatasetSchema, type CompiledDataset } from "./compiler";
import { projects, compiledReports, deliverables } from "@db/schema";

/**
 * Team Agent (build doc §6.5): generates the role-specific deliverables
 * from the latest compiled dataset. SA → Solution Design Document,
 * PM → Project Documentation; the bundle adds cross-role notes.
 */

const deliverableSchema = z.object({
  title: z.string().min(1),
  body_md: z.string().min(1),
  cross_role_notes_md: z.string().nullable(),
});

export async function generateDeliverable(
  projectId: number,
  profile: DeliverableProfile,
  feedback?: string,
) {
  const db = getDb();
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

  const otherProfile: DeliverableProfile = profile === "SA" ? "PM" : "SA";
  const [otherDoc] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, projectId), eq(deliverables.profile, otherProfile)))
    .orderBy(desc(deliverables.version))
    .limit(1);
  const otherSynopsis = otherDoc?.contentMd ? otherDoc.contentMd.slice(0, 500) : null;

  let result: z.infer<typeof deliverableSchema>;

  if (gatewayMode(project) === "live") {
    result = await llm.completeJson(
      {
        agent: "team",
        purpose: `deliverable_${profile.toLowerCase()}`,
        projectId,
        temperature: 0.4,
        maxTokens: 6000,
        messages: [
          {
            role: "user",
            content: deliverablePrompt(project, profile, dataset, otherSynopsis, feedback),
          },
        ],
      },
      deliverableSchema,
      project,
    );
  } else {
    result = devDeliverable(project, profile, dataset, otherSynopsis, feedback);
    await llm.logDevCall(
      { agent: "team", purpose: `deliverable_${profile.toLowerCase()}`, projectId, messages: [] },
      result.body_md.length,
    );
  }

  const [prev] = await db
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.projectId, projectId), eq(deliverables.profile, profile)))
    .orderBy(desc(deliverables.version))
    .limit(1);
  const version = (prev?.version ?? 0) + 1;

  // Feedback audit trail (§6.5): carry the prior log, append this round.
  const priorLog = Array.isArray(prev?.feedbackLogJson) ? (prev.feedbackLogJson as unknown[]) : [];
  const feedbackLog = feedback
    ? [...priorLog, { version, feedback, at: new Date().toISOString() }]
    : priorLog;

  const [inserted] = await db
    .insert(deliverables)
    .values({
      projectId,
      profile,
      version,
      status: "draft",
      contentMd: `# ${result.title}\n\n${result.body_md}`,
      crossRoleNotesMd: result.cross_role_notes_md,
      feedbackLogJson: feedbackLog,
    })
    .$returningId();

  return { id: inserted.id, profile, version };
}

/** Dev-mode deliverable: deterministic, honest markdown built from the dataset. */
function devDeliverable(
  project: { name: string; clientName: string | null; scopeText: string; constraintsText: string | null },
  profile: DeliverableProfile,
  d: CompiledDataset,
  otherSynopsis: string | null,
  feedback?: string,
): z.infer<typeof deliverableSchema> {
  const spec = PROFILE_SPECS[profile];
  const client = project.clientName ? ` for ${project.clientName}` : "";

  const oosSection = d.out_of_scope_ranked.length
    ? d.out_of_scope_ranked
        .map(
          (o) =>
            `- **${o.item}** — recommendation: ${o.recommendation} (raised by ${o.raised_by.join(", ")})`,
        )
        .join("\n")
    : "- No out-of-scope items were raised during discovery.";

  const gapSection = d.coverage_gaps.length
    ? d.coverage_gaps.map((g) => `- **${g.area}** [${g.severity}] — ${g.detail}`).join("\n")
    : "- No coverage gaps detected.";

  const patternSection = d.patterns.length
    ? d.patterns
        .map((p) => `- **${p.theme}** (${p.supporting_stakeholders.join(", ")}): ${p.detail}`)
        .join("\n")
    : "- No cross-stakeholder patterns detected.";

  const coverageList = d.stakeholder_coverage
    .map((s) => `- ${s.name}, ${s.role_title} — ${s.phases_covered}/4 phases complete`)
    .join("\n");

  const body =
    profile === "SA"
      ? [
          `## 1. Executive Overview\n${d.executive_summary}`,
          `## 2. Current State Understanding\nDiscovery covered ${d.stakeholder_coverage.length} stakeholder(s):\n${coverageList}\n\nScope boundary as defined:\n> ${project.scopeText}`,
          `## 3. Requirements Summary\nSignals recurring across stakeholders:\n${patternSection}`,
          `## 4. Proposed Solution Architecture\n(inference) Detailed architecture requires a live model endpoint; this section will synthesize components, integrations, and data flows from the requirements above once generation runs against a live model.`,
          `## 5. Integration & Data Considerations\nCoverage gaps requiring validation before design sign-off:\n${gapSection}`,
          `## 6. Out-of-Scope Register\n${oosSection}`,
          `## 7. Open Questions & Assumptions\n${d.contradictions.length ? d.contradictions.map((c) => `- Unresolved position on **${c.topic}** (${c.severity})`).join("\n") : "- No contradictions between stakeholder positions detected."}`,
          `## 8. Risks & Mitigations\n${gapSection}`,
        ].join("\n\n")
      : [
          `## 1. Executive Summary\n${d.executive_summary}`,
          `## 2. Project Objectives & Success Criteria\nDerived from stakeholder-approved discovery summaries across ${d.stakeholder_coverage.length} stakeholder(s). Dataset readiness: ${d.readiness_score}/100.`,
          `## 3. Scope Statement\nIn scope:\n> ${project.scopeText}\n\nOut of scope:\n${oosSection}`,
          `## 4. Stakeholder Map\n${coverageList}`,
          `## 5. Milestones & Phasing\n(inference) Phasing detail is synthesized when generation runs against a live model endpoint; stakeholder availability windows captured during discovery feed the plan.`,
          `## 6. Dependencies & Constraints\n${project.constraintsText ? `> ${project.constraintsText}` : "No formal constraints recorded."}\n\nOpen dependencies:\n${gapSection}`,
          `## 7. Risk Register\n${d.contradictions.length ? d.contradictions.map((c) => `- **${c.topic}** [${c.severity}] — positions: ${c.positions.map((p) => `${p.stakeholder}: "${p.claim}"`).join(" vs. ")}`).join("\n") : "- No contradictions logged."}\n${gapSection}`,
          `## 8. Open Items & Next Steps\n${gapSection}`,
        ].join("\n\n");

  const cross = otherSynopsis
    ? `## Cross-Role Notes\nThe companion ${profile === "SA" ? "PM Project Documentation" : "SA Solution Design Document"} exists. Align shared sections (scope register, risks, open questions) at each regeneration; divergences are flagged here after live-model comparison.`
    : null;

  const bodyWithFeedback = feedback
    ? `${body}\n\n## Revision Notes\nThis version was regenerated in response to lead feedback: "${feedback}". The feedback is logged in the audit trail; full narrative synthesis of revisions runs when a live model endpoint is configured.`
    : body;

  return {
    title: `${spec.docName} — ${project.name}${client}`,
    body_md: bodyWithFeedback,
    cross_role_notes_md: cross,
  };
}

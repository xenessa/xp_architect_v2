import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { llm, gatewayMode } from "./llm";
import {
  alertPassPrompt,
  consolidationPrompt,
  type SessionDigest,
} from "./prompts/compiler";
import {
  projects,
  stakeholders,
  stakeholderSessions,
  phaseSummaries,
  discoveryFlags,
  compilerAlerts,
  compiledReports,
  type Project,
} from "@db/schema";

/**
 * Compiler Agent (build doc §6.4): cross-stakeholder analysis.
 *  - Incremental alert pass after each session completes (fire-and-forget
 *    from submitFinal — never blocks the stakeholder).
 *  - Batch consolidation into compiled_reports (lead-triggered; deliverable
 *    generation in Phase 5 consumes the latest version).
 */

const alertPassSchema = z.object({
  alerts: z
    .array(
      z.object({
        type: z.enum(["contradiction", "risk", "scope_creep", "coverage_gap"]),
        severity: z.enum(["low", "medium", "high"]),
        message: z.string().min(1),
      }),
    )
    .max(5),
});

export const compiledDatasetSchema = z.object({
  stakeholder_coverage: z.array(
    z.object({
      name: z.string(),
      role_title: z.string(),
      phases_covered: z.number().int().min(0).max(4),
    }),
  ),
  contradictions: z.array(
    z.object({
      topic: z.string(),
      positions: z.array(z.object({ stakeholder: z.string(), claim: z.string() })),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  patterns: z.array(
    z.object({
      theme: z.string(),
      supporting_stakeholders: z.array(z.string()),
      detail: z.string(),
    }),
  ),
  out_of_scope_ranked: z.array(
    z.object({
      item: z.string(),
      raised_by: z.array(z.string()),
      recommendation: z.enum(["defer", "re-scope", "reject"]),
      detail: z.string(),
    }),
  ),
  coverage_gaps: z.array(
    z.object({
      area: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      detail: z.string(),
    }),
  ),
  executive_summary: z.string(),
  readiness_score: z.number().int().min(0).max(100),
});
export type CompiledDataset = z.infer<typeof compiledDatasetSchema>;

/** Build the digest for one completed session (stakeholder + summaries + flags). */
async function sessionDigest(sessionId: number): Promise<SessionDigest | null> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(stakeholderSessions)
    .where(eq(stakeholderSessions.id, sessionId))
    .limit(1);
  if (!session) return null;
  const [stakeholder] = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.id, session.stakeholderId))
    .limit(1);
  if (!stakeholder) return null;

  const summaries = await db
    .select()
    .from(phaseSummaries)
    .where(eq(phaseSummaries.sessionId, sessionId))
    .orderBy(asc(phaseSummaries.phase));
  const flags = await db
    .select()
    .from(discoveryFlags)
    .where(eq(discoveryFlags.sessionId, sessionId))
    .orderBy(asc(discoveryFlags.createdAt));

  return {
    stakeholderName: stakeholder.name,
    roleTitle: stakeholder.roleTitle,
    summaries: summaries.map((s) => ({ phase: s.phase, content: s.summary })),
    flags: flags.map((f) => ({ type: f.type, severity: f.severity, text: f.text })),
  };
}

async function completedSessionIds(projectId: number): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ id: stakeholderSessions.id })
    .from(stakeholderSessions)
    .innerJoin(stakeholders, eq(stakeholderSessions.stakeholderId, stakeholders.id))
    .where(
      and(
        eq(stakeholders.projectId, projectId),
        eq(stakeholderSessions.state, "COMPLETED"),
      ),
    )
    .orderBy(asc(stakeholderSessions.id));
  return rows.map((r) => r.id);
}

/** Incremental pass — runs (fire-and-forget) after a session reaches COMPLETED. */
export async function runIncrementalAlertPass(sessionId: number): Promise<void> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(stakeholderSessions)
    .where(eq(stakeholderSessions.id, sessionId))
    .limit(1);
  if (!session || session.state !== "COMPLETED") return;

  const [stakeholder] = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.id, session.stakeholderId))
    .limit(1);
  if (!stakeholder) return;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, stakeholder.projectId))
    .limit(1);
  if (!project) return;

  const mine = await sessionDigest(sessionId);
  if (!mine) return;
  const otherIds = (await completedSessionIds(project.id)).filter(
    (id) => id !== sessionId,
  );
  const others = (
    await Promise.all(otherIds.map((id) => sessionDigest(id)))
  ).filter((d): d is SessionDigest => d !== null);

  let alerts: z.infer<typeof alertPassSchema>["alerts"];

  if (gatewayMode(project) === "live") {
    const result = await llm.completeJson(
      {
        agent: "compiler",
        purpose: "alert_pass",
        projectId: project.id,
        sessionId,
        temperature: 0.3,
        maxTokens: 1200,
        messages: [
          { role: "user", content: alertPassPrompt(project, mine, others) },
        ],
      },
      alertPassSchema,
      project,
    );
    alerts = result.alerts;
  } else {
    // Dev mode: deterministic alerts derived from the real session data.
    alerts = [];
    const highOos = mine.flags.filter(
      (f) => f.type === "out_of_scope" && f.severity !== "low",
    );
    if (highOos.length > 0) {
      alerts.push({
        type: "scope_creep",
        severity: "medium",
        message: `${mine.stakeholderName} raised ${highOos.length} out-of-scope item(s) at medium+ severity — accumulating demand beyond the scope boundary.`,
      });
    }
    if (others.length > 0) {
      alerts.push({
        type: "contradiction",
        severity: "low",
        message: `${mine.stakeholderName} and ${others[0].stakeholderName} have both completed — cross-session contradiction detection runs fully with a live model endpoint configured.`,
      });
    }
    await llm.logDevCall(
      {
        agent: "compiler",
        purpose: "alert_pass",
        projectId: project.id,
        sessionId,
        messages: [],
      },
      JSON.stringify(alerts).length,
    );
  }

  for (const a of alerts) {
    await db.insert(compilerAlerts).values({
      projectId: project.id,
      sessionId,
      type: a.type,
      severity: a.severity,
      message: a.message,
    });
  }
}

/** Batch consolidation — lead-triggered; writes a new compiled_reports version. */
export async function runBatchConsolidation(projectId: number) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const ids = await completedSessionIds(projectId);
  if (ids.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No completed discovery sessions to compile yet",
    });
  }
  const digests = (
    await Promise.all(ids.map((id) => sessionDigest(id)))
  ).filter((d): d is SessionDigest => d !== null);

  const [{ count: totalStakeholders }] = await db
    .select({ count: sqlCount() })
    .from(stakeholders)
    .where(eq(stakeholders.projectId, projectId));

  let dataset: CompiledDataset;

  if (gatewayMode(project) === "live") {
    dataset = await llm.completeJson(
      {
        agent: "compiler",
        purpose: "consolidation",
        projectId,
        temperature: 0.3,
        maxTokens: 4000,
        messages: [{ role: "user", content: consolidationPrompt(project, digests) }],
      },
      compiledDatasetSchema,
      project,
    );
  } else {
    dataset = devConsolidation(project, digests, Number(totalStakeholders));
    await llm.logDevCall(
      { agent: "compiler", purpose: "consolidation", projectId, messages: [] },
      JSON.stringify(dataset).length,
    );
  }

  const [prev] = await db
    .select({ version: compiledReports.version })
    .from(compiledReports)
    .where(eq(compiledReports.projectId, projectId))
    .orderBy(desc(compiledReports.version))
    .limit(1);
  const version = (prev?.version ?? 0) + 1;

  const [inserted] = await db
    .insert(compiledReports)
    .values({ projectId, version, datasetJson: dataset })
    .$returningId();

  return { id: inserted.id, version, dataset };
}

function sqlCount() {
  return sql<number>`count(*)`;
}

/** Dev-mode consolidation: deterministic dataset built from the real material. */
function devConsolidation(
  project: Project,
  digests: SessionDigest[],
  totalStakeholders: number,
): CompiledDataset {
  const coverage = digests.map((d) => ({
    name: d.stakeholderName,
    role_title: d.roleTitle,
    phases_covered: d.summaries.length,
  }));

  // Group out-of-scope flags across stakeholders into ranked items.
  const oosGroups = new Map<string, string[]>();
  for (const d of digests) {
    for (const f of d.flags) {
      if (f.type !== "out_of_scope") continue;
      const key = f.text.slice(0, 80);
      oosGroups.set(key, [...(oosGroups.get(key) ?? []), d.stakeholderName]);
    }
  }
  const outOfScope = [...oosGroups.entries()]
    .map(([item, raisedBy]) => ({
      item,
      raised_by: raisedBy,
      recommendation: "defer" as const,
      detail: `Raised by ${raisedBy.length} stakeholder(s); outside the current scope boundary.`,
    }))
    .sort((a, b) => b.raised_by.length - a.raised_by.length);

  // Coverage gaps: phases with no approved summary content, per stakeholder.
  const gaps = digests
    .filter((d) => d.summaries.length < 4)
    .map((d) => ({
      area: `${d.stakeholderName} — incomplete phase coverage`,
      severity: "medium" as const,
      detail: `Only ${d.summaries.length} of 4 phases have approved summaries.`,
    }));

  // Patterns: flag types shared by 2+ stakeholders.
  const byType = new Map<string, Set<string>>();
  for (const d of digests) {
    for (const f of d.flags) {
      byType.set(f.type, new Set([...(byType.get(f.type) ?? []), d.stakeholderName]));
    }
  }
  const patterns = [...byType.entries()]
    .filter(([, names]) => names.size >= 2)
    .map(([type, names]) => ({
      theme: `Recurring ${type.replace(/_/g, " ")} signals`,
      supporting_stakeholders: [...names],
      detail: `${names.size} stakeholders raised ${type.replace(/_/g, " ")} items during discovery.`,
    }));

  const completionRatio =
    totalStakeholders > 0 ? digests.length / totalStakeholders : 0;
  const avgPhases =
    digests.length > 0
      ? digests.reduce((n, d) => n + d.summaries.length, 0) / digests.length / 4
      : 0;
  const readiness = Math.min(
    100,
    Math.round(avgPhases * 60 + completionRatio * 40 - gaps.length * 5),
  );

  return compiledDatasetSchema.parse({
    stakeholder_coverage: coverage,
    contradictions: [],
    patterns,
    out_of_scope_ranked: outOfScope,
    coverage_gaps: gaps,
    executive_summary:
      `Consolidated ${digests.length} of ${totalStakeholders} stakeholder(s) for ${project.name}. ` +
      `${outOfScope.length} out-of-scope theme(s) and ${gaps.length} coverage gap(s) identified from the recorded material. ` +
      `Contradiction and deep pattern analysis activates when a live model endpoint is configured.`,
    readiness_score: Math.max(0, readiness),
  });
}

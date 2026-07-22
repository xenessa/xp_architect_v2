import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import {
  projects,
  stakeholders,
  stakeholderSessions,
  compiledReports,
  compilerAlerts,
  type Project,
} from "@db/schema";

/** Fetch a project and assert the current user owns it (§8). */
export async function assertProjectOwner(
  projectId: number,
  userId: number,
): Promise<Project> {
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .limit(1);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project;
}

export type ProjectStage = "SETUP" | "DISCOVERY_OPEN" | "COMPILATION_READY" | "DELIVERABLES";

/**
 * Derived project state machine (§3.2) — computed, never stored:
 *   SETUP → DISCOVERY_OPEN → COMPILATION_READY → DELIVERABLES
 */
export async function computeProjectStage(projectId: number): Promise<ProjectStage> {
  const db = getDb();
  const projectStakeholders = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.projectId, projectId));

  if (projectStakeholders.length === 0) return "SETUP";

  const sessions = await db
    .select()
    .from(stakeholderSessions)
    .where(
      inArray(
        stakeholderSessions.stakeholderId,
        projectStakeholders.map((s) => s.id),
      ),
    );

  const allCompleted =
    sessions.length > 0 && sessions.every((s) => s.state === "COMPLETED");
  if (!allCompleted) return "DISCOVERY_OPEN";

  const reports = await db
    .select()
    .from(compiledReports)
    .where(eq(compiledReports.projectId, projectId))
    .limit(1);

  return reports.length > 0 ? "DELIVERABLES" : "COMPILATION_READY";
}

/** Per-project rollup for dashboard cards (§10.2) — incl. alert badge count. */
export async function projectRollup(projectId: number) {
  const db = getDb();
  const projectStakeholders = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.projectId, projectId));

  let completed = 0;
  if (projectStakeholders.length > 0) {
    const sessions = await db
      .select()
      .from(stakeholderSessions)
      .where(
        inArray(
          stakeholderSessions.stakeholderId,
          projectStakeholders.map((s) => s.id),
        ),
      );
    completed = sessions.filter((s) => s.state === "COMPLETED").length;
  }

  // Unread compiler alerts → dashboard card badge (§10.2).
  const unreadAlerts = await db
    .select({ id: compilerAlerts.id })
    .from(compilerAlerts)
    .where(and(eq(compilerAlerts.projectId, projectId), eq(compilerAlerts.read, false)));

  // Most recent stakeholder touch → "last activity" on the card.
  let lastActivityAt: Date | null = null;
  for (const s of projectStakeholders) {
    const t = s.lastActivityAt ?? s.invitedAt;
    if (t && (!lastActivityAt || t > lastActivityAt)) lastActivityAt = t;
  }

  const stage = await computeProjectStage(projectId);
  return {
    stakeholderCount: projectStakeholders.length,
    completedCount: completed,
    unreadAlertCount: unreadAlerts.length,
    lastActivityAt,
    stage,
  };
}

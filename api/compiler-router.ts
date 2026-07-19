import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner } from "./queries/projects";
import { runBatchConsolidation } from "./agents/compiler";
import { runNudgeSweep } from "./nudges";
import { publicOrigin } from "./origin";
import {
  compilerAlerts,
  compiledReports,
  stakeholders,
  stakeholderSessions,
} from "@db/schema";

/**
 * Compilation API (§6.4, §10.3) — project-lead facing:
 * alerts from the incremental pass + versioned compiled datasets.
 */
export const compilerRouter = createRouter({
  /** Alerts + latest compiled dataset for the Compilation tab. */
  getCompilation: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const db = getDb();

      // Lazy nudge sweep on dashboard read (no scheduler in this environment).
      void runNudgeSweep(input.projectId, publicOrigin(ctx.req)).catch((err) =>
        console.warn("[nudges] sweep failed:", err),
      );

      const alerts = await db
        .select()
        .from(compilerAlerts)
        .where(eq(compilerAlerts.projectId, input.projectId))
        .orderBy(desc(compilerAlerts.createdAt), desc(compilerAlerts.id))
        .limit(50);

      const reports = await db
        .select()
        .from(compiledReports)
        .where(eq(compiledReports.projectId, input.projectId))
        .orderBy(desc(compiledReports.version))
        .limit(1);

      const [{ value: stakeholderCount }] = await db
        .select({ value: sql<number>`count(*)` })
        .from(stakeholders)
        .where(eq(stakeholders.projectId, input.projectId));
      const [{ value: completedCount }] = await db
        .select({ value: sql<number>`count(*)` })
        .from(stakeholderSessions)
        .innerJoin(stakeholders, eq(stakeholderSessions.stakeholderId, stakeholders.id))
        .where(
          and(
            eq(stakeholders.projectId, input.projectId),
            eq(stakeholderSessions.state, "COMPLETED"),
          ),
        );

      const latest = reports[0] ?? null;
      return {
        alerts,
        unreadCount: alerts.filter((a) => !a.read).length,
        latestReport: latest
          ? { id: latest.id, version: latest.version, createdAt: latest.createdAt, dataset: latest.datasetJson }
          : null,
        stakeholderCount: Number(stakeholderCount),
        completedCount: Number(completedCount),
      };
    }),

  /** Run (or re-run) batch consolidation — creates a new report version. */
  runCompilation: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      return runBatchConsolidation(input.projectId);
    }),

  markAlertRead: authedQuery
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [alert] = await db
        .select()
        .from(compilerAlerts)
        .where(eq(compilerAlerts.id, input.alertId))
        .limit(1);
      if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      await assertProjectOwner(alert.projectId, ctx.user.id);
      await db
        .update(compilerAlerts)
        .set({ read: true })
        .where(eq(compilerAlerts.id, input.alertId));
      return { ok: true };
    }),

  markAllAlertsRead: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      await getDb()
        .update(compilerAlerts)
        .set({ read: true })
        .where(
          and(
            eq(compilerAlerts.projectId, input.projectId),
            eq(compilerAlerts.read, false),
          ),
        );
      return { ok: true };
    }),
});

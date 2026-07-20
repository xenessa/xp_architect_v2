import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner, computeProjectStage, projectRollup } from "./queries/projects";
import { gatewayMode, envEndpointInfo } from "./agents/llm";
import {
  projects,
  projectRoleProfiles,
  stakeholders,
  stakeholderSessions,
  assessmentResults,
  conversationMessages,
  phaseSummaries,
  discoveryFlags,
  agentHandoffs,
  compilerAlerts,
  compiledReports,
  deliverables,
  purchases,
  emailLogs,
  llmCallLogs,
} from "@db/schema";

const llmEndpointSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

export const projectsRouter = createRouter({
  create: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        clientName: z.string().max(255).optional(),
        scopeText: z.string().min(1),
        budget: z.string().max(255).optional(),
        timeline: z.string().max(255).optional(),
        teamSize: z.string().max(255).optional(),
        constraintsText: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.insert(projects).values({
        ownerId: ctx.user.id,
        name: input.name,
        clientName: input.clientName ?? null,
        scopeText: input.scopeText,
        budget: input.budget ?? null,
        timeline: input.timeline ?? null,
        teamSize: input.teamSize ?? null,
        constraintsText: input.constraintsText ?? null,
      });
      const id = Number(result[0].insertId);
      const [project] = await db.select().from(projects).where(eq(projects.id, id));
      return project;
    }),

  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, ctx.user.id), eq(projects.status, "active")))
      .orderBy(desc(projects.createdAt));

    return Promise.all(
      rows.map(async (p) => ({ ...p, rollup: await projectRollup(p.id) })),
    );
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await assertProjectOwner(input.id, ctx.user.id);
      const rollup = await projectRollup(project.id);
      return { ...project, rollup };
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        clientName: z.string().max(255).optional(),
        scopeText: z.string().min(1).optional(),
        budget: z.string().max(255).optional(),
        timeline: z.string().max(255).optional(),
        teamSize: z.string().max(255).optional(),
        constraintsText: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.id, ctx.user.id);
      const { id, ...fields } = input;
      await getDb().update(projects).set(fields).where(eq(projects.id, id));
      const [project] = await getDb().select().from(projects).where(eq(projects.id, id));
      return project;
    }),

  /**
   * BYO model endpoint (§9.3 privacy tier 2, Q7): point this project's LLM
   * traffic at a customer-supplied OpenAI-compatible endpoint. Config-only —
   * set/cleared here; the gateway prefers it over environment defaults.
   */
  updateLlmEndpoint: authedQuery
    .input(
      z.object({
        id: z.number(),
        endpoint: z
          .object({
            baseUrl: z.string().url().max(500),
            apiKey: z.string().min(1).max(500),
            model: z.string().min(1).max(255),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.id, ctx.user.id);
      await getDb()
        .update(projects)
        .set({ llmEndpointJson: input.endpoint })
        .where(eq(projects.id, input.id));
      return { ok: true, configured: input.endpoint !== null };
    }),

  /** LLM gateway status for this project (names only — never secrets). */
  llmStatus: authedQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const project = await assertProjectOwner(input.id, ctx.user.id);
    const byo = Boolean(
      (project.llmEndpointJson as { baseUrl?: string } | null)?.baseUrl,
    );
    const envInfo = envEndpointInfo();
    return {
      mode: gatewayMode(project),
      source: byo ? "byo" : envInfo.configured ? "env" : null,
      model: byo
        ? ((project.llmEndpointJson as { model?: string } | null)?.model ?? null)
        : (envInfo.model ?? null),
      chatModel: byo ? null : (envInfo.chatModel ?? null),
      baseUrl: byo
        ? ((project.llmEndpointJson as { baseUrl?: string } | null)?.baseUrl ?? null)
        : (envInfo.baseUrl ?? null),
    };
  }),

  /** Full cascade delete (§9.2 retention & deletion). */
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.id, ctx.user.id);
      const db = getDb();
      const pid = input.id;

      const projectStakeholders = await db
        .select()
        .from(stakeholders)
        .where(eq(stakeholders.projectId, pid));
      const stakeholderIds = projectStakeholders.map((s) => s.id);

      if (stakeholderIds.length > 0) {
        const sessions = await db
          .select()
          .from(stakeholderSessions)
          .where(inArray(stakeholderSessions.stakeholderId, stakeholderIds));
        const sessionIds = sessions.map((s) => s.id);

        if (sessionIds.length > 0) {
          await db.delete(assessmentResults).where(inArray(assessmentResults.sessionId, sessionIds));
          await db.delete(conversationMessages).where(inArray(conversationMessages.sessionId, sessionIds));
          await db.delete(phaseSummaries).where(inArray(phaseSummaries.sessionId, sessionIds));
          await db.delete(discoveryFlags).where(inArray(discoveryFlags.sessionId, sessionIds));
          await db.delete(agentHandoffs).where(inArray(agentHandoffs.sessionId, sessionIds));
          await db.delete(compilerAlerts).where(inArray(compilerAlerts.sessionId, sessionIds));
          await db.delete(llmCallLogs).where(inArray(llmCallLogs.sessionId, sessionIds));
        }
        await db.delete(stakeholderSessions).where(inArray(stakeholderSessions.stakeholderId, stakeholderIds));
        await db.delete(emailLogs).where(inArray(emailLogs.stakeholderId, stakeholderIds));
        await db.delete(stakeholders).where(inArray(stakeholders.id, stakeholderIds));
      }
      await db.delete(llmCallLogs).where(eq(llmCallLogs.projectId, pid));

      await db.delete(agentHandoffs).where(eq(agentHandoffs.projectId, pid));
      await db.delete(compilerAlerts).where(eq(compilerAlerts.projectId, pid));
      await db.delete(compiledReports).where(eq(compiledReports.projectId, pid));
      await db.delete(deliverables).where(eq(deliverables.projectId, pid));
      await db.delete(purchases).where(eq(purchases.projectId, pid));
      await db.delete(emailLogs).where(eq(emailLogs.projectId, pid));
      await db.delete(projectRoleProfiles).where(eq(projectRoleProfiles.projectId, pid));
      await db.delete(projects).where(eq(projects.id, pid));

      return { ok: true };
    }),

  /** BYO model endpoint config — privacy tier 2 (§9.3). */
  setLlmEndpoint: authedQuery
    .input(z.object({ id: z.number(), endpoint: llmEndpointSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.id, ctx.user.id);
      await getDb()
        .update(projects)
        .set({ llmEndpointJson: input.endpoint })
        .where(eq(projects.id, input.id));
      return { ok: true };
    }),

  stage: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.id, ctx.user.id);
      return { stage: await computeProjectStage(input.id) };
    }),
});

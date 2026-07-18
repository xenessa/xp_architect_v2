import { z } from "zod";
import { randomBytes } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner } from "./queries/projects";
import { sendEmail, inviteEmailHtml } from "./mailer";
import {
  stakeholders,
  stakeholderSessions,
  assessmentResults,
  conversationMessages,
  phaseSummaries,
  discoveryFlags,
  agentHandoffs,
  compilerAlerts,
  llmCallLogs,
  emailLogs,
} from "@db/schema";

const INVITE_TTL_DAYS = 30; // Q6: 30-day invite tokens

function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function originOf(req: Request): string {
  return new URL(req.url).origin;
}

async function requireStakeholder(id: number) {
  const [stakeholder] = await getDb()
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.id, id))
    .limit(1);
  if (!stakeholder) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Stakeholder not found" });
  }
  return stakeholder;
}

async function sendInviteEmail(params: {
  req: Request;
  inviterName: string;
  projectName: string;
  stakeholder: { id: number; name: string; email: string; inviteToken: string };
  projectId: number;
}) {
  const inviteUrl = `${originOf(params.req)}/s/${params.stakeholder.inviteToken}`;
  await sendEmail({
    to: params.stakeholder.email,
    subject: `You're invited: discovery session for ${params.projectName}`,
    html: inviteEmailHtml({
      stakeholderName: params.stakeholder.name,
      projectName: params.projectName,
      inviterName: params.inviterName,
      inviteUrl,
    }),
    type: "invite",
    stakeholderId: params.stakeholder.id,
    projectId: params.projectId,
  });
  return inviteUrl;
}

export const stakeholdersRouter = createRouter({
  /** Add a stakeholder: creates invite token + INVITED session, sends invite email (§6.1). */
  add: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().min(1).max(255),
        roleTitle: z.string().min(1).max(255),
        email: z.string().email().max(320),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectOwner(input.projectId, ctx.user.id);
      const db = getDb();

      const result = await db.insert(stakeholders).values({
        projectId: input.projectId,
        name: input.name,
        roleTitle: input.roleTitle,
        email: input.email,
        inviteToken: newInviteToken(),
        inviteExpiresAt: inviteExpiry(),
      });
      const id = Number(result[0].insertId);

      // Every stakeholder gets a session row in INVITED state (§3.1).
      await db.insert(stakeholderSessions).values({ stakeholderId: id });

      const stakeholder = await requireStakeholder(id);
      const inviteUrl = await sendInviteEmail({
        req: ctx.req,
        inviterName: ctx.user.name ?? "Your project lead",
        projectName: project.name,
        stakeholder,
        projectId: project.id,
      });

      return { ...stakeholder, inviteUrl };
    }),

  list: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      return getDb()
        .select()
        .from(stakeholders)
        .where(eq(stakeholders.projectId, input.projectId))
        .orderBy(asc(stakeholders.createdAt));
    }),

  /** Remove a stakeholder and everything attached to their session. */
  remove: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const stakeholder = await requireStakeholder(input.id);
      await assertProjectOwner(stakeholder.projectId, ctx.user.id);

      const sessions = await db
        .select()
        .from(stakeholderSessions)
        .where(eq(stakeholderSessions.stakeholderId, input.id));
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length > 0) {
        await db.delete(assessmentResults).where(inArray(assessmentResults.sessionId, sessionIds));
        await db.delete(conversationMessages).where(inArray(conversationMessages.sessionId, sessionIds));
        await db.delete(phaseSummaries).where(inArray(phaseSummaries.sessionId, sessionIds));
        await db.delete(discoveryFlags).where(inArray(discoveryFlags.sessionId, sessionIds));
        await db.delete(agentHandoffs).where(inArray(agentHandoffs.sessionId, sessionIds));
        await db.delete(compilerAlerts).where(inArray(compilerAlerts.sessionId, sessionIds));
        await db.delete(llmCallLogs).where(inArray(llmCallLogs.sessionId, sessionIds));
        await db.delete(stakeholderSessions).where(inArray(stakeholderSessions.id, sessionIds));
      }
      await db.delete(emailLogs).where(eq(emailLogs.stakeholderId, input.id));
      await db.delete(stakeholders).where(eq(stakeholders.id, input.id));
      return { ok: true };
    }),

  /** Resend the invite email with the existing token. */
  resendInvite: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const stakeholder = await requireStakeholder(input.id);
      const project = await assertProjectOwner(stakeholder.projectId, ctx.user.id);
      const inviteUrl = await sendInviteEmail({
        req: ctx.req,
        inviterName: ctx.user.name ?? "Your project lead",
        projectName: project.name,
        stakeholder,
        projectId: project.id,
      });
      return { ok: true, inviteUrl };
    }),

  /** Regenerate the invite token (new link, fresh 30-day expiry) and resend. */
  regenerateInvite: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await requireStakeholder(input.id);
      const project = await assertProjectOwner(existing.projectId, ctx.user.id);

      await db
        .update(stakeholders)
        .set({ inviteToken: newInviteToken(), inviteExpiresAt: inviteExpiry() })
        .where(eq(stakeholders.id, input.id));
      const stakeholder = await requireStakeholder(input.id);

      const inviteUrl = await sendInviteEmail({
        req: ctx.req,
        inviterName: ctx.user.name ?? "Your project lead",
        projectName: project.name,
        stakeholder,
        projectId: project.id,
      });
      return { ok: true, inviteUrl };
    }),

  /** Progress rows: stakeholder × state-machine position (basic; enriched in Phase 4). */
  progress: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const db = getDb();
      const rows = await db
        .select()
        .from(stakeholders)
        .where(eq(stakeholders.projectId, input.projectId))
        .orderBy(asc(stakeholders.createdAt));

      return Promise.all(
        rows.map(async (s) => {
          const [session] = await db
            .select()
            .from(stakeholderSessions)
            .where(eq(stakeholderSessions.stakeholderId, s.id))
            .limit(1);
          return { stakeholder: s, session: session ?? null };
        }),
      );
    }),
});

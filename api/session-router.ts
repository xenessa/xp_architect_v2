import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { publicOrigin } from "./origin";
import {
  stakeholders,
  stakeholderSessions,
  conversationMessages,
  assessmentResults,
  phaseSummaries,
  projects,
  users,
} from "@db/schema";
import {
  startAssessment,
  assessmentReply,
  submitFormAssessment,
} from "./agents/assessment";
import {
  startDiscovery,
  discoveryReply,
  approvePhaseSummary,
  getReview,
  flagReviewItem,
  submitFinal,
} from "./agents/discovery";

/**
 * Stakeholder-facing router (build doc §7, §8).
 * Every procedure is scoped to a valid invite token; token holders can only
 * reach rows belonging to their own session.
 */

const tokenInput = z.object({ token: z.string().min(10) });

/**
 * Sliding-window rate limits per invite token (build doc §7: token
 * procedures are rate-limited). The invite URL is the stakeholder's only
 * credential — a leaked link must not allow unbounded LLM spend.
 * Two tiers: a transport-level ceiling on all token procedures, and a
 * tighter budget on the procedures that trigger model calls.
 * Per-instance memory, mirroring the magic-link limiter in auth-magic.ts.
 */
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMITS = { general: 240, llm: 40 } as const;
const rateLog = new Map<string, number[]>();

export function enforceTokenRateLimit(
  token: string,
  kind: keyof typeof RATE_LIMITS = "general",
) {
  const now = Date.now();
  const key = `${kind}:${token}`;
  const recent = (rateLog.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMITS[kind]) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        kind === "llm"
          ? "That's a lot of messages in a short time — take a short break and continue in a few minutes. Your progress is saved."
          : "Too many requests — please wait a moment and try again.",
    });
  }
  recent.push(now);
  rateLog.set(key, recent);
  // Bound memory: sweep dead entries once the map grows past a few thousand.
  if (rateLog.size > 5000) {
    for (const [k, v] of rateLog) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateLog.delete(k);
    }
  }
}

async function requireSessionByToken(token: string) {
  enforceTokenRateLimit(token);
  const db = getDb();
  const [stakeholder] = await db
    .select()
    .from(stakeholders)
    .where(eq(stakeholders.inviteToken, token))
    .limit(1);

  if (!stakeholder) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
  }
  if (stakeholder.inviteExpiresAt && stakeholder.inviteExpiresAt < new Date()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This invite has expired" });
  }

  const [session] = await db
    .select()
    .from(stakeholderSessions)
    .where(eq(stakeholderSessions.stakeholderId, stakeholder.id))
    .limit(1);
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, stakeholder.projectId))
    .limit(1);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  // Touch activity for stall detection (§6.1).
  await db
    .update(stakeholders)
    .set({ lastActivityAt: new Date() })
    .where(eq(stakeholders.id, stakeholder.id));

  return { stakeholder, session, project };
}

export const sessionRouter = createRouter({
  /** Full state for resume: identity, position in the state machine, transcript. */
  getState: publicQuery.input(tokenInput).query(async ({ input }) => {
    const db = getDb();
    const { stakeholder, session, project } = await requireSessionByToken(input.token);

    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, project.ownerId))
      .limit(1);

    const messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, session.id))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));

    const [assessment] = await db
      .select()
      .from(assessmentResults)
      .where(eq(assessmentResults.sessionId, session.id))
      .limit(1);

    const allSummaries = await db
      .select()
      .from(phaseSummaries)
      .where(eq(phaseSummaries.sessionId, session.id))
      .orderBy(asc(phaseSummaries.createdAt));

    const pending = allSummaries.filter((s) => !s.approved).pop() ?? null;

    return {
      projectName: project.name,
      clientName: project.clientName,
      inviterName: owner?.name ?? "Your project lead",
      stakeholder: { name: stakeholder.name, roleTitle: stakeholder.roleTitle },
      state: session.state,
      currentPhase: session.currentPhase,
      messages: messages.map((m) => ({
        id: m.id,
        stage: m.stage,
        phase: m.phase,
        role: m.role,
        content: m.content,
      })),
      assessmentCompleted: !!assessment,
      pendingSummary: pending
        ? { id: pending.id, phase: pending.phase, summary: pending.summary }
        : null,
      approvedPhaseCount: allSummaries.filter((s) => s.approved).length,
    };
  }),

  /** Begin Stage 2 (discovery interview). */
  startDiscovery: publicQuery.input(tokenInput).mutation(async ({ input }) => {
    const ctx = await requireSessionByToken(input.token);
    return startDiscovery(ctx);
  }),

  /** One conversational exchange within the current discovery phase. */
  discoveryReply: publicQuery
    .input(tokenInput.extend({ message: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      enforceTokenRateLimit(input.token, "llm");
      const ctx = await requireSessionByToken(input.token);
      return discoveryReply(ctx, input.message);
    }),

  /** Approve the pending phase summary, optionally with revision feedback. */
  approvePhaseSummary: publicQuery
    .input(tokenInput.extend({ feedback: z.string().max(2000).optional() }))
    .mutation(async ({ input }) => {
      enforceTokenRateLimit(input.token, "llm");
      const ctx = await requireSessionByToken(input.token);
      return approvePhaseSummary(ctx, input.feedback);
    }),

  /** Open Stage 3 (review & confirm). */
  getReview: publicQuery.input(tokenInput).mutation(async ({ input }) => {
    const ctx = await requireSessionByToken(input.token);
    return getReview(ctx);
  }),

  /** Record a correction during review. */
  flagReviewItem: publicQuery
    .input(tokenInput.extend({ note: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const ctx = await requireSessionByToken(input.token);
      return flagReviewItem(ctx, input.note);
    }),

  /** Final submission. */
  submitFinal: publicQuery.input(tokenInput).mutation(async ({ input, ctx: tCtx }) => {
    const ctx = await requireSessionByToken(input.token);
    return submitFinal(ctx, publicOrigin(tCtx.req));
  }),

  /** Begin Stage 1 (assessment). */
  start: publicQuery.input(tokenInput).mutation(async ({ input }) => {
    const ctx = await requireSessionByToken(input.token);
    if (ctx.session.state !== "INVITED") {
      return { ok: true }; // idempotent — already started
    }
    const { firstMessage } = await startAssessment(ctx);
    return { ok: true, firstMessage };
  }),

  /** One conversational exchange in the assessment. */
  reply: publicQuery
    .input(tokenInput.extend({ message: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      enforceTokenRateLimit(input.token, "llm");
      const ctx = await requireSessionByToken(input.token);
      if (ctx.session.state !== "ASSESSMENT_IN_PROGRESS") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Assessment is not in progress",
        });
      }
      return assessmentReply({ ...ctx, message: input.message });
    }),

  /** Complete the assessment via the ranked-choice form fallback (§6.2). */
  submitForm: publicQuery
    .input(
      tokenInput.extend({
        answers: z
          .array(
            z.enum([
              "detail_oriented",
              "big_picture",
              "story_narrative",
              "problem_solving",
            ]),
          )
          .length(5),
      }),
    )
    .mutation(async ({ input }) => {
      const ctx = await requireSessionByToken(input.token);
      if (
        ctx.session.state !== "ASSESSMENT_IN_PROGRESS" &&
        ctx.session.state !== "INVITED"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Assessment cannot be completed from the current state",
        });
      }
      // If they never started, mark the session as begun so timestamps make sense.
      if (ctx.session.state === "INVITED") {
        await getDb()
          .update(stakeholderSessions)
          .set({ state: "ASSESSMENT_IN_PROGRESS", startedAt: new Date() })
          .where(eq(stakeholderSessions.id, ctx.session.id));
      }
      return submitFormAssessment({ ...ctx, answers: input.answers });
    }),
});

import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { llm, gatewayMode, type LlmMessage } from "./llm";
import { discoverySystemPrompt, summaryRevisionPrompt, PHASES } from "./prompts/discovery";
import { runIncrementalAlertPass } from "./compiler";
import { sendEmail, milestoneEmailHtml } from "../mailer";
import {
  conversationMessages,
  stakeholderSessions,
  stakeholders,
  users,
  assessmentResults,
  phaseSummaries,
  discoveryFlags,
  agentHandoffs,
  type AssessmentResult,
  type Project,
  type Stakeholder,
  type StakeholderSession,
} from "@db/schema";

/**
 * Discovery Agent (build doc §6.3): four-phase adaptive interview,
 * phase-summary approval gates, Scope Guardian flags, review & submit.
 */

const envelopeSchema = z.object({
  message: z.string().min(1),
  phase_complete: z.boolean(),
  summary: z.string().nullable(),
  flags: z.array(
    z.object({
      type: z.enum(["out_of_scope", "scope_drift", "inconsistency"]),
      severity: z.enum(["low", "medium", "high"]),
      text: z.string(),
    }),
  ),
});
type Envelope = z.infer<typeof envelopeSchema>;

interface Ctx {
  session: StakeholderSession;
  stakeholder: Stakeholder;
  project: Project;
}

async function loadAssessment(sessionId: number): Promise<AssessmentResult | null> {
  const [row] = await getDb()
    .select()
    .from(assessmentResults)
    .where(eq(assessmentResults.sessionId, sessionId))
    .limit(1);
  return row ?? null;
}

async function loadDiscoveryMessages(sessionId: number) {
  return getDb()
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
}

async function approvedSummaries(sessionId: number) {
  return getDb()
    .select()
    .from(phaseSummaries)
    .where(and(eq(phaseSummaries.sessionId, sessionId), eq(phaseSummaries.approved, true)))
    .orderBy(asc(phaseSummaries.phase));
}

function transcriptOf(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `${m.role === "agent" ? "Interviewer" : "Stakeholder"}: ${m.content}`)
    .join("\n\n");
}

// ── Dev-mode scripted discovery (no LLM credentials configured) ─────────────

const DEV_PHASE_QUESTIONS: Record<number, string[]> = {
  1: [
    "Let's start with your world. Tell me about your team — who's on it, and how does work flow through it day to day?",
    "And what about tooling — what do you rely on every day, and where does it let you down?",
    "One more on the current state: if you could wave a wand and change one thing about how work gets done today, what would it be?",
  ],
  2: [
    "I'd like to go deeper on something you touched on. Walk me through how that works in practice — who does what, and when?",
    "How does that connect to what this project is trying to put in place? Where do you see it helping or colliding?",
    "What have I not asked about that process that I should have?",
  ],
  3: [
    "Let me play back what I've heard so far, and you tell me what I've got wrong. Does the picture I've painted match how it actually works on the ground?",
    "Is there anything from earlier that you want to correct or sharpen before we look ahead?",
  ],
  4: [
    "Looking ahead: what does success look like for you at go-live — concretely, what will be different in your week?",
    "If you had to choose one must-have for this project and one thing you'd happily trade away, what would they be?",
  ],
};

/** Dev-mode style adaptation (§6.2): question framing varies visibly by profile. */
const DEV_STYLE_FRAME: Record<string, (q: string) => string> = {
  detail_oriented: (q) =>
    `${q} The more precise the better — names, volumes, exact steps all help.`,
  big_picture: (q) =>
    `Zooming out for a moment. ${q} Think impact and direction, not minutiae.`,
  story_narrative: (q) =>
    `${q} If a real example comes to mind — a specific week, a specific deal — start there.`,
  problem_solving: (q) => `Straight to it. ${q} What's broken, and what's it costing you?`,
};

function devSummary(phase: number, stakeholderTexts: string[]): string {
  const snippets = stakeholderTexts
    .slice(-4)
    .map((t) => (t.length > 140 ? `${t.slice(0, 137)}…` : t));
  const bullets = snippets.map((s) => `- Shared: “${s}”`);
  return [`Phase ${phase} (${PHASES[phase].name}) — key points from the stakeholder:`, ...bullets].join(
    "\n",
  );
}

// ── Public operations ────────────────────────────────────────────────────────

/** Transition ASSESSMENT_COMPLETE → DISCOVERY_IN_PROGRESS and open Phase 1. */
export async function startDiscovery(ctx: Ctx) {
  const { session } = ctx;
  const db = getDb();
  if (session.state !== "ASSESSMENT_COMPLETE") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Discovery cannot start yet" });
  }

  await db
    .update(stakeholderSessions)
    .set({ state: "DISCOVERY_IN_PROGRESS", currentPhase: 1 })
    .where(eq(stakeholderSessions.id, session.id));

  const firstMessage = await nextAgentMessage({ ...ctx }, 1);
  return { firstMessage };
}

/** Generate and persist the next agent message for a phase (opening or reply). */
async function nextAgentMessage(
  ctx: Ctx & { stakeholderMessage?: string },
  phase: number,
): Promise<string> {
  const { session, stakeholder, project } = ctx;
  const db = getDb();

  if (ctx.stakeholderMessage) {
    // Idempotent retry: if the previous attempt already persisted this exact
    // message (e.g. the agent reply then timed out), don't duplicate it —
    // fall through and regenerate the agent's response.
    const existing = await loadDiscoveryMessages(session.id);
    const last = existing[existing.length - 1];
    const isRetry =
      last?.stage === "discovery" &&
      last.phase === phase &&
      last.role === "stakeholder" &&
      last.content === ctx.stakeholderMessage;
    if (!isRetry) {
      await db.insert(conversationMessages).values({
        sessionId: session.id,
        stage: "discovery",
        phase,
        role: "stakeholder",
        content: ctx.stakeholderMessage,
      });
    }
  }

  const allMessages = await loadDiscoveryMessages(session.id);
  const discoveryMessages = allMessages.filter((m) => m.stage === "discovery");
  const phaseMessages = discoveryMessages.filter((m) => m.phase === phase);
  const exchangeCount = phaseMessages.filter((m) => m.role === "stakeholder").length;
  const assessment = await loadAssessment(session.id);
  const summaries = await approvedSummaries(session.id);

  let envelope: Envelope;

  if (gatewayMode(project) === "dev") {
    const stakeholderTexts = phaseMessages
      .filter((m) => m.role === "stakeholder")
      .map((m) => m.content);
    const questions = DEV_PHASE_QUESTIONS[phase];
    const done = exchangeCount >= Math.min(questions.length, PHASES[phase].minExchanges);

    // Dev mode demonstrates flags once, in phase 2, to exercise the pipeline.
    const demoFlags =
      phase === 2 && exchangeCount === 1
        ? [
            {
              type: "out_of_scope" as const,
              severity: "low" as const,
              text: "Mentioned a topic adjacent to but outside the stated project scope (dev-mode demo flag).",
            },
          ]
        : [];

    const frame = DEV_STYLE_FRAME[assessment?.primaryStyle ?? "problem_solving"];
    envelope = {
      message: done
        ? "That's everything I wanted to cover in this phase. Here's my summary of what you told me — please check it over."
        : frame(questions[exchangeCount]),
      phase_complete: done,
      summary: done ? devSummary(phase, stakeholderTexts) : null,
      flags: demoFlags,
    };
    await llm.logDevCall(
      {
        agent: "discovery",
        purpose: `discovery.phase${phase}.reply`,
        messages: [],
        projectId: project.id,
        sessionId: session.id,
      },
      envelope.message.length + (envelope.summary?.length ?? 0),
    );
  } else {
    const llmMessages: LlmMessage[] = [
      {
        role: "system",
        content: discoverySystemPrompt({
          project,
          stakeholder,
          assessment,
          phase,
          exchangeCountInPhase: exchangeCount,
          approvedSummaries: summaries.map((s) => ({ phase: s.phase, summary: s.summary })),
        }),
      },
      {
        role: "user",
        content: [
          summaries.length > 0
            ? `Approved summaries from earlier phases:\n${summaries.map((s) => `Phase ${s.phase}:\n${s.summary}`).join("\n\n")}`
            : "",
          `Conversation in this phase so far:\n${transcriptOf(phaseMessages) || "(none yet — open the phase)"}`,
          "Respond with the JSON envelope.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
    envelope = await llm.completeJson(
      {
        agent: "discovery",
        purpose: `discovery.phase${phase}.reply`,
        messages: llmMessages,
        temperature: 0.7,
        maxTokens: 900,
        projectId: project.id,
        sessionId: session.id,
        interactive: true,
        lane: "chat",
        reasoning: "off",
      },
      envelopeSchema,
      project,
    );
  }

  // Persist Scope Guardian flags (§6.3).
  for (const flag of envelope.flags) {
    await db.insert(discoveryFlags).values({
      sessionId: session.id,
      phase,
      type: flag.type,
      severity: flag.severity,
      text: flag.text,
    });
  }

  await db.insert(conversationMessages).values({
    sessionId: session.id,
    stage: "discovery",
    phase,
    role: "agent",
    content: envelope.message,
    flagsJson: envelope.flags.length > 0 ? envelope.flags : null,
  });

  // Phase completion → summary for stakeholder approval (gate on next phase).
  if (envelope.phase_complete && envelope.summary) {
    await db.insert(phaseSummaries).values({
      sessionId: session.id,
      phase,
      summary: envelope.summary,
      approved: false,
    });
  }

  return envelope.message;
}

/** One stakeholder reply within the current phase. */
export async function discoveryReply(ctx: Ctx, message: string) {
  const { session } = ctx;
  const db = getDb();
  if (session.state !== "DISCOVERY_IN_PROGRESS" || !session.currentPhase) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Discovery is not in progress" });
  }

  // Block replies while a summary awaits approval (approval gates the phase).
  const [pending] = await db
    .select()
    .from(phaseSummaries)
    .where(
      and(eq(phaseSummaries.sessionId, session.id), eq(phaseSummaries.approved, false)),
    )
    .orderBy(desc(phaseSummaries.createdAt))
    .limit(1);
  if (pending) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Please review the phase summary before continuing",
    });
  }

  const agentMessage = await nextAgentMessage({ ...ctx, stakeholderMessage: message }, session.currentPhase);
  return { agentMessage };
}

/** Approve the current phase summary (optionally with one revision pass). */
export async function approvePhaseSummary(ctx: Ctx, feedback?: string) {
  const { session, project } = ctx;
  const db = getDb();

  const [pending] = await db
    .select()
    .from(phaseSummaries)
    .where(and(eq(phaseSummaries.sessionId, session.id), eq(phaseSummaries.approved, false)))
    .orderBy(desc(phaseSummaries.createdAt))
    .limit(1);
  if (!pending) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No summary awaiting approval" });
  }

  let finalSummary = pending.summary;

  if (feedback?.trim()) {
    // One revision pass (§6.3).
    if (gatewayMode(project) === "dev") {
      finalSummary = `${pending.summary}\n- Stakeholder correction: ${feedback.trim()}`;
      await llm.logDevCall(
        {
          agent: "discovery",
          purpose: "discovery.summary.revise",
          messages: [],
          projectId: project.id,
          sessionId: session.id,
        },
        finalSummary.length,
      );
    } else {
      const revised = await llm.completeJson(
        {
          agent: "discovery",
          purpose: "discovery.summary.revise",
          messages: [
            {
              role: "system",
              content: summaryRevisionPrompt({
                originalSummary: pending.summary,
                feedback: feedback.trim(),
              }),
            },
            { role: "user", content: "Produce the revised summary JSON." },
          ],
          temperature: 0.3,
          maxTokens: 700,
          projectId: project.id,
          sessionId: session.id,
          interactive: true,
          lane: "chat",
          reasoning: "off",
        },
        z.object({ summary: z.string().min(1) }),
        project,
      );
      finalSummary = revised.summary;
    }
  }

  await db
    .update(phaseSummaries)
    .set({
      summary: finalSummary,
      approved: true,
      approvedAt: new Date(),
      stakeholderFeedback: feedback?.trim() || null,
    })
    .where(eq(phaseSummaries.id, pending.id));

  const phase = pending.phase;
  if (phase < 4) {
    await db
      .update(stakeholderSessions)
      .set({ currentPhase: phase + 1 })
      .where(eq(stakeholderSessions.id, session.id));
    const firstMessage = await nextAgentMessage({ ...ctx }, phase + 1);
    return { approved: true, nextPhase: phase + 1, firstMessage, discoveryComplete: false };
  }

  // Phase 4 approved → discovery complete, ready for review (§3.1).
  await db
    .update(stakeholderSessions)
    .set({ state: "DISCOVERY_COMPLETE", currentPhase: null })
    .where(eq(stakeholderSessions.id, session.id));

  await db.insert(agentHandoffs).values({
    sessionId: session.id,
    projectId: project.id,
    fromAgent: "discovery",
    toAgent: "compiler",
    contextJson: { note: "All four phases approved; awaiting stakeholder final review." },
  });

  return { approved: true, nextPhase: null, firstMessage: null, discoveryComplete: true };
}

/** Open Stage 3: everything captured, for correction (§6.3, §10.1). */
export async function getReview(ctx: Ctx) {
  const { session } = ctx;
  const db = getDb();
  if (session.state !== "DISCOVERY_COMPLETE" && session.state !== "REVIEW_IN_PROGRESS") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Review is not available yet" });
  }

  if (session.state === "DISCOVERY_COMPLETE") {
    await db
      .update(stakeholderSessions)
      .set({ state: "REVIEW_IN_PROGRESS" })
      .where(eq(stakeholderSessions.id, session.id));
  }

  const summaries = await db
    .select()
    .from(phaseSummaries)
    .where(eq(phaseSummaries.sessionId, session.id))
    .orderBy(asc(phaseSummaries.phase));

  const flags = await db
    .select()
    .from(discoveryFlags)
    .where(eq(discoveryFlags.sessionId, session.id))
    .orderBy(asc(discoveryFlags.createdAt));

  const corrections = (await loadDiscoveryMessages(session.id))
    .filter((m) => m.stage === "review" && m.role === "stakeholder")
    .map((m) => m.content);

  return {
    summaries: summaries.map((s) => ({ phase: s.phase, summary: s.summary })),
    flags: flags.map((f) => ({
      phase: f.phase,
      type: f.type,
      severity: f.severity,
      text: f.text,
    })),
    corrections,
  };
}

/** Record a "something's wrong" note during review (§7 flagReviewItem). */
export async function flagReviewItem(ctx: Ctx, note: string) {
  const { session } = ctx;
  const db = getDb();
  if (session.state !== "REVIEW_IN_PROGRESS") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Review is not in progress" });
  }
  await db.insert(conversationMessages).values({
    sessionId: session.id,
    stage: "review",
    role: "stakeholder",
    content: note,
  });
  return { ok: true };
}

/** Final submit → COMPLETED (§3.1). Phase 4 hooks: compiler alert pass + emails. */
export async function submitFinal(ctx: Ctx, origin?: string) {
  const { session, stakeholder, project } = ctx;
  const db = getDb();
  if (session.state !== "REVIEW_IN_PROGRESS") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to submit yet" });
  }
  await db
    .update(stakeholderSessions)
    .set({ state: "COMPLETED", completedAt: new Date() })
    .where(eq(stakeholderSessions.id, session.id));

  // Milestone email to the project lead (Q2) — never blocks the stakeholder.
  void (async () => {
    try {
      const [owner] = await db.select().from(users).where(eq(users.id, project.ownerId)).limit(1);
      if (!owner?.email || !origin) return;
      const roster = await db
        .select({ id: stakeholders.id })
        .from(stakeholders)
        .where(eq(stakeholders.projectId, project.id));
      const sessions = await db
        .select({ state: stakeholderSessions.state })
        .from(stakeholderSessions)
        .innerJoin(stakeholders, eq(stakeholderSessions.stakeholderId, stakeholders.id))
        .where(eq(stakeholders.projectId, project.id));
      await sendEmail({
        to: owner.email,
        subject: `${stakeholder.name} completed discovery — ${project.name}`,
        html: milestoneEmailHtml({
          leadName: owner.name ?? "there",
          projectName: project.name,
          stakeholderName: stakeholder.name,
          completedCount: sessions.filter((s) => s.state === "COMPLETED").length,
          stakeholderCount: roster.length,
          projectUrl: `${origin}/projects/${project.id}`,
        }),
        type: "milestone",
        stakeholderId: stakeholder.id,
        projectId: project.id,
      });
    } catch (err) {
      console.warn("[discovery] milestone email failed:", err);
    }
  })();

  // Incremental compiler alert pass (§6.4) — fire-and-forget.
  void runIncrementalAlertPass(session.id, origin).catch((err) =>
    console.warn("[compiler] alert pass failed:", err),
  );

  return { ok: true };
}

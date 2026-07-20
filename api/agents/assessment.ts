import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { llm, gatewayMode, type LlmMessage } from "./llm";
import { assessmentSystemPrompt } from "./prompts/assessment";
import {
  conversationMessages,
  assessmentResults,
  stakeholderSessions,
  agentHandoffs,
  type Project,
  type Stakeholder,
  type StakeholderSession,
} from "@db/schema";

/**
 * Assessment Agent (build doc §6.2).
 * Conversational style assessment with confidence scoring, form fallback,
 * and full-transcript handoff to the Discovery Agent.
 */

const STYLES = [
  "detail_oriented",
  "big_picture",
  "story_narrative",
  "problem_solving",
] as const;

const envelopeSchema = z.object({
  message: z.string().min(1),
  complete: z.boolean(),
  primary_style: z.enum(STYLES).nullable(),
  secondary_style: z.enum(STYLES).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
type Envelope = z.infer<typeof envelopeSchema>;

function transcriptOf(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `${m.role === "agent" ? "Interviewer" : "Stakeholder"}: ${m.content}`)
    .join("\n\n");
}

async function loadAssessmentMessages(sessionId: number) {
  return getDb()
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
}

function stakeholderExchangeCount(messages: { role: string }[]): number {
  return messages.filter((m) => m.role === "stakeholder").length;
}

/** Parse the agent's JSON envelope; one repair retry on failure (§4.2). */
async function callForEnvelope(
  llmMessages: LlmMessage[],
  ctx: { projectId: number; sessionId: number },
  project: Project,
): Promise<Envelope> {
  const raw = await llm.complete(
    {
      agent: "assessment",
      purpose: "assessment.reply",
      messages: llmMessages,
      temperature: 0.7,
      maxTokens: 700,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      interactive: true,
      lane: "chat",
      reasoning: "off",
    },
    project,
  );

  const tryParse = (text: string): Envelope | null => {
    try {
      const cleaned = text.trim().replace(/^```(?:json)?|```$/g, "").trim();
      return envelopeSchema.parse(JSON.parse(cleaned));
    } catch {
      return null;
    }
  };

  const first = tryParse(raw.text);
  if (first) return first;

  const repaired = await llm.complete(
    {
      agent: "assessment",
      purpose: "assessment.reply.repair",
      messages: [
        ...llmMessages,
        { role: "assistant", content: raw.text },
        {
          role: "user",
          content:
            "That was not valid JSON matching the contract. Respond again with STRICT JSON only: {message, complete, primary_style, secondary_style, confidence}.",
        },
      ],
      temperature: 0.2,
      maxTokens: 700,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      interactive: true,
      lane: "chat",
      reasoning: "off",
    },
    project,
  );
  const second = tryParse(repaired.text);
  if (!second) throw new Error("Assessment Agent returned unparseable output twice");
  return second;
}

// ── Dev-mode scripted assessment (no LLM credentials configured) ─────────────

const DEV_QUESTIONS: ((name: string, projectName: string) => string)[] = [
  (name, projectName) =>
    `Hi ${name}, great to meet you. Before we dive into ${projectName}, I'd love to get a sense of how you like to talk through your work. When you explain something complex to a colleague, what does that usually look like?`,
  () =>
    `That's really helpful, thank you. And when you're on the receiving end — what kind of explanation actually sticks with you?`,
  () =>
    `Last one before we jump in: in a typical working session, what makes you walk away feeling the time was well spent?`,
];

const DEV_WRAP =
  "Perfect — that's exactly what I needed. We'll move at your pace from here. When you're ready, continue on to the discovery interview.";

function devStyleGuess(stakeholderTexts: string[]): {
  primary: (typeof STYLES)[number];
  secondary: (typeof STYLES)[number] | null;
  confidence: number;
} {
  const all = stakeholderTexts.join(" ").toLowerCase();
  const avg = all.length / Math.max(stakeholderTexts.length, 1);
  if (/\b(goal|vision|big picture|outcome|strategy|success)\b/.test(all)) {
    return { primary: "big_picture", secondary: avg > 400 ? "detail_oriented" : null, confidence: 0.62 };
  }
  if (/\b(example|story|happened|last time|remember when|experience)\b/.test(all)) {
    return { primary: "story_narrative", secondary: null, confidence: 0.58 };
  }
  if (/\b(broken|fix|problem|blocker|issue|bottleneck)\b/.test(all)) {
    return { primary: "problem_solving", secondary: null, confidence: 0.6 };
  }
  if (avg > 350) {
    return { primary: "detail_oriented", secondary: null, confidence: 0.55 };
  }
  return { primary: "problem_solving", secondary: null, confidence: 0.5 };
}

// ── Public agent operations ──────────────────────────────────────────────────

/** Begin the assessment: state INVITED → ASSESSMENT_IN_PROGRESS + first message. */
export async function startAssessment(params: {
  session: StakeholderSession;
  stakeholder: Stakeholder;
  project: Project;
}) {
  const { session, stakeholder, project } = params;
  const db = getDb();

  await db.insert(agentHandoffs).values({
    sessionId: session.id,
    projectId: project.id,
    fromAgent: "onboarding",
    toAgent: "assessment",
    contextJson: {
      projectName: project.name,
      scopeText: project.scopeText,
      constraintsText: project.constraintsText,
      stakeholderName: stakeholder.name,
      stakeholderRole: stakeholder.roleTitle,
    },
  });

  const firstMessage =
    gatewayMode(project) === "dev"
      ? DEV_QUESTIONS[0](stakeholder.name.split(" ")[0], project.name)
      : (
          await callForEnvelope(
            [
              {
                role: "system",
                content: assessmentSystemPrompt({ project, stakeholder, exchangeCount: 0 }),
              },
              { role: "user", content: "Begin the conversation." },
            ],
            { projectId: project.id, sessionId: session.id },
            project,
          )
        ).message;

  await db.insert(conversationMessages).values({
    sessionId: session.id,
    stage: "assessment",
    role: "agent",
    content: firstMessage,
  });
  await db
    .update(stakeholderSessions)
    .set({ state: "ASSESSMENT_IN_PROGRESS", startedAt: new Date() })
    .where(eq(stakeholderSessions.id, session.id));

  return { firstMessage };
}

/** Process one stakeholder reply; complete the assessment when confident. */
export async function assessmentReply(params: {
  session: StakeholderSession;
  stakeholder: Stakeholder;
  project: Project;
  message: string;
}) {
  const { session, stakeholder, project, message } = params;
  const db = getDb();

  // Idempotent retry: if the previous attempt already persisted this exact
  // stakeholder message (e.g. the agent reply then timed out), don't duplicate
  // it — just regenerate the agent's response.
  const prior = await loadAssessmentMessages(session.id);
  const last = prior[prior.length - 1];
  const isRetry = last?.role === "stakeholder" && last.content === message;
  if (!isRetry) {
    await db.insert(conversationMessages).values({
      sessionId: session.id,
      stage: "assessment",
      role: "stakeholder",
      content: message,
    });
  }

  const history = await loadAssessmentMessages(session.id);
  const exchanges = stakeholderExchangeCount(history);

  let agentMessage: string;
  let envelope: Envelope | null = null;

  if (gatewayMode(project) === "dev") {
    const stakeholderTexts = history
      .filter((m) => m.role === "stakeholder")
      .map((m) => m.content);
    if (exchanges < 3) {
      agentMessage = DEV_QUESTIONS[exchanges](
        stakeholder.name.split(" ")[0],
        project.name,
      );
      await llm.logDevCall(
        {
          agent: "assessment",
          purpose: "assessment.reply",
          messages: [],
          projectId: project.id,
          sessionId: session.id,
        },
        agentMessage.length,
      );
    } else {
      const guess = devStyleGuess(stakeholderTexts);
      envelope = {
        message: DEV_WRAP,
        complete: true,
        primary_style: guess.primary,
        secondary_style: guess.secondary,
        confidence: guess.confidence,
      };
      agentMessage = DEV_WRAP;
      await llm.logDevCall(
        {
          agent: "assessment",
          purpose: "assessment.reply",
          messages: [],
          projectId: project.id,
          sessionId: session.id,
        },
        agentMessage.length,
      );
    }
  } else {
    const llmMessages: LlmMessage[] = [
      {
        role: "system",
        content: assessmentSystemPrompt({ project, stakeholder, exchangeCount: exchanges }),
      },
      {
        role: "user",
        content: `Conversation so far:\n\n${transcriptOf(history)}\n\nRespond with the JSON envelope.`,
      },
    ];
    const result = await callForEnvelope(
      llmMessages,
      { projectId: project.id, sessionId: session.id },
      project,
    );
    agentMessage = result.message;
    if (result.complete || exchanges >= 6) {
      envelope = { ...result, complete: true };
    }
  }

  await db.insert(conversationMessages).values({
    sessionId: session.id,
    stage: "assessment",
    role: "agent",
    content: agentMessage,
  });

  if (envelope?.complete && envelope.primary_style) {
    await completeAssessment({
      session,
      stakeholder,
      project,
      method: "conversational",
      primaryStyle: envelope.primary_style,
      secondaryStyle: envelope.secondary_style,
      confidence: envelope.confidence ?? 0.5,
    });
    return { agentMessage, completed: true };
  }

  return { agentMessage, completed: false };
}

/** Persist the result, transition state, and hand off to Discovery (§6.2). */
async function completeAssessment(params: {
  session: StakeholderSession;
  stakeholder: Stakeholder;
  project: Project;
  method: "conversational" | "form";
  primaryStyle: (typeof STYLES)[number];
  secondaryStyle: (typeof STYLES)[number] | null;
  confidence: number;
}) {
  const { session, stakeholder, project, method } = params;
  const db = getDb();
  const history = await loadAssessmentMessages(session.id);

  await db.insert(assessmentResults).values({
    sessionId: session.id,
    primaryStyle: params.primaryStyle,
    secondaryStyle: params.secondaryStyle,
    confidence: String(params.confidence),
    method,
    transcriptJson: history.map((m) => ({ role: m.role, content: m.content })),
  });

  await db
    .update(stakeholderSessions)
    .set({ state: "ASSESSMENT_COMPLETE" })
    .where(eq(stakeholderSessions.id, session.id));

  await db.insert(agentHandoffs).values({
    sessionId: session.id,
    projectId: project.id,
    fromAgent: "assessment",
    toAgent: "discovery",
    contextJson: {
      primaryStyle: params.primaryStyle,
      secondaryStyle: params.secondaryStyle,
      confidence: params.confidence,
      method,
      transcript: history.map((m) => ({ role: m.role, content: m.content })),
      stakeholderName: stakeholder.name,
      stakeholderRole: stakeholder.roleTitle,
    },
  });
}

/** Form fallback scoring (§6.2): counts style picks, primary = most picked. */
export async function submitFormAssessment(params: {
  session: StakeholderSession;
  stakeholder: Stakeholder;
  project: Project;
  answers: (typeof STYLES)[number][];
}) {
  const { session, stakeholder, project, answers } = params;
  const db = getDb();

  const counts = new Map<(typeof STYLES)[number], number>();
  for (const a of answers) counts.set(a, (counts.get(a) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const primary = ranked[0][0];
  const secondary = ranked.length > 1 && ranked[1][1] > 0 ? ranked[1][0] : null;
  const confidence = Math.min(1, (ranked[0][1] - (ranked[1]?.[1] ?? 0)) / answers.length + 0.4);

  await db.insert(conversationMessages).values({
    sessionId: session.id,
    stage: "assessment",
    role: "agent",
    content:
      "Thanks — that's everything I needed. When you're ready, continue on to the discovery interview.",
  });

  await completeAssessment({
    session,
    stakeholder,
    project,
    method: "form",
    primaryStyle: primary,
    secondaryStyle: secondary,
    confidence,
  });

  await llm.logDevCall(
    {
      agent: "assessment",
      purpose: "assessment.form",
      messages: [],
      projectId: project.id,
      sessionId: session.id,
    },
    0,
  );

  return { completed: true };
}

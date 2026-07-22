import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { sendEmail, nudgeEmailHtml } from "./mailer";
import { projects, stakeholders, stakeholderSessions } from "@db/schema";

/**
 * Nudge sweep (Q2): a stakeholder counts as stalled after 3 days without
 * activity (lastActivityAt, falling back to invitedAt). Stalled stakeholders
 * receive a nudge email — max 3 per stakeholder, at most one per 3 days.
 *
 * The sweep runs lazily when the lead reads a project dashboard (there is no
 * background scheduler in this environment); email_logs records every send.
 */

const STALL_MS = 3 * 24 * 60 * 60 * 1000;
const NUDGE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_NUDGES = 3;

export async function runNudgeSweep(projectId: number, origin: string): Promise<number> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return 0;

  const roster = await db
    .select({ stakeholder: stakeholders, session: stakeholderSessions })
    .from(stakeholders)
    .leftJoin(
      stakeholderSessions,
      eq(stakeholderSessions.stakeholderId, stakeholders.id),
    )
    .where(eq(stakeholders.projectId, projectId));

  const now = Date.now();
  let sent = 0;

  for (const { stakeholder: s, session } of roster) {
    if (session?.state === "COMPLETED") continue;
    // Token expired — nudging is pointless; the lead must regenerate the link.
    if (s.inviteExpiresAt && s.inviteExpiresAt.getTime() < now) continue;

    const basis = (s.lastActivityAt ?? s.invitedAt)?.getTime?.() ?? null;
    if (basis === null || now - basis < STALL_MS) continue;
    if (s.nudgeCount >= MAX_NUDGES) continue;
    if (s.lastNudgeAt && now - s.lastNudgeAt.getTime() < NUDGE_INTERVAL_MS) continue;

    const inviteUrl = `${origin}/s/${s.inviteToken}`;
    const { status } = await sendEmail({
      to: s.email,
      subject: `Reminder: your discovery session for ${project.name}`,
      html: nudgeEmailHtml({
        stakeholderName: s.name,
        projectName: project.name,
        inviteUrl,
        nudgeNumber: s.nudgeCount + 1,
      }),
      type: "nudge",
      stakeholderId: s.id,
      projectId: project.id,
    });
    if (status === "failed") continue;

    await db
      .update(stakeholders)
      .set({ nudgeCount: s.nudgeCount + 1, lastNudgeAt: new Date(now) })
      .where(eq(stakeholders.id, s.id));
    sent += 1;
  }

  return sent;
}

/**
 * Sweep every active project — target of the /api/jobs/nudge-sweep endpoint
 * so an external scheduler (platform cron, uptime pinger) can run nudges
 * hourly instead of waiting for a lead to open a dashboard (§6.1).
 */
export async function runNudgeSweepAll(origin: string): Promise<{ projects: number; sent: number }> {
  const db = getDb();
  const active = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.status, "active"));
  let sent = 0;
  for (const p of active) {
    sent += await runNudgeSweep(p.id, origin);
  }
  return { projects: active.length, sent };
}

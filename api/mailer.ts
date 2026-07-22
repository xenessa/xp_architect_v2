import { getDb } from "./queries/connection";
import { emailLogs } from "@db/schema";

/**
 * Provider-agnostic transactional mailer (build doc §2, §9.1).
 *
 * Configuration via environment (no .env changes required to develop):
 *   EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM  → real sends via Resend
 *   (unset)                                              → dev mode: logs to console,
 *                                                          records status "dev_logged"
 * Every attempt — sent, failed, or dev-logged — is written to `email_logs`.
 */

export type EmailType = "invite" | "nudge" | "milestone" | "magic_link";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  type: EmailType;
  stakeholderId?: number;
  projectId?: number;
}

export interface SendEmailResult {
  status: "sent" | "failed" | "dev_logged";
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const provider = process.env.EMAIL_PROVIDER;
  let status: SendEmailResult["status"] = "dev_logged";

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "XP Architect <noreply@example.com>",
          to: [opts.to],
          subject: opts.subject,
          html: opts.html,
        }),
      });
      status = resp.ok ? "sent" : "failed";
      if (!resp.ok) {
        console.warn(`[mailer] Resend rejected (${resp.status}): ${await resp.text()}`);
      }
    } catch (err) {
      status = "failed";
      console.warn("[mailer] Resend request failed:", err);
    }
  } else {
    console.log(`[mailer:dev] ${opts.type} → ${opts.to} :: ${opts.subject}`);
  }

  await getDb().insert(emailLogs).values({
    stakeholderId: opts.stakeholderId ?? null,
    projectId: opts.projectId ?? null,
    type: opts.type,
    toAddress: opts.to,
    subject: opts.subject,
    status,
  });

  return { status };
}

/** Invite email body (§6.1: link delivered by email, copyable as backup). */
export function inviteEmailHtml(params: {
  stakeholderName: string;
  projectName: string;
  inviterName: string;
  inviteUrl: string;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">You're invited to a discovery session</h2>
      <p>Hi ${params.stakeholderName},</p>
      <p>${params.inviterName} has invited you to share your perspective on
      <strong>${params.projectName}</strong>.</p>
      <p>It's a structured, self-paced conversation with an AI interviewer —
      about 60–90 minutes total, broken into stages you can complete anytime,
      at your own pace. Your progress is saved automatically.</p>
      <p style="margin: 24px 0;">
        <a href="${params.inviteUrl}"
           style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">
          Begin your session
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">
        Or copy this link: ${params.inviteUrl}<br/>
        This link is personal to you and expires in 30 days.
      </p>
    </div>`;
}

/** Owner magic sign-in link (email-based owner auth; no Kimi account needed). */
export function magicLinkEmailHtml(params: { name: string; url: string }): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">Your sign-in link</h2>
      <p>Hi ${params.name},</p>
      <p>Click below to sign in to XP Architect. This link works once and expires in 15 minutes.</p>
      <p style="margin: 24px 0;">
        <a href="${params.url}"
           style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">
          Sign in
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">
        Or copy this link: ${params.url}<br/>
        If you didn't request this, you can ignore it — nothing happens.
      </p>
    </div>`;
}

/** Nudge email (Q2: stalled ≥3 days, max 3 nudges, one per 3 days). */
export function nudgeEmailHtml(params: {
  stakeholderName: string;
  projectName: string;
  inviteUrl: string;
  nudgeNumber: number;
}): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">Your discovery session is waiting</h2>
      <p>Hi ${params.stakeholderName},</p>
      <p>A quick reminder that your perspective on <strong>${params.projectName}</strong>
      hasn't been captured yet. Your input shapes the solution design and project plan —
      it takes 60–90 minutes, self-paced, and your progress is saved automatically.</p>
      <p style="margin: 24px 0;">
        <a href="${params.inviteUrl}"
           style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">
          Continue your session
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">
        Or copy this link: ${params.inviteUrl}
      </p>
    </div>`;
}

/** Milestone email to the project lead (stakeholder completion / all complete). */
export function milestoneEmailHtml(params: {
  leadName: string;
  projectName: string;
  stakeholderName: string;
  completedCount: number;
  stakeholderCount: number;
  projectUrl: string;
}): string {
  const allDone = params.completedCount >= params.stakeholderCount;
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">${allDone ? "Discovery complete" : "A stakeholder finished discovery"}</h2>
      <p>Hi ${params.leadName},</p>
      <p><strong>${params.stakeholderName}</strong> just submitted their final review for
      <strong>${params.projectName}</strong>.
      That's ${params.completedCount} of ${params.stakeholderCount} stakeholders complete.</p>
      ${
        allDone
          ? `<p><strong>All stakeholders are done.</strong> Run the Compiler to consolidate
             contradictions, patterns, out-of-scope themes, and coverage gaps — then generate deliverables.</p>`
          : ""
      }
      <p style="margin: 24px 0;">
        <a href="${params.projectUrl}"
           style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">
          Open project dashboard
        </a>
      </p>
    </div>`;
}

export function alertEmailHtml(params: {
  leadName: string;
  projectName: string;
  alerts: { severity: string; type: string; message: string }[];
  projectUrl: string;
}): string {
  const rows = params.alerts
    .map(
      (a) =>
        `<li style="margin-bottom:8px"><strong style="text-transform:uppercase;font-size:12px">${a.severity} · ${a.type.replace(/_/g, " ")}</strong><br/>${a.message}</li>`,
    )
    .join("");
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#0b4fbc">High-severity discovery alert</h2>
    <p>Hi ${params.leadName},</p>
    <p>The Compiler flagged the following on <strong>${params.projectName}</strong> after the latest completed session:</p>
    <ul style="padding-left:18px">${rows}</ul>
    <p><a href="${params.projectUrl}?tab=compilation" style="background:#0b4fbc;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review in XP Architect</a></p>
    <p style="color:#888;font-size:12px">You receive alert emails only for high-severity findings. Lower-severity alerts wait for you on the dashboard.</p>
  </div>`;
}

export function stakeholderSummaryEmailHtml(params: {
  stakeholderName: string;
  projectName: string;
  summaries: { phase: number; summary: string }[];
}): string {
  const phaseNames: Record<number, string> = {
    1: "Open Discovery",
    2: "Targeted Follow-ups",
    3: "Validation & Clarification",
    4: "Future State & Priorities",
  };
  const blocks = params.summaries
    .map(
      (s) => `
      <h3 style="margin:18px 0 6px;color:#0b4fbc">Phase ${s.phase} · ${phaseNames[s.phase] ?? ""}</h3>
      <p style="white-space:pre-wrap;margin:0;color:#333">${s.summary}</p>`,
    )
    .join("");
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#0b4fbc">Thank you, ${params.stakeholderName}</h2>
    <p>Your discovery session for <strong>${params.projectName}</strong> is complete. Here are the summaries you approved — your words, kept for your records.</p>
    ${blocks}
    <p style="margin-top:22px"><strong>What happens next:</strong> the project team combines your input with every other stakeholder's, cross-references the full picture, and uses it to shape the solution design and project plan. Anything you flagged during review travels with it.</p>
    <p style="color:#888;font-size:12px">Sent by XP Architect on behalf of the project team. No account or action needed.</p>
  </div>`;
}

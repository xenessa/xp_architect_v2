import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { magicTokens, users } from "@db/schema";
import { sendEmail, magicLinkEmailHtml } from "./mailer";
import { signSessionToken } from "./kimi/session";
import { env } from "./lib/env";

/**
 * Email-based owner sign-in (build doc v8 amendment).
 * Magic link: single-use, 15-minute expiry, only the sha256 hash is stored.
 * Responses are deliberately generic — requesting a link never reveals
 * whether an email belongs to a registered user.
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 5;
const requestLog = new Map<string, number[]>(); // email → timestamps (per-instance)

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function requestMagicLink(
  emailRaw: string,
  origin: string,
): Promise<{ ok: true; delivered?: "sent" | "failed" | "dev_logged" }> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true };

  const now = Date.now();
  const recent = (requestLog.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= RATE_LIMIT_PER_HOUR) return { ok: true };
  recent.push(now);
  requestLog.set(email, recent);

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { ok: true }; // unknown email — same outward response

  const token = randomBytes(32).toString("hex");
  await db.insert(magicTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(now + TOKEN_TTL_MS),
  });

  const url = `${origin}/api/auth/magic?token=${token}`;
  const { status } = await sendEmail({
    to: email,
    subject: "Your XP Architect sign-in link",
    html: magicLinkEmailHtml({ name: user.name ?? "there", url }),
    type: "magic_link",
  });
  if (status === "dev_logged") {
    // No email provider configured — surface the link in server logs so a
    // self-hosted owner can still retrieve it (host-local logs only).
    console.log(`[auth-magic] dev link for ${email}: ${url}`);
  }
  return { ok: true, delivered: status };
}

/** Verify + consume a magic token. Returns a signed session token, or null. */
export async function consumeMagicToken(token: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(magicTokens)
    .where(
      and(
        eq(magicTokens.tokenHash, sha256(token)),
        isNull(magicTokens.usedAt),
        gt(magicTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;

  await db.update(magicTokens).set({ usedAt: new Date() }).where(eq(magicTokens.id, row.id));
  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user) return null;

  console.log(`[auth-magic] ${user.email} signed in via magic link`);
  return signSessionToken({ unionId: user.unionId, clientId: env.appId });
}

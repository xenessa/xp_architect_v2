import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { setCookie } from "hono/cookie";
import { timingSafeEqual } from "node:crypto";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { signSessionToken } from "./kimi/session";
import { findUserByUnionId } from "./queries/users";
import { consumeMagicToken } from "./auth-magic";
import { runNudgeSweepAll } from "./nudges";
import { publicOrigin } from "./origin";
import { handleStripeWebhook } from "./stripe-webhook";
import { getSessionCookieOptions } from "./lib/cookies";
import { Paths, Session } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// Lightweight liveness probe — the client pings this on load so a cold
// platform instance is warm before the user triggers real work.
app.get("/api/health", (c) => c.json({ ok: true }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

/* Email magic-link sign-in (owner auth without a Kimi account). The token  */
/* is single-use and expires in 15 minutes; only its hash is stored.        */
app.get("/api/auth/magic", async (c) => {
  const token = c.req.query("token") ?? "";
  const session = token ? await consumeMagicToken(token) : null;
  if (!session) return c.redirect("/login?error=magic", 302);
  setCookie(c, Session.cookieName, session, {
    ...getSessionCookieOptions(c.req.raw.headers),
    maxAge: Session.maxAgeMs / 1000,
  });
  return c.redirect("/", 302);
});

/* Temporary owner sign-in for self-hosted deployments whose domain isn't    */
/* registered on the OAuth client yet (token exchange rejects unknown        */
/* redirect_uris). Enabled ONLY when OWNER_LOGIN_KEY is set; remove the key  */
/* to disable. The key is a password equivalent — treat it accordingly.      */
if (process.env.OWNER_LOGIN_KEY) {
  const expected = Buffer.from(process.env.OWNER_LOGIN_KEY);
  app.get("/api/owner-login", async (c) => {
    const provided = Buffer.from(c.req.query("key") ?? "");
    const ok =
      provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!ok) return c.json({ error: "Invalid key" }, 401);

    const unionId = process.env.OWNER_UNION_ID;
    if (!unionId) return c.json({ error: "OWNER_UNION_ID not configured" }, 500);
    const user = await findUserByUnionId(unionId);
    if (!user) return c.json({ error: "Owner user not found" }, 404);

    const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
    setCookie(c, Session.cookieName, token, {
      ...getSessionCookieOptions(c.req.raw.headers),
      maxAge: Session.maxAgeMs / 1000,
    });
    console.log(`[owner-login] owner ${user.unionId} signed in via OWNER_LOGIN_KEY`);
    return c.redirect("/", 302);
  });
}

/* Scheduled-job entry point: POST /api/jobs/nudge-sweep with the job key.  */
/* The build doc specifies an hourly nudge sweep (§6.1); this environment   */
/* has no in-process scheduler, so an external cron (platform scheduler or  */
/* an uptime pinger) calls this hourly. Enabled only when JOB_RUNNER_KEY    */
/* is set; the lazy per-project sweep on dashboard reads remains as backup. */
if (process.env.JOB_RUNNER_KEY) {
  const expectedJobKey = Buffer.from(process.env.JOB_RUNNER_KEY);
  // GET + POST: uptime pingers speak GET; schedulers usually POST.
  app.on(["GET", "POST"], "/api/jobs/nudge-sweep", async (c) => {
    const provided = Buffer.from(
      c.req.header("x-job-key") ?? c.req.query("key") ?? "",
    );
    const ok =
      provided.length === expectedJobKey.length &&
      timingSafeEqual(provided, expectedJobKey);
    if (!ok) return c.json({ error: "Invalid job key" }, 401);
    const result = await runNudgeSweepAll(publicOrigin(c.req.raw));
    console.log(`[nudges] scheduled sweep: ${result.sent} nudge(s) across ${result.projects} project(s)`);
    return c.json({ ok: true, ...result });
  });
}

// Raw route (not tRPC): Stripe signature verification needs the exact raw body.
app.post("/api/webhooks/stripe", async (c) => {
  try {
    const raw = await c.req.text();
    const result = await handleStripeWebhook(raw, c.req.header("stripe-signature"));
    return c.json(result);
  } catch (err) {
    console.warn("[stripe] webhook rejected:", err instanceof Error ? err.message : err);
    return c.json({ error: "Webhook verification failed" }, 400);
  }
});
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

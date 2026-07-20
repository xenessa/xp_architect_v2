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
import { handleStripeWebhook } from "./stripe-webhook";
import { getSessionCookieOptions } from "./lib/cookies";
import { Paths, Session } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// Lightweight liveness probe — the client pings this on load so a cold
// platform instance is warm before the user triggers real work.
app.get("/api/health", (c) => c.json({ ok: true }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

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

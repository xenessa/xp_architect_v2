import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner } from "./queries/projects";
import { publicOrigin } from "./origin";
import { purchases } from "@db/schema";

/**
 * Billing (build doc §7, Q4/Q8): per-project one-time purchases via Stripe
 * Checkout; entitlement = any paid purchase. Test mode until live keys.
 *
 * Packages (Q8): SA $495 · PM $495 · bundle $795 (unlocks both + cross-refs).
 * STRIPE_PRICE_* env values may be product IDs (prod_…) — referenced on the
 * line item; if the key can't reference them, we fall back to inline
 * product_data with the same amount.
 */

export const PACKAGES = {
  SA: {
    profile: "SA" as const,
    label: "SA profile — Solution Design Document",
    unitAmount: 49500,
    productEnv: "STRIPE_PRICE_SA",
  },
  PM: {
    profile: "PM" as const,
    label: "PM profile — Project Documentation",
    unitAmount: 49500,
    productEnv: "STRIPE_PRICE_PM",
  },
  SA_PM_BUNDLE: {
    profile: "SA_PM_BUNDLE" as const,
    label: "SA + PM bundle — both deliverables + cross-referencing",
    unitAmount: 79500,
    productEnv: "STRIPE_PRICE_BUNDLE",
  },
} as const;
export type PackageKey = keyof typeof PACKAGES;

let cachedStripe: Stripe | null = null;
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cachedStripe) cachedStripe = new Stripe(key);
  return cachedStripe;
}

/** Paid purchases for a project → which deliverables are unlocked. */
export async function getEntitlement(projectId: number) {
  const rows = await getDb()
    .select()
    .from(purchases)
    .where(and(eq(purchases.projectId, projectId), eq(purchases.status, "paid")))
    .orderBy(desc(purchases.createdAt));
  const has = (p: "SA" | "PM" | "SA_PM_BUNDLE") => rows.some((r) => r.profile === p);
  return {
    sa: has("SA") || has("SA_PM_BUNDLE"),
    pm: has("PM") || has("SA_PM_BUNDLE"),
    crossRef: has("SA_PM_BUNDLE"),
    purchases: rows,
  };
}

export const billingRouter = createRouter({
  /** Entitlement + package catalog for the Deliverables tab. */
  getBilling: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const entitlement = await getEntitlement(input.projectId);
      return {
        entitlement,
        configured: getStripe() !== null,
        packages: (Object.keys(PACKAGES) as PackageKey[]).map((key) => ({
          key,
          label: PACKAGES[key].label,
          amountCents: PACKAGES[key].unitAmount,
        })),
      };
    }),

  /** Create a Stripe Checkout Session; client redirects to the returned URL. */
  createCheckout: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        package: z.enum(["SA", "PM", "SA_PM_BUNDLE"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const stripe = getStripe();
      if (!stripe) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing is not configured yet (STRIPE_SECRET_KEY missing)",
        });
      }
      const pkg = PACKAGES[input.package];
      const origin = publicOrigin(ctx.req);
      const base: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        success_url: `${origin}/projects/${input.projectId}?tab=deliverables&purchase=success`,
        cancel_url: `${origin}/projects/${input.projectId}?tab=deliverables&purchase=cancelled`,
        client_reference_id: `${input.projectId}:${pkg.profile}`,
        metadata: { projectId: String(input.projectId), profile: pkg.profile },
        customer_email: ctx.user.email ?? undefined,
      };
      const priceRef = process.env[pkg.productEnv];
      // Env may hold a price ID (price_… — reference directly) or a product ID
      // (prod_… — attach inline price data); final fallback is fully inline.
      const inlineItem = (): Stripe.Checkout.SessionCreateParams.LineItem => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pkg.unitAmount,
          product_data: { name: `XP Architect — ${pkg.label}` },
        },
      });
      const primaryItem = (): Stripe.Checkout.SessionCreateParams.LineItem => {
        if (priceRef?.startsWith("price_")) return { quantity: 1, price: priceRef };
        if (priceRef) {
          return {
            quantity: 1,
            price_data: { currency: "usd", unit_amount: pkg.unitAmount, product: priceRef },
          };
        }
        return inlineItem();
      };

      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({
          ...base,
          line_items: [primaryItem()],
        });
      } catch (err) {
        if (!priceRef) throw err;
        // Key may not be permitted to reference existing prices/products — retry inline.
        session = await stripe.checkout.sessions.create({
          ...base,
          line_items: [inlineItem()],
        });
      }

      await getDb().insert(purchases).values({
        projectId: input.projectId,
        profile: pkg.profile,
        stripeSessionId: session.id,
        status: "pending",
        amountCents: pkg.unitAmount,
        currency: "usd",
      });

      return { url: session.url };
    }),

  /**
   * Verify-on-return: after Checkout sends the user back with
   * ?purchase=success, reconcile any pending purchases directly against
   * Stripe. This makes entitlement work even before the Dashboard webhook
   * endpoint is configured; the raw webhook remains the production path.
   */
  syncCheckout: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const stripe = getStripe();
      if (!stripe) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Billing is not configured yet (STRIPE_SECRET_KEY missing)",
        });
      }
      const db = getDb();
      const pending = await db
        .select()
        .from(purchases)
        .where(and(eq(purchases.projectId, input.projectId), eq(purchases.status, "pending")))
        .orderBy(desc(purchases.createdAt))
        .limit(5);

      let synced = 0;
      for (const p of pending) {
        if (!p.stripeSessionId) continue;
        try {
          const s = await stripe.checkout.sessions.retrieve(p.stripeSessionId);
          if (s.status === "complete" && s.payment_status === "paid") {
            await db
              .update(purchases)
              .set({
                status: "paid",
                stripePaymentIntent:
                  typeof s.payment_intent === "string"
                    ? s.payment_intent
                    : (s.payment_intent?.id ?? null),
                amountCents: s.amount_total ?? p.amountCents,
                currency: s.currency ?? p.currency,
              })
              .where(eq(purchases.id, p.id));
            synced += 1;
          }
        } catch (err) {
          console.warn(`[billing] sync retrieve failed for ${p.stripeSessionId}:`, err);
        }
      }

      return { synced, entitlement: await getEntitlement(input.projectId) };
    }),
});

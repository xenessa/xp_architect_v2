import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner } from "./queries/projects";
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
      const origin = new URL(ctx.req.url).origin;
      const base: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        success_url: `${origin}/projects/${input.projectId}?tab=deliverables&purchase=success`,
        cancel_url: `${origin}/projects/${input.projectId}?tab=deliverables&purchase=cancelled`,
        client_reference_id: `${input.projectId}:${pkg.profile}`,
        metadata: { projectId: String(input.projectId), profile: pkg.profile },
        customer_email: ctx.user.email ?? undefined,
      };
      const productId = process.env[pkg.productEnv];

      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({
          ...base,
          line_items: [
            {
              quantity: 1,
              price_data: productId
                ? { currency: "usd", unit_amount: pkg.unitAmount, product: productId }
                : {
                    currency: "usd",
                    unit_amount: pkg.unitAmount,
                    product_data: { name: `XP Architect — ${pkg.label}` },
                  },
            },
          ],
        });
      } catch (err) {
        if (!productId) throw err;
        // Key may not be permitted to reference existing products — retry inline.
        session = await stripe.checkout.sessions.create({
          ...base,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: pkg.unitAmount,
                product_data: { name: `XP Architect — ${pkg.label}` },
              },
            },
          ],
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
});

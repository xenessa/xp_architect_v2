import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "./queries/connection";
import { getStripe } from "./billing-router";
import { purchases } from "@db/schema";

/**
 * Stripe webhook (Q4): mounted as a RAW Hono route (POST /api/webhooks/stripe)
 * — never through tRPC, because signature verification needs the exact raw body.
 * Handles checkout.session.completed → flips the matching purchase to paid.
 * Idempotent: re-deliveries just re-apply the same values.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | undefined,
): Promise<{ received: true }> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    throw new Error("Stripe webhook not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)");
  }
  if (!signature) throw new Error("Missing stripe-signature header");

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const db = getDb();
    const paymentIntent =
      typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);

    const [existing] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.stripeSessionId, s.id))
      .limit(1);

    if (existing) {
      await db
        .update(purchases)
        .set({
          status: "paid",
          stripePaymentIntent: paymentIntent,
          amountCents: s.amount_total ?? existing.amountCents,
          currency: s.currency ?? existing.currency,
        })
        .where(eq(purchases.id, existing.id));
    } else {
      // Session created out-of-band — reconstruct from metadata.
      const projectId = Number(s.metadata?.projectId);
      const profile = s.metadata?.profile as "SA" | "PM" | "SA_PM_BUNDLE" | undefined;
      if (projectId && profile) {
        await db.insert(purchases).values({
          projectId,
          profile,
          stripeSessionId: s.id,
          stripePaymentIntent: paymentIntent,
          status: "paid",
          amountCents: s.amount_total ?? null,
          currency: s.currency ?? null,
        });
      }
    }
  }

  return { received: true };
}

/**
 * Public-facing origin for absolute URLs (invite links, emails, Stripe
 * success/cancel redirects). Behind the deployment proxy the raw request
 * URL is an internal address, so prefer forwarded headers; APP_PUBLIC_URL
 * overrides everything when set.
 */
export function publicOrigin(req: Request): string {
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/+$/, "");
  }
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

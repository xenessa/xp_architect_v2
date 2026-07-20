import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import { useEffect, type ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const isJsonResponse = (r: Response) => (r.headers.get("content-type") ?? "").includes("json");

/**
 * Platform-edge resilience. When the hosting instance is cold (spun down),
 * the edge answers the first request with an HTML error page instead of
 * proxying to the app — which surfaces as "Unexpected token '<' …" when the
 * client tries to parse it as JSON. Detect that shape, give the instance a
 * moment to boot, and retry once; if it's still HTML, fail with a readable
 * message instead of parse garbage.
 */
const resilientFetch: typeof fetch = async (input, init) => {
  const doFetch = () =>
    globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
      // Never pend forever: surface an error state instead of an eternal
      // loading skeleton. Long enough for parallel deliverable generation.
      signal: init?.signal ?? AbortSignal.timeout(60_000),
    } as RequestInit);

  let resp = await doFetch();
  if (!isJsonResponse(resp)) {
    await new Promise((r) => setTimeout(r, 1500));
    resp = await doFetch();
    if (!isJsonResponse(resp)) {
      throw new Error("The server is warming up — please try again in a few seconds.");
    }
  }
  return resp;
};

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: resilientFetch,
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Wake a cold platform instance on page load so the user's first real
    // action doesn't eat the spin-up cost. Fire-and-forget, with a second
    // ping shortly after in case the first one triggered the boot.
    const ping = () => globalThis.fetch("/api/health").catch(() => {});
    ping();
    const t = setTimeout(ping, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

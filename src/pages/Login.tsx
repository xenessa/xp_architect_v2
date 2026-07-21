import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import { trpc } from "@/providers/trpc";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<"sent" | "dev_logged" | null>(null);
  const request = trpc.auth.requestMagicLink.useMutation({
    onSuccess: (res) => setSent(res.delivered === "dev_logged" ? "dev_logged" : "sent"),
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="XP Architect" className="h-12 w-12 rounded-xl" />
        <div className="flex flex-col leading-tight">
          <span className="text-2xl font-semibold tracking-tight">XP Architect</span>
          <span className="text-sm text-muted-foreground">by Xenessa</span>
        </div>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {params.get("error") === "magic" && (
            <p className="text-sm text-destructive text-center">
              That sign-in link is invalid or has expired — request a new one below.
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
          >
            Sign in with Kimi
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          {sent ? (
            <p className="text-center text-sm text-muted-foreground">
              {sent === "sent"
                ? "If that email is registered, a sign-in link is on its way. It works once and expires in 15 minutes."
                : "Email delivery isn't configured on this server yet — the sign-in link was written to the server log."}
            </p>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) request.mutate({ email: email.trim() });
              }}
            >
              <Input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={request.isPending}>
                {request.isPending ? "Sending…" : "Email me a sign-in link"}
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground">
            <Link to="/privacy" className="underline underline-offset-4">
              Privacy &amp; data handling
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

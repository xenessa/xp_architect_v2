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

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/logo.png"
        alt="XP Architect"
        className={large ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-lg"}
      />
      <div className="flex flex-col leading-tight">
        <span className={`${large ? "text-xl" : "text-base"} font-semibold tracking-tight`}>
          XP Architect
        </span>
        <span className="mt-1 h-0.5 w-9 rounded-full bg-gold" />
        <span className="mt-1 text-xs text-muted-foreground">by Xenessa</span>
      </div>
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<"sent" | "dev_logged" | null>(null);
  const request = trpc.auth.requestMagicLink.useMutation({
    onSuccess: (res) => setSent(res.delivered === "dev_logged" ? "dev_logged" : "sent"),
  });

  return (
    <div className="min-h-screen flex bg-card">
      {/* Editorial brand panel — desktop only */}
      <div className="hidden lg:flex w-[54%] flex-col justify-between gap-10 overflow-hidden bg-background p-14 xl:p-20">
        <BrandMark />

        <div className="max-w-xl">
          <h1 className="font-display text-6xl xl:text-7xl leading-[1.04] tracking-tight text-foreground">
            Listen<span className="text-gold">.</span>
            <br />
            Design<span className="text-gold">.</span>
            <br />
            Deliver<span className="text-gold">.</span>
          </h1>
          <p className="mt-7 text-lg leading-relaxed text-muted-foreground">
            AI-guided stakeholder discovery that turns every conversation into
            implementation-ready solution design.
          </p>
        </div>

        <div className="relative -mx-6 flex-1 min-h-0">
          <img
            src="/login-hero.png"
            alt=""
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Trusted by delivery teams running enterprise implementations.
        </p>
      </div>

      {/* Sign-in panel */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 bg-card">
        <div className="lg:hidden">
          <BrandMark large />
        </div>

        <Card className="w-full max-w-sm shadow-lg border-border/60">
          <CardHeader className="text-center pb-4">
            <CardTitle className="font-display text-2xl font-medium">Welcome</CardTitle>
            <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
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
    </div>
  );
}

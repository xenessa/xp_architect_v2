import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  CompletionRing,
  Monogram,
  StageStepper,
  StatTile,
} from "@/components/ProjectVisuals";
import { EmptyPortfolio } from "@/components/illustrations/blueprint";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, FolderPlus } from "lucide-react";
import { useNavigate } from "react-router";

const STAGE_LABELS: Record<string, string> = {
  SETUP: "Setup",
  DISCOVERY_OPEN: "Discovery",
  COMPILATION_READY: "Compilation",
  DELIVERABLES: "Deliverables",
};

export default function Home() {
  const navigate = useNavigate();
  const projects = trpc.projects.list.useQuery();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0];

  // Portfolio rollup for the stat strip + hero signal — derived client-side
  // from data the dashboard already fetches.
  const d = projects.data;
  const totals = d
    ? {
        projects: d.length,
        inFlight: d.reduce(
          (n, p) => n + (p.rollup.stakeholderCount - p.rollup.completedCount),
          0,
        ),
        completed: d.reduce((n, p) => n + p.rollup.completedCount, 0),
        alerts: d.reduce((n, p) => n + p.rollup.unreadAlertCount, 0),
      }
    : null;

  const signal = totals
    ? [
        totals.completed > 0 &&
          `${totals.completed} session${totals.completed === 1 ? "" : "s"} completed`,
        totals.alerts > 0 &&
          `${totals.alerts} unread alert${totals.alerts === 1 ? "" : "s"}`,
        totals.inFlight > 0 &&
          `${totals.inFlight} stakeholder${totals.inFlight === 1 ? "" : "s"} in flight`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="relative overflow-hidden rounded-xl">
          <img
            src="/blueprint-dark.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[hsl(219_50%_10%)]/55" />
          <div className="relative flex flex-wrap items-center justify-between gap-4 p-7">
            <div>
              <p className="text-sm text-white/70">
                Welcome back{firstName ? `, ${firstName}` : ""}
              </p>
              <h2 className="mt-1 font-display text-2xl tracking-tight text-white xl:text-3xl">
                What will you discover today?
              </h2>
              <span className="mt-3 block h-0.5 w-10 rounded-full bg-gold" />
              {signal && (
                <p className="mt-3 flex items-center gap-2 text-[13.5px] text-white/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  {signal}
                </p>
              )}
            </div>
            <Button
              className="!bg-gold !text-gold-foreground hover:!bg-gold/90"
              onClick={() => navigate("/projects/new")}
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>

        {totals && totals.projects > 0 && (
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <StatTile label="Active projects" value={totals.projects} />
            <StatTile
              label="Stakeholders in flight"
              value={totals.inFlight}
              sub={`across ${totals.projects} project${totals.projects === 1 ? "" : "s"}`}
            />
            <StatTile label="Sessions completed" value={totals.completed} />
            <StatTile
              label="Open alerts"
              value={totals.alerts}
              sub={
                totals.alerts > 0 ? (
                  <span className="font-medium text-destructive">needs review</span>
                ) : (
                  "all clear"
                )
              }
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">
              Your discovery engagements at a glance.
            </p>
          </div>
        </div>

        {projects.isLoading && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-[10px]" />
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                  <Skeleton className="h-[74px] w-[74px] rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-[5px] w-full rounded-full" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {projects.error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-sm text-destructive">
              Couldn't load projects: {projects.error.message}
            </CardContent>
          </Card>
        )}

        {projects.data?.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
              <EmptyPortfolio className="h-32 w-44" title="Empty drafting table" />
              <p className="font-display text-xl">No projects yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create your first project to define scope, invite stakeholders,
                and start AI-powered discovery.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data?.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <Monogram name={p.clientName || p.name} />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base">{p.name}</CardTitle>
                    {p.clientName && (
                      <p className="truncate text-sm text-muted-foreground">
                        {p.clientName}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    {p.rollup.unreadAlertCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-gold-foreground"
                        title={`${p.rollup.unreadAlertCount} unread compiler alert(s)`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {p.rollup.unreadAlertCount}
                      </span>
                    )}
                    <Badge variant="secondary">{STAGE_LABELS[p.rollup.stage]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <CompletionRing
                    completed={p.rollup.completedCount}
                    total={p.rollup.stakeholderCount}
                  />
                  <StageStepper stage={p.rollup.stage} />
                </div>
                {p.rollup.lastActivityAt && (
                  <p className="text-xs text-muted-foreground">
                    Last activity{" "}
                    {formatDistanceToNow(new Date(p.rollup.lastActivityAt), {
                      addSuffix: true,
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}

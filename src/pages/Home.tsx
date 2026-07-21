import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { FolderPlus, Users } from "lucide-react";
import { useNavigate } from "react-router";

const STAGES = ["SETUP", "DISCOVERY_OPEN", "COMPILATION_READY", "DELIVERABLES"] as const;
const STAGE_LABELS: Record<string, string> = {
  SETUP: "Setup",
  DISCOVERY_OPEN: "Discovery",
  COMPILATION_READY: "Compilation",
  DELIVERABLES: "Deliverables",
};

function StageBar({ stage }: { stage: string }) {
  const activeIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s, i) => (
        <div key={s} className="flex-1">
          <div
            className={`h-1.5 rounded-full ${i <= activeIdx ? "bg-primary" : "bg-muted"}`}
            title={STAGE_LABELS[s]}
          />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const projects = trpc.projects.list.useQuery();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0];

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

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">
              Your discovery engagements at a glance.
            </p>
          </div>
        </div>

        {projects.isLoading && (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
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
              <img
                src="/empty-state.png"
                alt=""
                className="h-36 w-36 object-contain opacity-90"
              />
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
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {p.clientName && (
                      <p className="text-sm text-muted-foreground">{p.clientName}</p>
                    )}
                  </div>
                  <Badge variant="secondary">{STAGE_LABELS[p.rollup.stage]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <StageBar stage={p.rollup.stage} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>
                    {p.rollup.completedCount}/{p.rollup.stakeholderCount} stakeholders
                    complete
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}

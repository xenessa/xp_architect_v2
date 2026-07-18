import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useParams } from "react-router";
import { CheckCheck, Copy, Mail, RefreshCw, Trash2, UserPlus } from "lucide-react";

type Severity = "low" | "medium" | "high";

interface CompiledDataset {
  stakeholder_coverage: { name: string; role_title: string; phases_covered: number }[];
  contradictions: {
    topic: string;
    positions: { stakeholder: string; claim: string }[];
    severity: Severity;
  }[];
  patterns: { theme: string; supporting_stakeholders: string[]; detail: string }[];
  out_of_scope_ranked: {
    item: string;
    raised_by: string[];
    recommendation: string;
    detail: string;
  }[];
  coverage_gaps: { area: string; severity: Severity; detail: string }[];
  executive_summary: string;
  readiness_score: number;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const variant =
    severity === "high" ? "destructive" : severity === "medium" ? "default" : "secondary";
  return <Badge variant={variant}>{severity}</Badge>;
}

const STATE_LABELS: Record<string, string> = {
  INVITED: "Invited",
  ASSESSMENT_IN_PROGRESS: "Assessment in progress",
  ASSESSMENT_COMPLETE: "Assessment complete",
  DISCOVERY_IN_PROGRESS: "Discovery in progress",
  DISCOVERY_COMPLETE: "Discovery complete",
  REVIEW_IN_PROGRESS: "Review in progress",
  COMPLETED: "Completed",
};

function AddStakeholderForm({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: "", roleTitle: "", email: "" });
  const add = trpc.stakeholders.add.useMutation({
    onSuccess: () => {
      setForm({ name: "", roleTitle: "", email: "" });
      utils.stakeholders.progress.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
    },
  });

  const valid =
    form.name.trim() && form.roleTitle.trim() && /.+@.+\..+/.test(form.email);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Add stakeholder</p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sh-name">Name *</Label>
          <Input
            id="sh-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sh-role">Role / title *</Label>
          <Input
            id="sh-role"
            value={form.roleTitle}
            onChange={(e) => setForm({ ...form, roleTitle: e.target.value })}
            placeholder="Sales Operations Lead"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sh-email">Email *</Label>
          <Input
            id="sh-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="jane@client.com"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!valid || add.isPending}
          onClick={() => add.mutate({ projectId, ...form })}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          {add.isPending ? "Adding…" : "Add & send invite"}
        </Button>
        {add.error && (
          <p className="text-sm text-destructive">{add.error.message}</p>
        )}
        {add.isSuccess && (
          <p className="text-sm text-muted-foreground">
            Invite email sent (link copyable below).
          </p>
        )}
      </div>
    </div>
  );
}

function StakeholderRow({
  projectId,
  row,
}: {
  projectId: number;
  row: {
    stakeholder: {
      id: number;
      name: string;
      roleTitle: string;
      email: string;
      inviteToken: string;
      invitedAt: Date;
    };
    session: { state: string; currentPhase: number | null } | null;
  };
}) {
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const invalidate = () => {
    utils.stakeholders.progress.invalidate({ projectId });
    utils.projects.get.invalidate({ id: projectId });
  };
  const resend = trpc.stakeholders.resendInvite.useMutation({ onSuccess: invalidate });
  const regenerate = trpc.stakeholders.regenerateInvite.useMutation({ onSuccess: invalidate });
  const remove = trpc.stakeholders.remove.useMutation({ onSuccess: invalidate });

  const inviteUrl = `${window.location.origin}/s/${row.stakeholder.inviteToken}`;
  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium">{row.stakeholder.name}</p>
          <Badge variant={row.session?.state === "COMPLETED" ? "default" : "secondary"}>
            {STATE_LABELS[row.session?.state ?? "INVITED"]}
            {row.session?.state === "DISCOVERY_IN_PROGRESS" && row.session.currentPhase
              ? ` · Phase ${row.session.currentPhase}`
              : ""}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {row.stakeholder.roleTitle} · {row.stakeholder.email}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resend.mutate({ id: row.stakeholder.id })}
          disabled={resend.isPending}
        >
          <Mail className="mr-1.5 h-3.5 w-3.5" />
          Resend
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => regenerate.mutate({ id: row.stakeholder.id })}
          disabled={regenerate.isPending}
          title="New link, fresh 30-day expiry"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Regenerate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => remove.mutate({ id: row.stakeholder.id })}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function CompilationTab({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const comp = trpc.compiler.getCompilation.useQuery({ projectId });
  const invalidate = () => {
    utils.compiler.getCompilation.invalidate({ projectId });
    utils.projects.get.invalidate({ id: projectId });
  };
  const run = trpc.compiler.runCompilation.useMutation({ onSuccess: invalidate });
  const markRead = trpc.compiler.markAlertRead.useMutation({ onSuccess: invalidate });
  const markAll = trpc.compiler.markAllAlertsRead.useMutation({ onSuccess: invalidate });

  if (comp.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading compilation…</p>;
  }
  if (!comp.data) {
    return (
      <p className="text-sm text-destructive">
        Couldn't load compilation data. {comp.error?.message}
      </p>
    );
  }
  const d = comp.data;
  const report = d.latestReport;
  const dataset = (report?.dataset ?? null) as CompiledDataset | null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Compiler alerts</CardTitle>
            {d.unreadCount > 0 && <Badge>{d.unreadCount} new</Badge>}
          </div>
          {d.unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markAll.mutate({ projectId })}
              disabled={markAll.isPending}
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {d.alerts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No alerts yet. As each stakeholder completes discovery, the Compiler flags
              contradictions, risks, scope creep, and coverage gaps here.
            </p>
          )}
          {d.alerts.map((a) => (
            <div
              key={a.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${a.read ? "opacity-60" : ""}`}
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <Badge variant="outline">{a.type.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-sm">{a.message}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              {!a.read && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markRead.mutate({ alertId: a.id })}
                  disabled={markRead.isPending}
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Compiled dataset</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {d.completedCount} of {d.stakeholderCount} stakeholders complete
              {report ? ` · version ${report.version}` : ""}
            </p>
          </div>
          <Button
            onClick={() => run.mutate({ projectId })}
            disabled={d.completedCount === 0 || run.isPending}
          >
            {run.isPending
              ? "Compiling…"
              : report
                ? `Re-run Compiler (→ v${report.version + 1})`
                : "Run Compiler"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {run.error && <p className="text-sm text-destructive">{run.error.message}</p>}
          {!dataset && (
            <p className="text-sm text-muted-foreground">
              {d.completedCount === 0
                ? "The Compiler runs once at least one stakeholder has completed discovery. It consolidates contradictions, patterns, out-of-scope themes, and coverage gaps into the dataset your deliverables are built from."
                : "Ready when you are — run the Compiler to consolidate completed sessions. You can re-run it as more stakeholders finish; each run is versioned."}
            </p>
          )}
          {dataset && (
            <>
              {d.completedCount < d.stakeholderCount && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Partial dataset — {d.stakeholderCount - d.completedCount} stakeholder(s)
                  still outstanding. Re-run after they finish for full coverage.
                </p>
              )}
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-primary text-lg font-semibold">
                  {dataset.readiness_score}
                </div>
                <div>
                  <p className="text-sm font-medium">Readiness score</p>
                  <p className="text-sm text-muted-foreground">
                    Coverage and coherence of this dataset for deliverable generation.
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">Executive summary</p>
                <p className="text-sm text-muted-foreground">{dataset.executive_summary}</p>
              </div>
              <Separator />
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    Contradictions ({dataset.contradictions.length})
                  </p>
                  {dataset.contradictions.length === 0 && (
                    <p className="text-sm text-muted-foreground">None detected.</p>
                  )}
                  {dataset.contradictions.map((c, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="font-medium">{c.topic}</p>
                        <SeverityBadge severity={c.severity} />
                      </div>
                      {c.positions.map((pos, j) => (
                        <p key={j} className="text-muted-foreground">
                          <span className="font-medium text-foreground">{pos.stakeholder}:</span>{" "}
                          {pos.claim}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Patterns ({dataset.patterns.length})</p>
                  {dataset.patterns.length === 0 && (
                    <p className="text-sm text-muted-foreground">None detected.</p>
                  )}
                  {dataset.patterns.map((pt, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{pt.theme}</p>
                      <p className="text-muted-foreground">{pt.detail}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pt.supporting_stakeholders.join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    Out-of-scope themes ({dataset.out_of_scope_ranked.length})
                  </p>
                  {dataset.out_of_scope_ranked.length === 0 && (
                    <p className="text-sm text-muted-foreground">None raised.</p>
                  )}
                  {dataset.out_of_scope_ranked.map((o, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="font-medium">{o.item}</p>
                        <Badge variant="outline">{o.recommendation}</Badge>
                      </div>
                      <p className="text-muted-foreground">{o.detail}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Raised by: {o.raised_by.join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    Coverage gaps ({dataset.coverage_gaps.length})
                  </p>
                  {dataset.coverage_gaps.length === 0 && (
                    <p className="text-sm text-muted-foreground">None detected.</p>
                  )}
                  {dataset.coverage_gaps.map((g, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="font-medium">{g.area}</p>
                        <SeverityBadge severity={g.severity} />
                      </div>
                      <p className="text-muted-foreground">{g.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
              <div>
                <p className="mb-2 text-sm font-medium">Stakeholder coverage</p>
                <div className="flex flex-wrap gap-2">
                  {dataset.stakeholder_coverage.map((s, i) => (
                    <Badge key={i} variant="secondary">
                      {s.name} · {s.phases_covered}/4 phases
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const project = trpc.projects.get.useQuery({ id: projectId });
  const progress = trpc.stakeholders.progress.useQuery({ projectId });

  if (project.isLoading) {
    return (
      <AuthLayout>
        <p className="p-6 text-sm text-muted-foreground">Loading project…</p>
      </AuthLayout>
    );
  }
  if (!project.data) {
    return (
      <AuthLayout>
        <p className="p-6 text-sm text-destructive">Project not found.</p>
      </AuthLayout>
    );
  }
  const p = project.data;

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="text-sm text-muted-foreground">
            {p.clientName ? `${p.clientName} · ` : ""}
            {p.rollup.completedCount}/{p.rollup.stakeholderCount} stakeholders complete
          </p>
        </div>

        <Tabs defaultValue="setup">
          <TabsList>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="discovery">Discovery Progress</TabsTrigger>
            <TabsTrigger value="compilation">Compilation</TabsTrigger>
            <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="mt-4 flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scope & constraints</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="mb-1 font-medium">Scope</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{p.scopeText}</p>
                </div>
                {p.constraintsText && (
                  <div>
                    <p className="mb-1 font-medium">Constraints</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {p.constraintsText}
                    </p>
                  </div>
                )}
                <Separator />
                <p className="text-muted-foreground">
                  {[p.budget && `Budget: ${p.budget}`, p.timeline && `Timeline: ${p.timeline}`, p.teamSize && `Team: ${p.teamSize}`]
                    .filter(Boolean)
                    .join(" · ") || "No logistics recorded."}
                </p>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">Stakeholders</h2>
              <AddStakeholderForm projectId={projectId} />
              {progress.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No stakeholders yet — add your first one above. Their invite email
                  goes out automatically.
                </p>
              )}
              {progress.data?.map((row) => (
                <StakeholderRow key={row.stakeholder.id} projectId={projectId} row={row} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="discovery" className="mt-4">
            <div className="flex flex-col gap-3">
              {progress.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No stakeholders yet — add them on the Setup tab.
                </p>
              )}
              {progress.data?.map((row) => {
                const state = row.session?.state ?? "INVITED";
                const basis = row.stakeholder.lastActivityAt ?? row.stakeholder.invitedAt;
                const stalled =
                  state !== "COMPLETED" &&
                  Date.now() - new Date(basis).getTime() > 3 * 24 * 60 * 60 * 1000;
                return (
                  <div
                    key={row.stakeholder.id}
                    className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{row.stakeholder.name}</p>
                        <Badge variant={state === "COMPLETED" ? "default" : "secondary"}>
                          {STATE_LABELS[state]}
                          {state === "DISCOVERY_IN_PROGRESS" && row.session?.currentPhase
                            ? ` · Phase ${row.session.currentPhase}`
                            : ""}
                        </Badge>
                        {stalled && <Badge variant="destructive">Stalled</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {row.stakeholder.roleTitle}
                      </p>
                    </div>
                    <div className="flex flex-col gap-0.5 text-sm text-muted-foreground md:items-end">
                      <span>
                        Last activity:{" "}
                        {row.stakeholder.lastActivityAt
                          ? new Date(row.stakeholder.lastActivityAt).toLocaleDateString()
                          : "—"}
                      </span>
                      <span>Nudges sent: {row.stakeholder.nudgeCount}/3</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="compilation" className="mt-4">
            <CompilationTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="deliverables" className="mt-4">
            <Card className="border-dashed">
              <CardContent className="p-6 text-sm text-muted-foreground">
                SA / PM deliverables arrive in Phase 5.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AuthLayout>
  );
}

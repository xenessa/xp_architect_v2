import { useEffect, useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useParams, useSearchParams } from "react-router";
import {
  CheckCheck,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Mail,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";

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
          title="Open the stakeholder invite in this browser tab"
          onClick={() => {
            window.location.href = inviteUrl;
          }}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open invite
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
  // Consolidation runs as a background job (it can take minutes on a reasoning
  // model) — start it, then poll compilationStatus until it lands or fails.
  const [compiling, setCompiling] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const run = trpc.compiler.runCompilation.useMutation({
    onSuccess: (res) => {
      if (res.started) {
        setJobError(null);
        setCompiling(true);
      }
    },
  });
  const status = trpc.compiler.compilationStatus.useQuery(
    { projectId },
    { enabled: compiling, refetchInterval: 4000 },
  );
  const job = status.data?.job ?? null;
  useEffect(() => {
    if (!compiling || !job) return;
    if (job.status === "done") {
      setCompiling(false);
      invalidate();
    } else if (job.status === "failed") {
      setCompiling(false);
      setJobError(job.error ?? "Compilation failed — please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiling, job?.status]);
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
            {d.unreadCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-gold-foreground">
                {d.unreadCount} new
              </span>
            )}
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
            <div className="flex items-center gap-5 py-2">
              <img
                src="/empty-state.png"
                alt=""
                className="h-20 w-20 shrink-0 object-contain opacity-90"
              />
              <p className="text-sm text-muted-foreground">
                No alerts yet. As each stakeholder completes discovery, the Compiler flags
                contradictions, risks, scope creep, and coverage gaps here.
              </p>
            </div>
          )}
          {d.alerts.map((a) => (
            <div
              key={a.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${a.read ? "opacity-60" : "border-l-2 border-l-gold"}`}
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
            disabled={d.completedCount === 0 || run.isPending || compiling}
          >
            {run.isPending || compiling
              ? "Compiling…"
              : report
                ? `Re-run Compiler (→ v${report.version + 1})`
                : "Run Compiler"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {compiling && (
            <p className="text-sm text-muted-foreground">
              The Compiler is consolidating the completed sessions — this takes a minute or
              two. The page updates itself when it's done.
            </p>
          )}
          {jobError && <p className="text-sm text-destructive">{jobError}</p>}
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

const PACKAGE_FEATURES: Record<string, string[]> = {
  SA: ["Solution Design Document", "Built from the compiled dataset", ".docx export, versioned"],
  PM: ["Project Documentation", "Built from the compiled dataset", ".docx export, versioned"],
  SA_PM_BUNDLE: [
    "Both SA and PM deliverables",
    "Cross-referencing layer between them",
    "~20% below buying the pair",
  ],
};

const STATUS_FLOW: Record<string, { next: "in_review" | "approved"; label: string } | null> = {
  draft: { next: "in_review", label: "Move to review" },
  in_review: { next: "approved", label: "Approve" },
  approved: null,
};

function DeliverablesTab({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [searchParams] = useSearchParams();
  const purchaseState = searchParams.get("purchase");
  const data = trpc.team.getDeliverables.useQuery({ projectId });
  const billing = trpc.billing.getBilling.useQuery({ projectId });
  const llm = trpc.projects.llmStatus.useQuery({ id: projectId });
  const invalidate = () => {
    utils.team.getDeliverables.invalidate({ projectId });
    utils.billing.getBilling.invalidate({ projectId });
  };

  const sync = trpc.billing.syncCheckout.useMutation({ onSuccess: invalidate });

  // On return from checkout, reconcile directly against Stripe (the webhook
  // remains the production path; this covers the pre-webhook-setup window).
  useEffect(() => {
    if (searchParams.get("purchase") !== "success") return;
    sync.mutate({ projectId });
    const t = setTimeout(invalidate, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: (r) => {
      if (r.url) window.location.href = r.url;
    },
  });
  // Invalidate on success AND on failure: if the platform cut the response
  // but the server finished generating, a refetch reveals the new version.
  const generate = trpc.team.generate.useMutation({ onSettled: invalidate });
  const updateStatus = trpc.team.updateStatus.useMutation({ onSuccess: invalidate });
  const submitFeedback = trpc.team.submitFeedback.useMutation({ onSuccess: invalidate });
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>({});

  const [downloading, setDownloading] = useState<number | null>(null);
  const handleDownload = async (deliverableId: number) => {
    setDownloading(deliverableId);
    try {
      const res = await utils.team.downloadDocx.fetch({ deliverableId });
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  if (data.isLoading || billing.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading deliverables…</p>;
  }
  if (!data.data || !billing.data) {
    return (
      <p className="text-sm text-destructive">
        Couldn't load deliverables. {data.error?.message ?? billing.error?.message}
      </p>
    );
  }
  const d = data.data;
  const b = billing.data;
  const entitled = b.entitlement.sa || b.entitlement.pm;
  const latestFor = (templateId: string) =>
    d.deliverables.find((doc) => doc.templateId === templateId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {purchaseState === "success" && (
        <p className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
          Payment received — your package is unlocked. Generate your deliverable below.
        </p>
      )}
      {purchaseState === "cancelled" && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Checkout cancelled — nothing was charged.
        </p>
      )}

      {llm.data && (
        <div>
          {llm.data.mode === "live" ? (
            <Badge>
              {llm.data.chatModel
                ? `Live · ${llm.data.chatModel.split("/").pop()} chat · ${llm.data.model?.split("/").pop()} docs`
                : `Live model · ${llm.data.model}`}
            </Badge>
          ) : (
            <Badge variant="secondary">
              Demo mode — scripted agents (no model endpoint configured)
            </Badge>
          )}
        </div>
      )}

      {!entitled && (
        <div className="grid gap-4 md:grid-cols-3">
          {b.packages.map((pkg) => (
            <Card
              key={pkg.key}
              className={pkg.key === "SA_PM_BUNDLE" ? "border-2 border-gold" : ""}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {pkg.key === "SA" ? "SA profile" : pkg.key === "PM" ? "PM profile" : "SA + PM bundle"}
                  </CardTitle>
                  {pkg.key === "SA_PM_BUNDLE" && (
                    <span className="inline-flex items-center rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-gold-foreground">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-2xl font-semibold">
                  ${(pkg.amountCents / 100).toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground"> / project</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {PACKAGE_FEATURES[pkg.key].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={pkg.key === "SA_PM_BUNDLE" ? "default" : "outline"}
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate({ projectId, package: pkg.key as "SA" | "PM" | "SA_PM_BUNDLE" })}
                >
                  {checkout.isPending ? "Redirecting…" : "Buy with Stripe"}
                </Button>
              </CardContent>
            </Card>
          ))}
          {checkout.error && (
            <p className="text-sm text-destructive md:col-span-3">{checkout.error.message}</p>
          )}
        </div>
      )}

      {entitled && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Unlocked:</span>
          {b.entitlement.sa && <Badge>SA profile</Badge>}
          {b.entitlement.pm && <Badge>PM profile</Badge>}
          {b.entitlement.crossRef && <Badge variant="secondary">Cross-referencing</Badge>}
        </div>
      )}

      {generate.error && (
        <p className="text-sm text-destructive">
          {/Unexpected token|DOCTYPE|not valid JSON|Failed to fetch/i.test(generate.error.message)
            ? "The response was cut off before it reached you — if no new version appears within a few seconds, press Generate again."
            : generate.error.message}
        </p>
      )}

      {d.templates.map((tpl) => {
        const unlocked = tpl.profile === "SA" ? b.entitlement.sa : b.entitlement.pm;
        const doc = latestFor(tpl.id);
        const title = tpl.name;
        const flow = doc ? STATUS_FLOW[doc.status] : null;
        // One shared mutation drives all cards — scope the spinner/disabled
        // state to the card actually being generated.
        const thisCard = generate.isPending && generate.variables?.templateId === tpl.id;
        return (
          <Card key={tpl.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">
                  {title} <span className="text-muted-foreground">({tpl.profile})</span>
                </CardTitle>
                {doc && (
                  <Badge variant={doc.status === "approved" ? "default" : "secondary"}>
                    v{doc.version} · {doc.status.replace("_", " ")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {doc && flow && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate({ deliverableId: doc.id, status: flow.next })}
                  >
                    {flow.label}
                  </Button>
                )}
                {doc && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={downloading === doc.id}
                    onClick={() => handleDownload(doc.id)}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {downloading === doc.id ? "Preparing…" : ".docx"}
                  </Button>
                )}
                {unlocked && (
                  <Button
                    size="sm"
                    disabled={
                      generate.isPending || d.compiledReportVersion === null
                    }
                    onClick={() => generate.mutate({ projectId, templateId: tpl.id })}
                    title={
                      d.compiledReportVersion === null
                        ? "Run the Compiler first (Compilation tab)"
                        : doc
                          ? `Regenerate → v${doc.version + 1}`
                          : "Generate from the compiled dataset"
                    }
                  >
                    {thisCard
                      ? "Generating…"
                      : doc
                        ? `Re-generate (→ v${doc.version + 1})`
                        : "Generate"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{tpl.description}</p>
              {!unlocked && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  Locked — purchase the {tpl.profile} profile (or the bundle) to unlock
                  generation.
                </p>
              )}
              {unlocked && d.compiledReportVersion === null && (
                <p className="text-sm text-muted-foreground">
                  Almost there — run the Compiler on the Compilation tab first;
                  deliverables are generated from the compiled dataset.
                </p>
              )}
              {unlocked &&
                d.compiledReportVersion !== null &&
                d.readinessScore !== null &&
                d.readinessScore < 70 && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    Thin data warning — compiled readiness is {d.readinessScore}/100.
                    Generation is blocked below 40; more completed sessions and a fresh
                    Compiler run will raise the quality of this document.
                  </p>
                )}
              {unlocked && !doc && d.compiledReportVersion !== null && (
                <p className="text-sm text-muted-foreground">
                  Ready — generate the {title} from compiled dataset v
                  {d.compiledReportVersion}.
                </p>
              )}
              {doc && (
                <>
                  <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/30 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm">
                      {doc.contentMd}
                    </pre>
                  </div>
                  {doc.crossRoleNotesMd && (
                    <div className="rounded-lg border border-primary/30 p-4">
                      <p className="mb-1 text-sm font-medium">
                        Cross-referencing layer
                      </p>
                      <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                        {doc.crossRoleNotesMd}
                      </pre>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 rounded-lg border p-4">
                    <p className="text-sm font-medium">Feedback for the next version</p>
                    <Textarea
                      rows={2}
                      value={feedbackDrafts[doc.id] ?? ""}
                      onChange={(e) =>
                        setFeedbackDrafts((m) => ({ ...m, [doc.id]: e.target.value }))
                      }
                      placeholder="e.g. Emphasize integration risks in section 5; shorten the executive summary."
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !feedbackDrafts[doc.id]?.trim() || submitFeedback.isPending
                        }
                        onClick={() =>
                          submitFeedback.mutate(
                            { deliverableId: doc.id, feedback: feedbackDrafts[doc.id].trim() },
                            {
                              onSuccess: () =>
                                setFeedbackDrafts((m) => ({ ...m, [doc.id]: "" })),
                            },
                          )
                        }
                      >
                        {submitFeedback.isPending
                          ? "Regenerating…"
                          : "Regenerate with feedback"}
                      </Button>
                      {submitFeedback.error && (
                        <p className="text-sm text-destructive">
                          {submitFeedback.error.message}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
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

        <Tabs defaultValue={searchParams.get("tab") ?? "setup"}>
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
            <DeliverablesTab projectId={projectId} />
          </TabsContent>
        </Tabs>
      </div>
    </AuthLayout>
  );
}

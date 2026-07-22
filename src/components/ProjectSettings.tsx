import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Pencil, ShieldCheck, Trash2 } from "lucide-react";

type ProjectData = {
  id: number;
  name: string;
  clientName: string | null;
  scopeText: string;
  constraintsText: string | null;
  budget: string | null;
  timeline: string | null;
  teamSize: string | null;
};

/** Edit project details — everything the setup wizard captured (§10.2). */
function EditProjectDialog({ project }: { project: ProjectData }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: project.name,
    clientName: project.clientName ?? "",
    scopeText: project.scopeText,
    constraintsText: project.constraintsText ?? "",
    budget: project.budget ?? "",
    timeline: project.timeline ?? "",
    teamSize: project.teamSize ?? "",
  });
  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: project.id });
      setOpen(false);
      toast.success("Project details updated");
    },
    onError: (e) => toast.error(`Couldn't save: ${e.message}`),
  });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Scope text is the boundary the Scope Guardian enforces in every
            conversation — sharpen it carefully.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-name">Project name *</Label>
              <Input id="ep-name" value={form.name} onChange={set("name")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-client">Client</Label>
              <Input id="ep-client" value={form.clientName} onChange={set("clientName")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-scope">Scope *</Label>
            <Textarea id="ep-scope" rows={5} value={form.scopeText} onChange={set("scopeText")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-constraints">Constraints</Label>
            <Textarea
              id="ep-constraints"
              rows={3}
              value={form.constraintsText}
              onChange={set("constraintsText")}
            />
          </div>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-budget">Budget</Label>
              <Input id="ep-budget" value={form.budget} onChange={set("budget")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-timeline">Timeline</Label>
              <Input id="ep-timeline" value={form.timeline} onChange={set("timeline")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ep-team">Team size</Label>
              <Input id="ep-team" value={form.teamSize} onChange={set("teamSize")} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!form.name.trim() || !form.scopeText.trim() || update.isPending}
            onClick={() =>
              update.mutate({
                id: project.id,
                name: form.name.trim(),
                clientName: form.clientName.trim() || undefined,
                scopeText: form.scopeText.trim(),
                constraintsText: form.constraintsText.trim() || undefined,
                budget: form.budget.trim() || undefined,
                timeline: form.timeline.trim() || undefined,
                teamSize: form.teamSize.trim() || undefined,
              })
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** BYO model endpoint — privacy tier 2 (§9.3): config-only, never echoes keys. */
function ModelEndpointSection({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const status = trpc.projects.llmStatus.useQuery({ id: projectId });
  const [form, setForm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const save = trpc.projects.updateLlmEndpoint.useMutation({
    onSuccess: (_r, vars) => {
      utils.projects.llmStatus.invalidate({ id: projectId });
      setForm({ baseUrl: "", model: "", apiKey: "" });
      toast.success(
        vars.endpoint
          ? "Model endpoint saved — this project's AI traffic now goes to your endpoint"
          : "Custom endpoint removed — back to the managed model",
      );
    },
    onError: (e) => toast.error(`Couldn't update the endpoint: ${e.message}`),
  });

  const s = status.data;
  const byo = s?.source === "byo";
  const valid =
    /^https?:\/\/.+/.test(form.baseUrl.trim()) &&
    form.model.trim().length > 0 &&
    form.apiKey.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Model endpoint</p>
        {s &&
          (byo ? (
            <Badge>Your endpoint · {s.model}</Badge>
          ) : s.mode === "live" ? (
            <Badge variant="secondary">Managed model</Badge>
          ) : (
            <Badge variant="secondary">Demo mode</Badge>
          ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Enterprise privacy tier 2: point this project's AI calls at your own
        OpenAI-compatible endpoint (e.g. an Azure OpenAI deployment or internal
        gateway). Discovery content then never leaves your compliance boundary.
        The key is stored for this project only and never shown again.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-url">Base URL</Label>
          <Input
            id="llm-url"
            placeholder="https://your-gateway.example.com/v1"
            value={form.baseUrl}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-model">Model</Label>
          <Input
            id="llm-model"
            placeholder="gpt-4o / your-deployment"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-key">API key</Label>
          <Input
            id="llm-key"
            type="password"
            placeholder={byo ? "•••••• (enter a new key to replace)" : "sk-…"}
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate({
              id: projectId,
              endpoint: {
                baseUrl: form.baseUrl.trim(),
                model: form.model.trim(),
                apiKey: form.apiKey.trim(),
              },
            })
          }
        >
          {save.isPending ? "Saving…" : byo ? "Replace endpoint" : "Use my endpoint"}
        </Button>
        {byo && (
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({ id: projectId, endpoint: null })}
          >
            Remove & use managed model
          </Button>
        )}
      </div>
    </div>
  );
}

/** Danger zone: full cascade delete (§9.2) with type-to-confirm. */
function DangerZone({ project }: { project: ProjectData }) {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const del = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success(`"${project.name}" and all of its data were deleted`);
      navigate("/");
    },
    onError: (e) => toast.error(`Couldn't delete the project: ${e.message}`),
  });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-destructive">Danger zone</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3.5">
        <p className="text-sm text-muted-foreground">
          Deleting this project purges every session, transcript, report,
          deliverable, and purchase record attached to it. There is no undo.
        </p>
        <AlertDialog onOpenChange={() => setConfirmText("")}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This cascades to all stakeholder sessions, conversations,
                summaries, compiled reports, deliverables, and purchase records.
                Type the project name to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={project.name}
              aria-label="Type the project name to confirm deletion"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Keep project</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmText.trim() !== project.name || del.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => del.mutate({ id: project.id })}
              >
                {del.isPending ? "Deleting…" : "Delete everything"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function ProjectSettings({ project }: { project: ProjectData }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Project settings</CardTitle>
        <EditProjectDialog project={project} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ModelEndpointSection projectId={project.id} />
        <Separator />
        <DangerZone project={project} />
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

const STEPS = ["Basics", "Scope", "Logistics"] as const;

export default function NewProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    clientName: "",
    scopeText: "",
    constraintsText: "",
    budget: "",
    timeline: "",
    teamSize: "",
  });

  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => navigate(`/projects/${project.id}`),
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const canContinue =
    (step === 0 && form.name.trim().length > 0) ||
    (step === 1 && form.scopeText.trim().length > 0) ||
    step === 2;

  const submit = () =>
    create.mutate({
      name: form.name.trim(),
      clientName: form.clientName.trim() || undefined,
      scopeText: form.scopeText.trim(),
      constraintsText: form.constraintsText.trim() || undefined,
      budget: form.budget.trim() || undefined,
      timeline: form.timeline.trim() || undefined,
      teamSize: form.teamSize.trim() || undefined,
    });

  return (
    <AuthLayout>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New Project</h1>
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
        </div>

        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{STEPS[step]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {step === 0 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Project name *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Acme CRM Implementation"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="client">Client</Label>
                  <Input
                    id="client"
                    value={form.clientName}
                    onChange={set("clientName")}
                    placeholder="e.g. Acme Corp"
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scope">Project scope *</Label>
                  <Textarea
                    id="scope"
                    rows={6}
                    value={form.scopeText}
                    onChange={set("scopeText")}
                    placeholder="What is in scope for this implementation? Be precise — the Scope Guardian uses this text as the boundary for every stakeholder conversation."
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="constraints">Key constraints</Label>
                  <Textarea
                    id="constraints"
                    rows={4}
                    value={form.constraintsText}
                    onChange={set("constraintsText")}
                    placeholder="e.g. Must integrate with legacy ERP; no changes to finance processes this fiscal year…"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="budget">Budget</Label>
                  <Input
                    id="budget"
                    value={form.budget}
                    onChange={set("budget")}
                    placeholder="e.g. $250k"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timeline">Timeline</Label>
                  <Input
                    id="timeline"
                    value={form.timeline}
                    onChange={set("timeline")}
                    placeholder="e.g. Go-live Q4"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="teamSize">Team size</Label>
                  <Input
                    id="teamSize"
                    value={form.teamSize}
                    onChange={set("teamSize")}
                    placeholder="e.g. 12"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {create.error && (
          <p className="text-sm text-destructive">{create.error.message}</p>
        )}

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canContinue}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create Project"}
            </Button>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { InterviewerMark } from "@/components/illustrations/blueprint";
import { Monogram } from "@/components/ProjectVisuals";

const STYLE_LABELS: Record<string, string> = {
  detail_oriented: "Detail-Oriented",
  big_picture: "Big Picture",
  story_narrative: "Story / Narrative",
  problem_solving: "Problem-Solving",
};

const STAGE_TITLES: Record<string, string> = {
  assessment: "Stage 1 · Communication style",
  discovery: "Stage 2 · Discovery interview",
  review: "Stage 3 · Review notes",
};

/**
 * Lead-facing session drill-down (§10.2): the full record of one
 * stakeholder's journey — profile, phase summaries, Scope Guardian flags,
 * and the raw transcript.
 */
export function TranscriptSheet({
  stakeholderId,
  onClose,
}: {
  stakeholderId: number | null;
  onClose: () => void;
}) {
  const open = stakeholderId !== null;
  const q = trpc.stakeholders.transcript.useQuery(
    { stakeholderId: stakeholderId ?? 0 },
    { enabled: open },
  );
  const d = q.data;

  // Group messages by stage (assessment → discovery → review), keeping order.
  type Msg = NonNullable<typeof d>["messages"][number];
  const stages: { stage: string; messages: Msg[] }[] = [];
  if (d) {
    for (const m of d.messages) {
      const last = stages[stages.length - 1];
      if (last && last.stage === m.stage) last.messages.push(m);
      else stages.push({ stage: m.stage, messages: [m] });
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {q.isLoading && (
          <div className="flex flex-col gap-4 p-4 pt-10">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        )}
        {q.error && (
          <p className="p-6 text-sm text-destructive">{q.error.message}</p>
        )}
        {d && (
          <>
            <SheetHeader className="pb-0">
              <div className="flex items-center gap-3">
                <Monogram name={d.stakeholder.name} />
                <div>
                  <SheetTitle>{d.stakeholder.name}</SheetTitle>
                  <SheetDescription>
                    {d.stakeholder.roleTitle} · {d.stakeholder.email}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-5 p-4">
              {!d.session && (
                <p className="text-sm text-muted-foreground">
                  This stakeholder hasn't opened their invite yet — nothing to
                  read so far.
                </p>
              )}

              {d.assessment && (
                <div className="rounded-lg border p-3.5">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Communication profile
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{STYLE_LABELS[d.assessment.primaryStyle] ?? d.assessment.primaryStyle}</Badge>
                    {d.assessment.secondaryStyle && (
                      <Badge variant="secondary">
                        + {STYLE_LABELS[d.assessment.secondaryStyle] ?? d.assessment.secondaryStyle}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      via {d.assessment.method === "form" ? "quick form" : "conversation"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The Discovery agent used this profile to shape its questioning
                    style — the stakeholder never sees it.
                  </p>
                </div>
              )}

              {d.summaries.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Approved phase summaries
                  </p>
                  {d.summaries.map((s) => (
                    <div key={s.phase} className="rounded-lg border p-3.5">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="text-sm font-medium">Phase {s.phase}</p>
                        {s.approved ? (
                          <Badge variant="secondary">approved</Badge>
                        ) : (
                          <Badge variant="outline">pending</Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {s.summary}
                      </p>
                      {s.stakeholderFeedback && (
                        <p className="mt-2 border-l-2 border-gold pl-2 text-xs text-muted-foreground">
                          Correction requested: {s.stakeholderFeedback}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {d.flags.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Scope Guardian flags
                  </p>
                  {d.flags.map((f, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border border-l-[3px] p-3 text-sm ${
                        f.severity === "high"
                          ? "border-l-destructive"
                          : f.severity === "medium"
                            ? "border-l-gold"
                            : "border-l-border"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline">{f.type.replace(/_/g, " ")}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {f.severity}
                          {f.phase ? ` · phase ${f.phase}` : ""}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{f.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {stages.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Full transcript
                  </p>
                  {stages.map((grp, gi) => (
                    <div key={gi} className="flex flex-col gap-2">
                      <Separator />
                      <p className="text-xs font-medium text-muted-foreground">
                        {STAGE_TITLES[grp.stage] ?? grp.stage}
                      </p>
                      {grp.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`flex max-w-[92%] items-start gap-2 ${
                            m.role === "agent" ? "self-start" : "self-end flex-row-reverse"
                          }`}
                        >
                          {m.role === "agent" ? (
                            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-primary/10">
                              <InterviewerMark className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <Monogram
                              name={d.stakeholder.name}
                              className="mt-0.5 h-6 w-6 rounded-md text-[10px]"
                            />
                          )}
                          <div
                            className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                              m.role === "agent"
                                ? "bg-muted"
                                : "bg-primary/10 text-foreground"
                            }`}
                          >
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

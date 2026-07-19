import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useParams } from "react-router";
import { CheckCircle2, Flag, Send } from "lucide-react";

type StyleKey = "detail_oriented" | "big_picture" | "story_narrative" | "problem_solving";
type Msg = { id: number; stage: string; phase: number | null; role: string; content: string };

const PHASE_NAMES: Record<number, string> = {
  1: "Open Discovery",
  2: "Targeted Follow-ups",
  3: "Validation & Clarification",
  4: "Future State & Priorities",
};

const FORM_QUESTIONS: { q: string; options: { key: StyleKey; label: string }[] }[] = [
  {
    q: "When someone explains a new process to you, you prefer they start with…",
    options: [
      { key: "detail_oriented", label: "The exact steps, in order" },
      { key: "big_picture", label: "What it's ultimately meant to achieve" },
      { key: "story_narrative", label: "A real example of it in action" },
      { key: "problem_solving", label: "The problem it's meant to fix" },
    ],
  },
  {
    q: "In meetings, you're most engaged when…",
    options: [
      { key: "detail_oriented", label: "Reviewing concrete data and specifics" },
      { key: "big_picture", label: "Discussing vision and outcomes" },
      { key: "story_narrative", label: "People share real experiences from the field" },
      { key: "problem_solving", label: "Tackling a specific blocker" },
    ],
  },
  {
    q: "A colleague asks how your work is going. You naturally…",
    options: [
      { key: "detail_oriented", label: "List current tasks and their status" },
      { key: "big_picture", label: "Describe where it's all heading" },
      { key: "story_narrative", label: "Tell them about something that happened this week" },
      { key: "problem_solving", label: "Name what's stuck and what you're doing about it" },
    ],
  },
  {
    q: "The most useful documentation is…",
    options: [
      { key: "detail_oriented", label: "Detailed specs with exact figures" },
      { key: "big_picture", label: "A clear picture of the end state" },
      { key: "story_narrative", label: "Walkthroughs of real scenarios" },
      { key: "problem_solving", label: "Known issues and how to fix them" },
    ],
  },
  {
    q: "When a project stalls, your first instinct is to…",
    options: [
      { key: "detail_oriented", label: "Re-check the details of the plan" },
      { key: "big_picture", label: "Revisit the overall goal" },
      { key: "story_narrative", label: "Ask what happened last time" },
      { key: "problem_solving", label: "Find the single biggest blocker" },
    ],
  },
];

// ── Shared pieces ────────────────────────────────────────────────────────────

function StageHeader({ current, sub }: { current: 1 | 2 | 3; sub?: string }) {
  const stages = ["Communication Style", "Discovery Interview", "Review & Confirm"];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Stage {current} of 3: {stages[current - 1]}
          {sub ? <span className="text-muted-foreground"> · {sub}</span> : null}
        </p>
        <div className="flex gap-1.5">
          {stages.map((s, i) => (
            <Badge key={s} variant={i < current ? "default" : "secondary"}>
              {i + 1}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        {stages.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i < current ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Raw transport/timeout failures read terribly — map them to plain language. */
function friendlyChatError(message: string | null): string | null {
  if (!message) return null;
  if (/Unexpected token|DOCTYPE|not valid JSON|Failed to fetch|NetworkError/i.test(message)) {
    return "The response took too long and the connection was cut. Press send again to continue.";
  }
  return message;
}

function ChatPanel({
  messages,
  isPending,
  error,
  onSend,
  placeholder,
}: {
  messages: Msg[];
  isPending: boolean;
  error: string | null;
  onSend: (text: string, done: (ok: boolean) => void) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isPending]);

  const send = () => {
    const text = draft.trim();
    if (!text || isPending) return;
    setDraft("");
    onSend(text, (ok) => {
      if (!ok) setDraft(text); // keep the user's words when a send fails
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-h-[55vh] min-h-[240px] flex-col gap-3 overflow-y-auto rounded-lg border p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "agent"
                ? "self-start bg-muted"
                : "self-end bg-primary text-primary-foreground"
            }`}
          >
            {m.content}
          </div>
        ))}
        {isPending && (
          <div className="max-w-[85%] self-start rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            Typing…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder ?? "Type your answer…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button onClick={send} disabled={!draft.trim() || isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SummaryApprovalCard({
  token,
  phase,
  summary,
}: {
  token: string;
  phase: number;
  summary: string;
}) {
  const utils = trpc.useUtils();
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const approve = trpc.session.approvePhaseSummary.useMutation({
    onSuccess: () => {
      setFeedback("");
      setShowFeedback(false);
      utils.session.getState.invalidate({ token });
    },
  });

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">
          Phase {phase} summary — please review
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Before we move on, check this over. Approve it as-is, or tell me what
          to fix and I'll revise it once.
        </p>
        <div className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm leading-relaxed">
          {summary}
        </div>
        {showFeedback && (
          <Textarea
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should be corrected or added?"
          />
        )}
        {approve.error && <p className="text-sm text-destructive">{approve.error.message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => approve.mutate({ token })}
            disabled={approve.isPending}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approve & continue
          </Button>
          {!showFeedback ? (
            <Button variant="outline" onClick={() => setShowFeedback(true)}>
              Request changes
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => approve.mutate({ token, feedback })}
              disabled={!feedback.trim() || approve.isPending}
            >
              {approve.isPending ? "Revising…" : "Submit correction & approve"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Stage 1: assessment ──────────────────────────────────────────────────────

function AssessmentView({
  token,
  messages,
  onFormSwitch,
}: {
  token: string;
  messages: Msg[];
  onFormSwitch: () => void;
}) {
  const utils = trpc.useUtils();
  const reply = trpc.session.reply.useMutation();
  return (
    <div className="flex flex-col gap-4">
      <ChatPanel
        messages={messages}
        isPending={reply.isPending}
        error={friendlyChatError(reply.error?.message ?? null)}
        onSend={(text, done) =>
          reply.mutate(
            { token, message: text },
            {
              onSuccess: () => {
                done(true);
                utils.session.getState.invalidate({ token });
              },
              // Refetch even on failure: the answer may have been saved
              // server-side before the model timed out.
              onError: () => {
                done(false);
                utils.session.getState.invalidate({ token });
              },
            },
          )
        }
      />
      <button
        onClick={onFormSwitch}
        className="self-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Prefer a quick form instead?
      </button>
    </div>
  );
}

function FormView({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const [answers, setAnswers] = useState<(StyleKey | null)[]>([null, null, null, null, null]);
  const submit = trpc.session.submitForm.useMutation({
    onSuccess: () => utils.session.getState.invalidate({ token }),
  });
  const complete = answers.every(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Five quick questions — pick the option that sounds most like you.
      </p>
      {FORM_QUESTIONS.map((fq, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <p className="text-sm font-medium">
            {i + 1}. {fq.q}
          </p>
          <RadioGroup
            value={answers[i] ?? ""}
            onValueChange={(v) =>
              setAnswers((a) => a.map((x, j) => (j === i ? (v as StyleKey) : x)))
            }
          >
            {fq.options.map((o) => (
              <div key={o.key} className="flex items-center gap-2">
                <RadioGroupItem value={o.key} id={`q${i}-${o.key}`} />
                <Label htmlFor={`q${i}-${o.key}`} className="text-sm font-normal">
                  {o.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      ))}
      {submit.error && <p className="text-sm text-destructive">{submit.error.message}</p>}
      <Button
        disabled={!complete || submit.isPending}
        onClick={() => submit.mutate({ token, answers: answers as StyleKey[] })}
      >
        {submit.isPending ? "Submitting…" : "Submit"}
      </Button>
    </div>
  );
}

// ── Stage 2: discovery ───────────────────────────────────────────────────────

function DiscoveryView({
  token,
  messages,
  currentPhase,
  pendingSummary,
}: {
  token: string;
  messages: Msg[];
  currentPhase: number | null;
  pendingSummary: { id: number; phase: number; summary: string } | null;
}) {
  const utils = trpc.useUtils();
  const reply = trpc.session.discoveryReply.useMutation();
  const phase = currentPhase ?? 1;
  const phaseMessages = messages.filter((m) => m.stage === "discovery");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          Phase {phase} of 4: {PHASE_NAMES[phase]}
        </span>
        <span className="text-xs text-muted-foreground">
          Your progress is saved — come back anytime
        </span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((p) => (
          <div
            key={p}
            className={`h-1 flex-1 rounded-full ${p <= phase ? "bg-primary/70" : "bg-muted"}`}
          />
        ))}
      </div>

      {pendingSummary ? (
        <SummaryApprovalCard
          token={token}
          phase={pendingSummary.phase}
          summary={pendingSummary.summary}
        />
      ) : (
        <ChatPanel
          messages={phaseMessages}
          isPending={reply.isPending}
          error={friendlyChatError(reply.error?.message ?? null)}
          onSend={(text, done) =>
            reply.mutate(
              { token, message: text },
              {
                onSuccess: () => {
                  done(true);
                  utils.session.getState.invalidate({ token });
                },
                // Refetch even on failure: the answer may have been saved
                // server-side before the model timed out.
                onError: () => {
                  done(false);
                  utils.session.getState.invalidate({ token });
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

// ── Stage 3: review & confirm ────────────────────────────────────────────────

function ReviewView({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const review = trpc.session.getReview.useMutation();
  const [note, setNote] = useState("");
  const flag = trpc.session.flagReviewItem.useMutation({
    onSuccess: () => {
      setNote("");
      review.mutate({ token });
    },
  });
  const submit = trpc.session.submitFinal.useMutation({
    onSuccess: () => utils.session.getState.invalidate({ token }),
  });

  useEffect(() => {
    review.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!review.data) {
    return <p className="text-sm text-muted-foreground">Preparing your review…</p>;
  }

  const r = review.data;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Here's everything captured from your session. If anything's wrong or
        missing, flag it below — then hit submit.
      </p>

      {r.summaries.map((s) => (
        <Card key={s.phase}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Phase {s.phase}: {PHASE_NAMES[s.phase]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.summary}</p>
          </CardContent>
        </Card>
      ))}

      {r.flags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Noted for the project team</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {r.flags.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Flag className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{f.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {r.corrections.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your corrections</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {r.corrections.map((c, i) => (
              <p key={i} className="text-sm text-muted-foreground">• {c}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="flex flex-col gap-2">
        <Label htmlFor="correction" className="text-sm font-medium">
          Something wrong or missing?
        </Label>
        <div className="flex items-start gap-2">
          <Textarea
            id="correction"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell us what to fix…"
          />
          <Button
            variant="outline"
            disabled={!note.trim() || flag.isPending}
            onClick={() => flag.mutate({ token, note })}
          >
            Add
          </Button>
        </div>
      </div>

      {submit.error && <p className="text-sm text-destructive">{submit.error.message}</p>}
      <Button size="lg" onClick={() => submit.mutate({ token })} disabled={submit.isPending}>
        {submit.isPending ? "Submitting…" : "Submit my session"}
      </Button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StakeholderSession() {
  const { token } = useParams<{ token: string }>();
  const utils = trpc.useUtils();
  const state = trpc.session.getState.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false },
  );
  const start = trpc.session.start.useMutation({
    onSuccess: () => utils.session.getState.invalidate({ token: token ?? "" }),
  });
  const startDiscovery = trpc.session.startDiscovery.useMutation({
    onSuccess: () => utils.session.getState.invalidate({ token: token ?? "" }),
  });
  const [showForm, setShowForm] = useState(false);

  if (state.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading your session…</p>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>This link isn't active</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {state.error?.message === "This invite has expired"
              ? "This invite link has expired. Ask your project lead to send you a fresh one."
              : "We couldn't find a session for this link. Check the URL, or ask your project lead to resend your invite."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = state.data;
  const firstName = d.stakeholder.name.split(" ")[0];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.projectName}</h1>
        <p className="text-sm text-muted-foreground">
          {d.clientName ? `${d.clientName} · ` : ""}Invited by {d.inviterName}
        </p>
      </div>

      {d.state === "INVITED" && !showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Welcome, {firstName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              This is a structured discovery session — a conversation with an AI
              interviewer about how you work and what you need from this project.
              It takes about 60–90 minutes total, broken into stages you can
              complete at your own pace. Your progress is saved automatically.
            </p>
            <StageHeader current={1} />
            {start.error && <p className="text-sm text-destructive">{start.error.message}</p>}
            <div className="flex items-center gap-3">
              <Button
                onClick={() => start.mutate({ token: token ?? "" })}
                disabled={start.isPending}
              >
                {start.isPending ? "Starting…" : "Begin"}
              </Button>
              <button
                onClick={() =>
                  start.mutate({ token: token ?? "" }, { onSuccess: () => setShowForm(true) })
                }
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Prefer a quick form instead?
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {d.state === "INVITED" && showForm && (
        <>
          <StageHeader current={1} />
          <Card>
            <CardContent className="p-6">
              <FormView token={token ?? ""} />
            </CardContent>
          </Card>
        </>
      )}

      {d.state === "ASSESSMENT_IN_PROGRESS" && !showForm && (
        <>
          <StageHeader current={1} />
          <AssessmentView
            token={token ?? ""}
            messages={d.messages.filter((m) => m.stage === "assessment")}
            onFormSwitch={() => setShowForm(true)}
          />
        </>
      )}

      {d.state === "ASSESSMENT_IN_PROGRESS" && showForm && (
        <>
          <StageHeader current={1} />
          <Card>
            <CardContent className="p-6">
              <FormView token={token ?? ""} />
            </CardContent>
          </Card>
        </>
      )}

      {d.state === "ASSESSMENT_COMPLETE" && (
        <>
          <StageHeader current={2} />
          <Card>
            <CardContent className="flex flex-col items-start gap-4 p-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <p className="font-medium">Stage 1 complete</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Thanks, {firstName} — that's the warm-up done. Next is the
                discovery interview itself: four phases, about 45–75 minutes, at
                your own pace. Take a break anytime; your progress is saved.
              </p>
              {startDiscovery.error && (
                <p className="text-sm text-destructive">{startDiscovery.error.message}</p>
              )}
              <Button
                onClick={() => startDiscovery.mutate({ token: token ?? "" })}
                disabled={startDiscovery.isPending}
              >
                {startDiscovery.isPending ? "Preparing…" : "Continue to Discovery"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {d.state === "DISCOVERY_IN_PROGRESS" && (
        <>
          <StageHeader
            current={2}
            sub={d.currentPhase ? `Phase ${d.currentPhase} of 4` : undefined}
          />
          <DiscoveryView
            token={token ?? ""}
            messages={d.messages}
            currentPhase={d.currentPhase}
            pendingSummary={d.pendingSummary}
          />
        </>
      )}

      {(d.state === "DISCOVERY_COMPLETE" || d.state === "REVIEW_IN_PROGRESS") && (
        <>
          <StageHeader current={3} />
          {d.state === "DISCOVERY_COMPLETE" ? (
            <Card>
              <CardContent className="flex flex-col items-start gap-4 p-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <p className="font-medium">Interview complete</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  All four phases are done, {firstName}. One last step: review
                  everything that was captured and confirm it's right.
                </p>
                <ReviewLauncher token={token ?? ""} />
              </CardContent>
            </Card>
          ) : (
            <ReviewView token={token ?? ""} />
          )}
        </>
      )}

      {d.state === "COMPLETED" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <p className="text-lg font-medium">Thank you, {firstName}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Your session is submitted. The project team will combine your input
              with everyone else's to shape the design and plan. You can close
              this page — and thank you for your time.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReviewLauncher({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const open = trpc.session.getReview.useMutation({
    onSuccess: () => utils.session.getState.invalidate({ token }),
  });
  return (
    <Button onClick={() => open.mutate({ token })} disabled={open.isPending}>
      {open.isPending ? "Preparing…" : "Review your session"}
    </Button>
  );
}

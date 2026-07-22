/**
 * Wave 2 shared visual primitives: monograms, completion rings, labeled
 * stage steppers, stat tiles, and the readiness gauge.
 * All colors are existing tokens; status colors are reserved for status.
 */

const STAGES = ["SETUP", "DISCOVERY_OPEN", "COMPILATION_READY", "DELIVERABLES"] as const;
const STAGE_SHORT: Record<(typeof STAGES)[number], string> = {
  SETUP: "Setup",
  DISCOVERY_OPEN: "Discovery",
  COMPILATION_READY: "Compile",
  DELIVERABLES: "Deliver",
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Initials chip — client/stakeholder identity at a glance. */
export function Monogram({
  name,
  className = "h-10 w-10 rounded-[10px] text-[15px]",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex flex-none items-center justify-center border border-primary/20 bg-primary/10 font-bold text-primary ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Radial stakeholder-completion ring (single-hue progress, not a pie). */
export function CompletionRing({
  completed,
  total,
  size = 74,
}: {
  completed: number;
  total: number;
  size?: number;
}) {
  const r = 31;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, completed / total) : 0;
  return (
    <div
      className="relative flex-none"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${completed} of ${total} stakeholders complete`}
    >
      <svg viewBox="0 0 74 74" width={size} height={size} className="-rotate-90">
        <circle cx="37" cy="37" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="37"
          cy="37"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${frac * c} ${c}`}
          className="stroke-primary transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <b className="font-display text-[17px] font-semibold">
          {completed}/{total}
        </b>
        <i className="mt-0.5 text-[9.5px] not-italic text-muted-foreground">complete</i>
      </div>
    </div>
  );
}

/** Labeled stage stepper — replaces the four anonymous bars. */
export function StageStepper({ stage }: { stage: string }) {
  const activeIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex gap-1.5">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={`h-[5px] flex-1 rounded-full ${
              i < activeIdx
                ? "bg-primary"
                : i === activeIdx
                  ? "bg-gradient-to-r from-primary from-55% to-muted to-55%"
                  : "bg-muted"
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between gap-1 text-[9.5px] leading-none tracking-tight text-muted-foreground">
        {STAGES.map((s, i) => (
          <span key={s} className={i === activeIdx ? "font-semibold text-primary" : ""}>
            {STAGE_SHORT[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Portfolio stat tile — hero number + caption. */
export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5 shadow-xs">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-display text-3xl leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Readiness gauge — semicircle with the deliverable-gating zones made
 * visible: <40 blocked (critical), <70 thin data (warning), ≥70 ready (good).
 * Status colors reserved for status; labels accompany every zone.
 */
export function ReadinessGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const angle = -90 + (clamped / 100) * 180;
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Readiness ${clamped} of 100`}>
      <svg viewBox="0 0 200 120" width="210" height="126">
        {/* zones: 0–40 / 40–70 / 70–100 on the semicircle */}
        <path
          d="M20 110 A80 80 0 0 1 49.4 48.2"
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          className="stroke-destructive"
          opacity=".8"
        />
        <path
          d="M55.5 42.5 A80 80 0 0 1 133.5 22.1"
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          className="stroke-gold"
          opacity=".9"
        />
        <path
          d="M141 25.8 A80 80 0 0 1 180 110"
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          stroke="hsl(150 55% 38%)"
          opacity=".85"
        />
        <g transform={`rotate(${angle} 100 110)`}>
          <line
            x1="100"
            y1="110"
            x2="100"
            y2="46"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-foreground"
          />
        </g>
        <circle cx="100" cy="110" r="6" className="fill-foreground" />
      </svg>
      <p className="mt-1 font-display text-4xl leading-none">{clamped}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        of 100 · {clamped < 40 ? "generation blocked" : clamped < 70 ? "thin data" : "generation unlocked"}
      </p>
      <div className="mt-3 flex gap-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-[2px] bg-destructive" /> &lt;40 blocked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-[2px] bg-gold" /> &lt;70 thin
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-[2px]" style={{ background: "hsl(150 55% 38%)" }} /> ready
        </span>
      </div>
    </div>
  );
}

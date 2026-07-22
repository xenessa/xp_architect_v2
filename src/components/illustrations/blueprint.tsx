/**
 * XP Architect illustration system — architectural blueprint line-art.
 *
 * Grammar (Wave 2 visual direction, approved July 2026):
 *   · 1.6px indigo strokes (`hsl(var(--primary))` via CSS class)
 *   · dashed lines = construction / not-yet-built
 *   · exactly one gold accent per piece (`hsl(var(--gold))`)
 *   · theme-aware for free: strokes are tokens, no raster assets
 *
 * Every component accepts a `className` for sizing; strokes inherit from
 * the `.bp-ink` / `.bp-gold` utility classes defined alongside (index.css).
 */

type P = { className?: string; title?: string };

const ink = "bp-ink";
const gold = "bp-gold";

function Svg({
  viewBox,
  className,
  title,
  children,
}: P & { viewBox: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/* ── Empty states ──────────────────────────────────────────────────────── */

/** Drafting table with rolled plans — "no projects yet". */
export function EmptyPortfolio({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <path d="M30 88 L120 88" />
        <path d="M40 88 L40 46 L110 46 L110 88" />
        <path d="M36 46 L114 46" strokeWidth="2" />
        <path d="M52 46 L52 30 a8 8 0 0 1 16 0 L68 46" />
        <path d="M80 38 h22" strokeDasharray="3 4" opacity=".6" />
        <path d="M80 32 h16" strokeDasharray="3 4" opacity=".6" />
        <path d="M46 62 h58" strokeDasharray="2 5" opacity=".5" />
        <path d="M46 72 h58" strokeDasharray="2 5" opacity=".5" />
      </g>
      <circle className={gold} cx="60" cy="24" r="2.6" strokeWidth="1.6" />
    </Svg>
  );
}

/** Empty chairs around a table — "no stakeholders yet". */
export function EmptyRoster({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <ellipse cx="75" cy="62" rx="34" ry="12" />
        <path d="M41 62 v14 M109 62 v14 M75 74 v14" />
        {/* chairs, dashed = unfilled seats */}
        <path d="M30 44 h12 v10" strokeDasharray="3 4" opacity=".7" />
        <path d="M108 44 h12 v10" strokeDasharray="3 4" opacity=".7" />
        <path d="M69 30 h12 v8" strokeDasharray="3 4" opacity=".7" />
      </g>
      <circle className={gold} cx="75" cy="18" r="3" strokeWidth="1.6" />
    </Svg>
  );
}

/** Calm skyline, gold sun — "no alerts". */
export function AllClear({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <path d="M14 90 H136" />
        <path d="M24 90 V58 H48 V90" />
        <path d="M24 58 L36 46 L48 58" />
        <path d="M58 90 V42 H86 V90" />
        <path d="M58 42 L72 30 L86 42" />
        <path d="M96 90 V62 H124 V90" />
        <path d="M96 62 L110 50 L124 62" />
      </g>
      <g className={gold} strokeWidth="1.6">
        <circle cx="72" cy="16" r="5" />
        <path d="M72 7 v-3 M81 16 h3 M63 16 h-3" opacity=".8" />
      </g>
    </Svg>
  );
}

/** Scattered pages converging into one — "awaiting compilation". */
export function AwaitingCompilation({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <path d="M24 30 h24 v32 h-24 z" opacity=".55" transform="rotate(-8 36 46)" />
        <path d="M102 26 h24 v32 h-24 z" opacity=".55" transform="rotate(9 114 42)" />
        <path d="M63 64 h24 v34 h-24 z" strokeWidth="1.8" />
        <path d="M68 72 h14 M68 79 h14 M68 86 h9" strokeDasharray="2 3" opacity=".6" />
        <path d="M44 56 C52 62 56 66 62 72" strokeDasharray="3 4" opacity=".7" />
        <path d="M106 52 C98 60 94 64 89 70" strokeDasharray="3 4" opacity=".7" />
        <path d="M30 36 h12 M30 42 h8" strokeDasharray="2 3" opacity=".5" transform="rotate(-8 36 46)" />
        <path d="M108 32 h12 M108 38 h8" strokeDasharray="2 3" opacity=".5" transform="rotate(9 114 42)" />
      </g>
      <circle className={gold} cx="75" cy="58" r="3" strokeWidth="1.6" />
    </Svg>
  );
}

/** Rolled blueprint with gold seal — locked / approved deliverable. */
export function SealedDeliverable({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <path d="M46 26 h48 a10 10 0 0 1 0 20 v0" opacity="0" />
        <path d="M44 30 a8 8 0 0 1 8 -8 h44 a8 8 0 0 1 8 8 v50 a8 8 0 0 1 -8 8 h-44 a8 8 0 0 1 -8 -8 z" />
        <path d="M44 30 a8 8 0 0 0 8 8 h44 a8 8 0 0 0 8 -8" opacity=".6" />
        <path d="M54 50 h32" strokeDasharray="2 4" opacity=".55" />
        <path d="M54 58 h32" strokeDasharray="2 4" opacity=".55" />
        <path d="M54 66 h20" strokeDasharray="2 4" opacity=".55" />
      </g>
      <g className={gold} strokeWidth="1.8">
        <circle cx="96" cy="72" r="11" />
        <path d="M92 72 l3 3 l6 -6" />
      </g>
    </Svg>
  );
}

/* ── Stage icons: Listen · Design · Deliver ────────────────────────────── */

export function ListenIcon({ className, title }: P) {
  return (
    <Svg viewBox="0 0 40 40" className={className} title={title}>
      <g className={ink} strokeWidth="1.8">
        <path d="M13 26 a10 10 0 1 1 14 -9" />
        <path d="M27 17 v6 a4 4 0 0 1 -4 4 h-3" />
      </g>
      <circle className={gold} cx="18" cy="27" r="2.4" strokeWidth="1.8" />
    </Svg>
  );
}

export function DesignIcon({ className, title }: P) {
  return (
    <Svg viewBox="0 0 40 40" className={className} title={title}>
      <g className={ink} strokeWidth="1.8">
        <circle cx="20" cy="20" r="12" />
        <path d="M20 20 L27 13" />
        <path d="M20 20 L16 26" />
      </g>
      <circle className={gold} cx="20" cy="20" r="2.2" strokeWidth="1.8" />
    </Svg>
  );
}

export function DeliverIcon({ className, title }: P) {
  return (
    <Svg viewBox="0 0 40 40" className={className} title={title}>
      <g className={ink} strokeWidth="1.8">
        <path d="M10 28 h20" />
        <path d="M13 28 v-8 h14 v8" />
        <path d="M16 20 v-5 h8 v5" />
      </g>
      <circle className={gold} cx="20" cy="12" r="2" strokeWidth="1.8" />
    </Svg>
  );
}

/* ── Phase vignettes: a building rising, one per discovery phase ───────── */
/** Phase 1–4 complete. Solid = built, dashed = still to come. */
export function PhaseVignette({ phase, className, title }: P & { phase: 1 | 2 | 3 | 4 }) {
  const built = "1.6";
  const planned = { strokeDasharray: "3 4", opacity: 0.45 } as const;
  return (
    <Svg viewBox="0 0 120 96" className={className} title={title}>
      <g className={ink} strokeWidth={built}>
        {/* ground — always there */}
        <path d="M8 88 H112" />
        {/* phase 1: foundation + plot lines */}
        <path d="M22 88 V78 H74 V88" {...(phase >= 1 ? {} : planned)} />
        <path d="M28 88 v-6 M40 88 v-6 M52 88 v-6 M64 88 v-6" opacity=".5" />
        {/* phase 2: frame */}
        <path d="M22 78 V54 H74 V78" {...(phase >= 2 ? {} : planned)} />
        <path d="M22 54 L48 34 L74 54" {...(phase >= 2 ? {} : planned)} />
        <path d="M48 34 V78" strokeDasharray="3 4" opacity=".5" />
        {/* phase 3: walls, windows, door */}
        <path d="M30 88 V70 H42 V88" {...(phase >= 3 ? {} : planned)} />
        <path d="M54 70 h12 v10 h-12 z" {...(phase >= 3 ? {} : planned)} />
        {/* phase 4: the annex complete */}
        <path d="M84 88 V40 H104 V88" {...(phase >= 4 ? {} : planned)} />
        <path d="M84 40 L94 30 L104 40" {...(phase >= 4 ? {} : planned)} />
        <path d="M89 88 v-10 h10 v10" {...(phase >= 4 ? {} : planned)} />
      </g>
      <circle
        className={gold}
        strokeWidth="1.6"
        cx={phase >= 4 ? 94 : 48}
        cy={phase >= 4 ? 30 : 34}
        r="3.2"
      />
    </Svg>
  );
}

/** Finished building, gold sunrise — session complete. */
export function SessionComplete({ className, title }: P) {
  return (
    <Svg viewBox="0 0 150 110" className={className} title={title}>
      <g className={ink} strokeWidth="1.6">
        <path d="M14 92 H136" />
        <path d="M34 92 V60 H86 V92" />
        <path d="M34 60 L60 40 L86 60" />
        <path d="M44 92 V76 H56 V92" />
        <path d="M66 74 h12 v10 h-12 z" />
        <path d="M96 92 V50 H118 V92" />
        <path d="M96 50 L107 40 L118 50" />
        <path d="M101 92 v-10 h11 v10" />
        <path d="M101 62 h11 M101 70 h11" opacity=".6" />
      </g>
      <g className={gold} strokeWidth="1.6">
        <path d="M20 30 a14 14 0 0 1 28 0" />
        <path d="M34 12 v-4 M20 16 l-3 -3 M48 16 l3 -3" opacity=".8" />
      </g>
    </Svg>
  );
}

/* ── Interviewer mark — the AI's avatar in chat ────────────────────────── */
/** Abstract A-frame monogram — a mark, deliberately not a robot face. */
export function InterviewerMark({ className, title }: P) {
  return (
    <Svg viewBox="0 0 20 20" className={className} title={title}>
      <g className={ink} strokeWidth="1.7">
        <path d="M4 16 L10 4 L16 16" />
        <path d="M6.5 11.5 h7" />
      </g>
    </Svg>
  );
}

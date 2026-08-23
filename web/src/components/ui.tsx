/* Shared primitives. These exist so the three surfaces (buyer, LP, admin)
   cannot drift apart visually: every card, stat, field and button in the
   product comes from here, and the radius / contrast decisions live in one
   place instead of being retyped as ad-hoc utility strings per page. */
import type { ReactNode } from "react";

/* `children` is optional so the same Card can be used as a sized skeleton
   while the on-chain reads are still in flight. */
export function Card({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-card border border-surface-700 bg-surface-850 shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-content-100 sm:text-3xl">{title}</h1>
      {sub && <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-content-300">{sub}</p>}
    </div>
  );
}

/* Numbers are mono + tabular everywhere: a premium that reflows its own width
   while the on-chain quote refetches is the single jumpiest thing in the UI. */
export function Stat({
  label,
  value,
  unit,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "accent" | "positive";
  loading?: boolean;
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent-300"
      : tone === "positive"
        ? "text-signal-positive"
        : "text-content-100";
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-content-600">{label}</div>
      {loading ? (
        <div className="mt-1.5 h-6 w-20 animate-pulse rounded bg-surface-700" />
      ) : (
        <div className={`mt-1 truncate font-mono text-xl tnum ${toneClass}`}>
          {value}
          {unit && <span className="ml-1 font-sans text-xs text-content-600">{unit}</span>}
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-content-300">{label}</span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-content-600">{hint}</span>}
    </label>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
};

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: ButtonProps) {
  /* Contrast: primary is surface-950 text on accent-400 (dark on light), which
     clears WCAG AA at body size. Secondary is content-100 on surface-800 with a
     visible border, so it never disappears into the card behind it. */
  const base =
    "rounded-control px-5 py-2.5 text-sm font-medium transition-[transform,background-color] [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-ui)] active:translate-y-[1px] disabled:pointer-events-none disabled:opacity-40";
  const variants = {
    // On a dark page a hover lightens; the light theme did the opposite.
    primary: "bg-accent-400 text-surface-950 hover:bg-accent-300",
    secondary: "border border-surface-600 bg-surface-850 text-content-100 hover:bg-surface-800",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Callout({ tone, children }: { tone: "danger" | "positive" | "muted"; children: ReactNode }) {
  const tones = {
    danger: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
    positive: "border-signal-positive/40 bg-signal-positive/10 text-signal-positive",
    muted: "border-surface-700 bg-surface-800 text-content-300",
  };
  return (
    <div className={`rounded-control border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}

/* Period chips are the one documented exception to the radius system: they
   are pills, everything else is 14px (cards) or 10px (controls). */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
        active
          ? "bg-accent-400 text-surface-950 shadow-[var(--shadow-card)]"
          : "border border-surface-600 bg-surface-850 text-content-300 hover:bg-surface-800 hover:text-content-100"
      }`}
    >
      {children}
    </button>
  );
}

/* The mark is the product's own payoff shape: flat while inflation is below
   your strike, rising once it clears, capped at the top. Deliberately the
   same geometry the PayoffChart draws, so the logo and the main chart read as
   the same object at two sizes. */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M2.5 17.5h6l5-11h8"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="17.5" r="1.9" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="h-5 w-5 text-accent-400" />
      <span className="text-[17px] font-semibold tracking-tight text-paper-100">Hedgy</span>
    </span>
  );
}

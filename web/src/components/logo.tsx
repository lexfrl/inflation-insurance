/* The brand mark, exported from the Figma node "logo hedgy black V1" (1:7).
 * The four faces are the real vector paths, not a redraw, and they carry
 * `currentColor` so the mark can sit on the black tile it was designed on or
 * be tinted where a tile would be too heavy. The exact source export is also
 * committed at public/logo-hedgy-black.svg. */

/** The glyph alone, cropped to its own bounds so it can be sized like an icon. */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="345 255.5 329.5 485.5"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <path d="M465 255.5L345 331V507.5L467 429L465 255.5Z" />
        <path d="M420.5 500.5L347 549.5V693.5L548.5 559.5L420.5 500.5Z" />
        <path d="M673 485L548.5 559.5V741L673 661.5V485Z" />
        <path d="M674.5 294.5L467 429L599 495L674.5 444V294.5Z" />
      </g>
    </svg>
  );
}

/** The mark as designed: white glyph on its black tile. */
export function LogoTile({ className = "size-7" }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[8px] bg-black ring-1 ring-inset ring-white/10 ${className}`}
    >
      <LogoMark className="h-[62%] w-auto text-white" />
    </span>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoTile />
      <span className="text-[17px] font-semibold tracking-tight text-ink">Hedgy</span>
    </span>
  );
}

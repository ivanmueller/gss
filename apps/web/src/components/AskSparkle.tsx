import type { CSSProperties } from 'react';

/**
 * The Ask the map mark (the owner, 2026-11-24, F-308): a large and a small four-pointed star,
 * filled with the current colour. Drawn here rather than taken from the icon set, whose sparkle
 * has outlines and extra marks.
 */
export function AskSparkle({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.75}
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d="M9.5 6Q10.52 13.48 18 14.5Q10.52 15.52 9.5 23Q8.48 15.52 1 14.5Q8.48 13.48 9.5 6Z" />
      <path d="M18 1.5Q18.54 5.46 22.5 6Q18.54 6.54 18 10.5Q17.46 6.54 13.5 6Q17.46 5.46 18 1.5Z" />
    </svg>
  );
}

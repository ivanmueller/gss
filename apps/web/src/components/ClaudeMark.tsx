import { cn } from '../lib/utils';

/**
 * The mark shown wherever Claude drafted something (F-116): a simple radiating mark in Claude's
 * warm colour, drawn for GSS. It is not Anthropic's logo, which is their trademark. Always
 * beside the words "Drafted by Claude" (or with `label`), never alone.
 */
export function ClaudeMark({ className, label }: { className?: string; label?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * Math.PI) / 6;
    const outer = i % 2 === 0 ? 10 : 7.4;
    return (
      <line
        key={i}
        x1={12 + 2.6 * Math.cos(angle)}
        y1={12 + 2.6 * Math.sin(angle)}
        x2={12 + outer * Math.cos(angle)}
        y2={12 + outer * Math.sin(angle)}
      />
    );
  });
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      className={cn('size-4 shrink-0 text-claude-mark', className)}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {rays}
    </svg>
  );
}

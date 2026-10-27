import { Lock } from 'lucide-react';

/** Marks pages that show the organization's real records, unlike the synthetic workspace. */
export function RealDataNote({ organization }: { organization: string }) {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground"
    >
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong className="text-foreground">Your organization’s records.</strong> Only members of{' '}
        {organization} can see them. Nothing here is a price or a quote.
      </span>
    </p>
  );
}

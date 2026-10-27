import { Lock } from 'lucide-react';

import { Callout } from './ui/callout';

/** Marks pages that show the organization's real records, unlike the synthetic workspace. */
export function RealDataNote({ organization }: { organization: string }) {
  return (
    <Callout icon={Lock}>
      <p>
        <strong>Your organization’s records.</strong> Only members of {organization} can see them.
        Nothing here is a price or a quote.
      </p>
    </Callout>
  );
}

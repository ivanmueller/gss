import { FlaskConical } from 'lucide-react';

import { Callout } from './ui/callout';

export function SyntheticBanner() {
  return (
    <Callout variant="caution" icon={FlaskConical}>
      <p>
        <strong>Synthetic demo data.</strong> Every facility and quote on this page is fictional.
        Nothing here is a live price or an executable trade.
      </p>
    </Callout>
  );
}

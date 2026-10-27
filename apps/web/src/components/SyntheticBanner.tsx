import { FlaskConical } from 'lucide-react';

export function SyntheticBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Synthetic demo data.</strong> Every facility and quote on this page is fictional.
        Nothing here is a live price or an executable trade.
      </p>
    </div>
  );
}

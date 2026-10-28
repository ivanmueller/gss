import { parseNewCounterparty, type FieldIssue } from '@grain/domain';
import { useId, useState, type SyntheticEvent, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import {
  CompanyFields,
  ContactFields,
  FormIssues,
  LocationFields,
  type FormValues,
} from '../components/DirectoryFields';
import { PageHeader } from '../components/PageHeader';
import { RealDataNote } from '../components/RealDataNote';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ApiError, fieldIssues, sendJson } from '../lib/api';
import { canEditDirectory } from '../lib/directory';
import { Link, navigate } from '../lib/router';
import type { DirectorySession } from './CounterpartiesPage';

/** A part of the form in a card, with a heading and an optional note. */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card asChild>
      <section aria-labelledby={id}>
        <CardHeader>
          <CardTitle id={id}>{title}</CardTitle>
          {note && <CardDescription>{note}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </section>
    </Card>
  );
}

/** /counterparties/new: one buyer or seller entered by hand, with the import's fields. */
export function NewCounterpartyPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [values, setValues] = useState<FormValues>({ verificationStatus: 'unverified' });
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEditDirectory(organization.role)) {
    return (
      <p role="alert" className="text-sm">
        Only operations and admin members of {organization.name} can add counterparties.
      </p>
    );
  }

  const fields = {
    values,
    issues,
    disabled: busy,
    onChange: (changes: FormValues) => {
      setValues((current) => ({
        ...current,
        ...changes,
        // A location's country follows the company's until it is chosen separately.
        ...(changes.country !== undefined &&
          (current.facilityCountry ?? '') === (current.country ?? '') && {
            facilityCountry: changes.country,
          }),
      }));
    },
  };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    // The same rules the API applies, so most problems show without a round trip.
    const checked = parseNewCounterparty(values);
    if (checked.status !== 'ok') {
      setIssues(
        checked.status === 'empty'
          ? [{ field: 'legalName', message: 'is required' }]
          : checked.issues,
      );
      return;
    }
    setIssues([]);
    setBusy(true);
    try {
      const created = await sendJson<{ id: string }>('/counterparties', token, 'POST', {
        organizationId: organization.id,
        values,
      });
      navigate(`/counterparties/${created.id}`);
    } catch (failure) {
      setIssues(fieldIssues(failure));
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-counterparty-heading" className="flex flex-col gap-4">
      <PageHeader
        id="new-counterparty-heading"
        back={<BackLink href="/counterparties">All counterparties</BackLink>}
        title="Add a counterparty"
        description={`A buyer or seller of ${organization.name}, entered by hand with the same details as a spreadsheet import. You can add more contacts and locations afterwards.`}
      />
      <RealDataNote organization={organization.name} />

      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Section title="Company">
          <CompanyFields {...fields} />
        </Section>
        <Section title="Contact" note="Optional. Leave empty to add contacts later.">
          <ContactFields {...fields} />
        </Section>
        <Section
          title="Location"
          note="Optional. The location's country follows the company's unless you choose another."
        >
          <LocationFields {...fields} />
        </Section>
        <FormIssues issues={issues} />
        {issues.length > 0 && (
          <p role="status" className="text-sm text-danger">
            Some fields need fixing; see the messages above.
          </p>
        )}
        {error && issues.length === 0 && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add counterparty'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/counterparties">Cancel</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

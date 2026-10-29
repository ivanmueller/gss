import {
  formatAlberta,
  FREIGHT_MODE_LABELS,
  freightTermsToFormValues,
  QUOTE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  utcToAlberta,
  type FreightDetail,
  type FreightLocation,
  type FreightRevision,
} from '@grain/domain';
import { Archive, ArrowRight, Ban, Pencil, TimerOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import { FreightForm } from '../components/FreightForm';
import { FreightModeBadge } from '../components/FreightList';
import { PageHeader } from '../components/PageHeader';
import { QuoteStatusBadge } from '../components/QuoteStatusBadge';
import { Button } from '../components/ui/button';
import { Callout } from '../components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '../components/ui/table';
import { ApiError, sendJson } from '../lib/api';
import { canEnterFreight, freightPayload, freightPlace, freightRate } from '../lib/freight';
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const nameLink = 'font-medium text-foreground underline-offset-4 hover:underline';

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Terms({ revision }: { revision: FreightRevision }) {
  const payload = freightPayload(revision);
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Term label="Rate">
        <span className="font-price text-base font-semibold tabular-nums">
          {freightRate(revision)}
        </span>
      </Term>
      {payload && <Term label="Payload">{payload}</Term>}
      <Term label="Firm or indicative">{QUOTE_STATUS_LABELS[revision.firmness]}</Term>
      <Term label="What the rate includes">{revision.inclusions ?? 'Not stated'}</Term>
      <Term label="Quoted at">{formatAlberta(revision.quotedAt)}</Term>
      <Term label="Valid until">{formatAlberta(revision.validUntil)}</Term>
      <Term label="Source">
        {QUOTE_SOURCE_LABELS[revision.sourceType]}
        {revision.sourceReference && (
          <span className="block text-muted-foreground">{revision.sourceReference}</span>
        )}
      </Term>
      {revision.notes && (
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-xs text-muted-foreground">Notes</dt>
          <dd className="mt-0.5 whitespace-pre-line">{revision.notes}</dd>
        </div>
      )}
    </dl>
  );
}

function ConfirmWithdraw({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      role="group"
      aria-label="Withdraw this freight rate"
      className="flex flex-col gap-2 text-sm"
    >
      <p>
        <strong>Withdraw this freight rate?</strong> It stays here with its history but is never
        live again; a new rate from this carrier is entered as a new freight rate.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((failure: unknown) => {
              setError(
                failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
              );
              setBusy(false);
            });
          }}
        >
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Keep it
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function RevisionHistory({ freight }: { freight: FreightDetail }) {
  return (
    <Table className="min-w-[48rem]">
      <TableCaption>Revision history</TableCaption>
      <TableHeader>
        <tr>
          <TableHead>Revision</TableHead>
          <TableHead>Rate</TableHead>
          <TableHead>Includes</TableHead>
          <TableHead>Valid until (MT)</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Recorded (MT)</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {freight.revisions.map((revision) => {
          const latest = revision.revisionNumber === freight.current.revisionNumber;
          const payload = freightPayload(revision);
          return (
            <TableRow key={revision.id}>
              <TableRowHeader>{revision.revisionNumber}</TableRowHeader>
              <TableCell className="font-price font-semibold whitespace-nowrap tabular-nums">
                {freightRate(revision)}
                <span className="block font-sans text-xs font-normal text-muted-foreground">
                  {QUOTE_STATUS_LABELS[revision.firmness]}
                  {payload && ` · ${payload}`}
                </span>
              </TableCell>
              <TableCell className="text-xs">{revision.inclusions ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap">
                {formatAlberta(revision.validUntil)}
              </TableCell>
              <TableCell>
                <QuoteStatusBadge status={latest ? freight.status : 'superseded'} />
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap">
                {formatAlberta(revision.recordedAt)}
                <span className="block text-muted-foreground">
                  {revision.recordedByName} · {QUOTE_SOURCE_LABELS[revision.sourceType]}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** One end of the route on the rate's page: the counterparty (linked) and the location. */
function RouteEnd({ label, end }: { label: string; end: FreightLocation }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Link href={`/counterparties/${end.counterparty.id}`} className={nameLink}>
        {end.counterparty.legalName}
      </Link>
      <p className="text-sm text-muted-foreground">{freightPlace(end)}</p>
    </div>
  );
}

/** /freight/:id: one carrier's rate on a route, its current terms and every earlier revision. */
export function FreightRatePage({ session, id }: { session: DirectorySession; id: string }) {
  const { token, organization } = session;
  const [resource, reload] = useApiResource<FreightDetail>(`/freight-quotes/${id}`, token);
  const [mode, setMode] = useState<'view' | 'revise' | 'withdraw'>('view');
  const [notice, setNotice] = useState<string | null>(null);
  const entrant = canEnterFreight(organization.role);

  function done(message: string) {
    setMode('view');
    setNotice(message);
    reload();
  }

  return (
    <section aria-labelledby="freight-rate-heading" className="flex flex-col gap-4">
      {resource.status === 'loading' && (
        <>
          <BackLink href="/freight">All freight rates</BackLink>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </>
      )}
      {resource.status === 'error' && (
        <>
          <BackLink href="/freight">All freight rates</BackLink>
          <p role="alert" className="text-sm text-danger">
            {resource.error.status === 404
              ? 'This freight rate does not exist.'
              : `Could not load it: ${resource.error.message}`}
          </p>
        </>
      )}
      {resource.status === 'ok' &&
        (() => {
          const freight = resource.data;
          const withdrawn = freight.status === 'withdrawn';
          const canChange = entrant && !withdrawn && !freight.carrier.archived;
          return (
            <>
              <PageHeader
                id="freight-rate-heading"
                back={<BackLink href="/freight">All freight rates</BackLink>}
                title={
                  <span className="flex flex-wrap items-center gap-3">
                    <span>
                      {FREIGHT_MODE_LABELS[freight.mode]} rate · {freight.carrier.legalName}
                    </span>
                    <FreightModeBadge mode={freight.mode} />
                    <QuoteStatusBadge status={freight.status} />
                  </span>
                }
                description={
                  <>
                    Quoted by carrier{' '}
                    <Link href={`/counterparties/${freight.carrier.id}`} className={nameLink}>
                      {freight.carrier.legalName}
                    </Link>
                  </>
                }
                actions={
                  canChange &&
                  mode === 'view' && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setNotice(null);
                          setMode('withdraw');
                        }}
                      >
                        <Ban aria-hidden="true" />
                        Withdraw
                      </Button>
                      <Button
                        onClick={() => {
                          setNotice(null);
                          setMode('revise');
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        Record new terms
                      </Button>
                    </>
                  )
                }
              />
              <p role="status" className="text-sm text-success">
                {notice}
              </p>
              {withdrawn && (
                <Callout variant="warning" icon={Ban}>
                  <p>
                    <strong>Withdrawn</strong> on {formatAlberta(freight.withdrawnAt ?? '')}
                    {freight.withdrawnByName && ` by ${freight.withdrawnByName}`}. It is kept with
                    its history and is never live again.
                  </p>
                </Callout>
              )}
              {freight.status === 'expired' && (
                <Callout variant="warning" icon={TimerOff}>
                  <p>
                    <strong>Expired</strong> at {formatAlberta(freight.current.validUntil)}. It is
                    not live; record new terms with a later valid-until time if the carrier renewed
                    it.
                  </p>
                </Callout>
              )}
              {freight.carrier.archived && !withdrawn && (
                <Callout variant="warning" icon={Archive}>
                  <p>The carrier is archived. Restore it on its page before changing this rate.</p>
                </Callout>
              )}

              <Card asChild>
                <section aria-label="Route">
                  <CardContent className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center">
                    <RouteEnd label="From" end={freight.origin} />
                    <ArrowRight
                      aria-hidden="true"
                      className="hidden size-5 shrink-0 text-muted-foreground sm:block"
                    />
                    <RouteEnd label="To" end={freight.destination} />
                  </CardContent>
                </section>
              </Card>

              {mode === 'withdraw' && (
                <Card>
                  <CardContent className="pt-4">
                    <ConfirmWithdraw
                      onConfirm={async () => {
                        await sendJson(`/freight-quotes/${id}/withdraw`, token, 'POST');
                        done('Withdrawn.');
                      }}
                      onCancel={() => {
                        setMode('view');
                      }}
                    />
                  </CardContent>
                </Card>
              )}

              {mode === 'revise' ? (
                <Card asChild>
                  <section aria-labelledby="revise-heading">
                    <CardHeader>
                      <CardTitle id="revise-heading">
                        New terms (revision {freight.current.revisionNumber + 1})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FreightForm
                        initial={{
                          ...freightTermsToFormValues(freight.current),
                          validUntil: utcToAlberta(freight.current.validUntil),
                        }}
                        submitLabel="Save new terms"
                        busyLabel="Saving…"
                        onSubmit={async (values) => {
                          await sendJson(`/freight-quotes/${id}/revisions`, token, 'POST', {
                            basedOnRevision: freight.current.revisionNumber,
                            values,
                          });
                          done('New terms saved. The earlier terms are kept below.');
                        }}
                        onReload={() => {
                          setMode('view');
                          reload();
                        }}
                        onCancel={
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setMode('view');
                            }}
                          >
                            Cancel
                          </Button>
                        }
                      />
                    </CardContent>
                  </section>
                </Card>
              ) : (
                <Card asChild>
                  <section aria-labelledby="current-heading">
                    <CardHeader>
                      <CardTitle id="current-heading">
                        {withdrawn ? 'Last terms' : 'Current terms'}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Revision {freight.current.revisionNumber}, recorded{' '}
                        {formatAlberta(freight.current.recordedAt)} by{' '}
                        {freight.current.recordedByName}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <Terms revision={freight.current} />
                    </CardContent>
                  </section>
                </Card>
              )}

              <Card asChild className="overflow-hidden">
                <section aria-labelledby="history-heading">
                  <CardHeader>
                    <CardTitle id="history-heading">
                      History ({freight.revisions.length}{' '}
                      {freight.revisions.length === 1 ? 'revision' : 'revisions'})
                    </CardTitle>
                  </CardHeader>
                  <RevisionHistory freight={freight} />
                </section>
              </Card>
            </>
          );
        })()}
    </section>
  );
}

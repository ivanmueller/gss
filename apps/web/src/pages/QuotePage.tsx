import {
  QUOTE_SIDE_LABELS,
  QUOTE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  termsToFormValues,
  type QuoteDetail,
  type QuoteRevision,
} from '@grain/domain';
import { Archive, Ban, Pencil, TimerOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import { PageHeader } from '../components/PageHeader';
import { QuoteSideBadge } from '../components/QuoteFields';
import { QuoteForm } from '../components/QuoteForm';
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
import { formatUtc } from '../lib/format';
import {
  canEnterQuotes,
  quoteBasis,
  quoteDelivery,
  quotePlace,
  quotePrice,
  quoteQuantity,
  toLocalInput,
} from '../lib/quotes';
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Terms({ revision }: { revision: QuoteRevision }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Term label="Price">
        <span className="font-price text-base font-semibold tabular-nums">
          {quotePrice(revision)}
        </span>
      </Term>
      <Term label="Firm or indicative">{QUOTE_STATUS_LABELS[revision.firmness]}</Term>
      <Term label="Grade or quality">{revision.grade ?? 'Not stated'}</Term>
      <Term label="Quantity">{quoteQuantity(revision)}</Term>
      <Term label="Delivery basis">{quoteBasis(revision)}</Term>
      <Term label="Delivery">{quoteDelivery(revision)}</Term>
      <Term label="Quoted at">{formatUtc(revision.quotedAt)}</Term>
      <Term label="Valid until">{formatUtc(revision.validUntil)}</Term>
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
    <div role="group" aria-label="Withdraw this quote" className="flex flex-col gap-2 text-sm">
      <p>
        <strong>Withdraw this quote?</strong> It stays here with its history but is never live
        again; a new price from this counterparty is entered as a new quote.
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

function RevisionHistory({ quote }: { quote: QuoteDetail }) {
  return (
    <Table className="min-w-[56rem]">
      <TableCaption>Revision history</TableCaption>
      <TableHeader>
        <tr>
          <TableHead>Revision</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Basis</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead>Valid until (UTC)</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Recorded (UTC)</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {quote.revisions.map((revision) => {
          const latest = revision.revisionNumber === quote.current.revisionNumber;
          return (
            <TableRow key={revision.id}>
              <TableRowHeader>{revision.revisionNumber}</TableRowHeader>
              <TableCell className="font-price font-semibold whitespace-nowrap tabular-nums">
                {quotePrice(revision)}
                <span className="block font-sans text-xs font-normal text-muted-foreground">
                  {QUOTE_STATUS_LABELS[revision.firmness]}
                  {revision.grade && ` · ${revision.grade}`}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">{quoteQuantity(revision)}</TableCell>
              <TableCell>{quoteBasis(revision)}</TableCell>
              <TableCell className="whitespace-nowrap">{quoteDelivery(revision)}</TableCell>
              <TableCell className="whitespace-nowrap">{formatUtc(revision.validUntil)}</TableCell>
              <TableCell>
                <QuoteStatusBadge status={latest ? quote.status : 'superseded'} />
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap">
                {formatUtc(revision.recordedAt)}
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

/** /quotes/:id: one bid or offer, its current terms and every earlier revision. */
export function QuotePage({ session, id }: { session: DirectorySession; id: string }) {
  const { token, organization } = session;
  const [resource, reload] = useApiResource<QuoteDetail>(`/quotes/${id}`, token);
  const [mode, setMode] = useState<'view' | 'revise' | 'withdraw'>('view');
  const [notice, setNotice] = useState<string | null>(null);
  const trader = canEnterQuotes(organization.role);

  function done(message: string) {
    setMode('view');
    setNotice(message);
    reload();
  }

  return (
    <section aria-labelledby="quote-heading" className="flex flex-col gap-4">
      {resource.status === 'loading' && (
        <>
          <BackLink href="/quotes">All bids and offers</BackLink>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </>
      )}
      {resource.status === 'error' && (
        <>
          <BackLink href="/quotes">All bids and offers</BackLink>
          <p role="alert" className="text-sm text-danger">
            {resource.error.status === 404
              ? 'This bid or offer does not exist.'
              : `Could not load it: ${resource.error.message}`}
          </p>
        </>
      )}
      {resource.status === 'ok' &&
        (() => {
          const quote = resource.data;
          const withdrawn = quote.status === 'withdrawn';
          const canChange = trader && !withdrawn && !quote.counterparty.archived;
          const place = quotePlace(quote);
          return (
            <>
              <PageHeader
                id="quote-heading"
                back={<BackLink href="/quotes">All bids and offers</BackLink>}
                title={
                  <span className="flex flex-wrap items-center gap-3">
                    <span>
                      {QUOTE_SIDE_LABELS[quote.side]} · {quote.commodity.name}
                    </span>
                    <QuoteSideBadge side={quote.side} />
                    <QuoteStatusBadge status={quote.status} />
                  </span>
                }
                description={
                  <>
                    {quote.side === 'bid' ? 'From buyer ' : 'From seller '}
                    <Link
                      href={`/counterparties/${quote.counterparty.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {quote.counterparty.legalName}
                    </Link>
                    {place && ` · ${place}`}
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
                    <strong>Withdrawn</strong> on {formatUtc(quote.withdrawnAt ?? '')}
                    {quote.withdrawnByName && ` by ${quote.withdrawnByName}`}. It is kept with its
                    history and is never live again.
                  </p>
                </Callout>
              )}
              {quote.status === 'expired' && (
                <Callout variant="warning" icon={TimerOff}>
                  <p>
                    <strong>Expired</strong> at {formatUtc(quote.current.validUntil)}. It is not
                    live; record new terms with a later valid-until time if the counterparty renewed
                    it.
                  </p>
                </Callout>
              )}
              {quote.counterparty.archived && !withdrawn && (
                <Callout variant="warning" icon={Archive}>
                  <p>
                    The counterparty is archived. Restore it on its page before changing this quote.
                  </p>
                </Callout>
              )}

              {mode === 'withdraw' && (
                <Card>
                  <CardContent className="pt-4">
                    <ConfirmWithdraw
                      onConfirm={async () => {
                        await sendJson(`/quotes/${id}/withdraw`, token, 'POST');
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
                        New terms (revision {quote.current.revisionNumber + 1})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <QuoteForm
                        initial={{
                          ...termsToFormValues(quote.current),
                          validUntil: toLocalInput(quote.current.validUntil),
                        }}
                        submitLabel="Save new terms"
                        busyLabel="Saving…"
                        onSubmit={async (values) => {
                          await sendJson(`/quotes/${id}/revisions`, token, 'POST', {
                            basedOnRevision: quote.current.revisionNumber,
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
                        Revision {quote.current.revisionNumber}, recorded{' '}
                        {formatUtc(quote.current.recordedAt)} by {quote.current.recordedByName}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <Terms revision={quote.current} />
                    </CardContent>
                  </section>
                </Card>
              )}

              <Card asChild className="overflow-hidden">
                <section aria-labelledby="history-heading">
                  <CardHeader>
                    <CardTitle id="history-heading">
                      History ({quote.revisions.length}{' '}
                      {quote.revisions.length === 1 ? 'revision' : 'revisions'})
                    </CardTitle>
                  </CardHeader>
                  <RevisionHistory quote={quote} />
                </section>
              </Card>
            </>
          );
        })()}
    </section>
  );
}

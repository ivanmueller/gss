import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  MAX_RAW_VALUE_LENGTH,
  parseImportRow,
  suggestMapping,
  type ImportFieldId,
  type ImportIssue,
} from '@grain/domain';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import Papa from 'papaparse';
import { useId, useMemo, useState, type ChangeEvent } from 'react';

import { RealDataNote } from '../components/RealDataNote';
import { apiJson, ApiError, type ImportResult } from '../lib/api';
import { canEditDirectory, countryName } from '../lib/directory';
import { Link } from '../lib/router';
import type { DirectorySession } from './CounterpartiesPage';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SHOWN_ISSUES = 50;

interface Sheet {
  fileName: string;
  headers: string[];
  records: Record<string, string>[];
}

type Mapping = Partial<Record<ImportFieldId, string>>;

type Step =
  | { kind: 'choose'; error: string | null }
  | { kind: 'map'; sheet: Sheet; mapping: Mapping; error: string | null; busy: boolean }
  | {
      kind: 'review';
      sheet: Sheet;
      mapping: Mapping;
      result: ImportResult;
      error: string | null;
      busy: boolean;
    }
  | { kind: 'done'; result: ImportResult };

const FIELD_LABELS = Object.fromEntries(
  IMPORT_FIELDS.map((field) => [field.id, field.label]),
) as Record<ImportFieldId, string>;

/** Reads a CSV file into headers and records. Throws a message for the user. */
async function readSheet(file: File): Promise<Sheet> {
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 10 MB.');
  const text = await file.text();
  if (text.includes('\uFFFD')) {
    throw new Error(
      'Some characters in this file could not be read. In Excel, save it as "CSV UTF-8 (Comma delimited)" and choose it again.',
    );
  }
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: false,
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });
  const headers = (parsed.meta.fields ?? []).filter((header) => header !== '');
  if (headers.length === 0) throw new Error('The file has no header row.');
  // A trailing newline gives one empty record at the end; drop it.
  const records = parsed.data.filter(
    (record, index) =>
      index < parsed.data.length - 1 || Object.values(record).some((value) => value.trim() !== ''),
  );
  if (records.length === 0) throw new Error('The file has a header row but no data rows.');
  if (records.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `The file has ${String(records.length)} rows; the limit is ${String(MAX_IMPORT_ROWS)}. Split it and import each part.`,
    );
  }
  return { fileName: file.name || 'import.csv', headers, records };
}

/** The rows as the API expects them: spreadsheet row numbers (the header is row 1) and mapped fields. */
function mappedRows(sheet: Sheet, mapping: Mapping) {
  return sheet.records.map((record, index) => {
    const values: Partial<Record<ImportFieldId, string>> = {};
    for (const [field, header] of Object.entries(mapping) as [ImportFieldId, string][]) {
      // Longer values are still reported as too long, row by row, so nothing is cut silently.
      values[field] = (record[header] ?? '').slice(0, MAX_RAW_VALUE_LENGTH);
    }
    return { line: index + 2, values };
  });
}

function IssueList({ title, issues }: { title: string; issues: ImportIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card">
      <h3 className="border-b px-4 py-2 text-sm font-semibold">
        {title} ({issues.length})
      </h3>
      <ul className="max-h-72 divide-y overflow-y-auto text-sm">
        {issues.slice(0, SHOWN_ISSUES).map((issue, index) => (
          <li
            key={`${String(issue.line)}-${issue.field ?? ''}-${String(index)}`}
            className="px-4 py-1.5"
          >
            Row {issue.line}
            {issue.field && <>, {FIELD_LABELS[issue.field]}</>}: {issue.message}
          </li>
        ))}
      </ul>
      {issues.length > SHOWN_ISSUES && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Showing the first {SHOWN_ISSUES}. Fix these and choose the file again.
        </p>
      )}
    </div>
  );
}

function ColumnMapping({
  sheet,
  mapping,
  onChange,
}: {
  sheet: Sheet;
  mapping: Mapping;
  onChange: (mapping: Mapping) => void;
}) {
  const baseId = useId();
  const sample = sheet.records[0] ?? {};
  return (
    <fieldset className="rounded-xl border bg-card">
      <legend className="sr-only">Match your columns to fields</legend>
      <div className="grid grid-cols-1 divide-y text-sm">
        {IMPORT_FIELDS.map((field) => {
          const id = `${baseId}-${field.id}`;
          const header = mapping[field.id];
          return (
            <div
              key={field.id}
              className="grid grid-cols-1 gap-1 px-4 py-2 sm:grid-cols-[12rem_1fr_1fr] sm:items-center"
            >
              <label htmlFor={id} className="font-medium">
                {field.label}
                {field.required && <span className="text-red-700"> (required)</span>}
              </label>
              <select
                id={id}
                value={header ?? ''}
                onChange={(event) => {
                  const rest = Object.fromEntries(
                    Object.entries(mapping).filter(([key]) => key !== field.id),
                  ) as Mapping;
                  onChange(
                    event.target.value === '' ? rest : { ...rest, [field.id]: event.target.value },
                  );
                }}
                className="rounded-md border bg-background px-2 py-1"
              >
                <option value="">— not in my file —</option>
                {sheet.headers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="truncate text-xs text-muted-foreground">
                {header !== undefined && (sample[header] ?? '') !== ''
                  ? `e.g. ${sample[header] ?? ''}`
                  : ''}
              </span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** /counterparties/import: CSV → column mapping → server review → import. */
export function ImportPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const inputId = useId();
  const [step, setStep] = useState<Step>({ kind: 'choose', error: null });

  const local = useMemo(() => {
    if (step.kind !== 'map') return null;
    const issues: ImportIssue[] = [];
    let valid = 0;
    for (const row of mappedRows(step.sheet, step.mapping)) {
      const result = parseImportRow(row.line, row.values);
      if (result.status === 'invalid') issues.push(...result.issues);
      if (result.status === 'ok') valid += 1;
    }
    return { issues, valid };
  }, [step]);

  if (!canEditDirectory(organization.role)) {
    return (
      <p role="alert" className="text-sm">
        Only operations and admin members of {organization.name} can import counterparties.
      </p>
    );
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const sheet = await readSheet(file);
      setStep({
        kind: 'map',
        sheet,
        mapping: suggestMapping(sheet.headers),
        error: null,
        busy: false,
      });
    } catch (error) {
      setStep({
        kind: 'choose',
        error: error instanceof Error ? error.message : 'The file could not be read.',
      });
    }
  }

  async function send(sheet: Sheet, mapping: Mapping, commit: boolean): Promise<ImportResult> {
    const path = '/counterparties/import';
    const body = JSON.stringify({
      organizationId: organization.id,
      fileName: sheet.fileName.slice(0, 200),
      commit,
      rows: mappedRows(sheet, mapping),
    });
    return apiJson<ImportResult>(path, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  async function review(sheet: Sheet, mapping: Mapping) {
    setStep({ kind: 'map', sheet, mapping, error: null, busy: true });
    try {
      const result = await send(sheet, mapping, false);
      setStep({ kind: 'review', sheet, mapping, result, error: null, busy: false });
    } catch (error) {
      setStep({ kind: 'map', sheet, mapping, error: messageOf(error), busy: false });
    }
  }

  async function commit(sheet: Sheet, mapping: Mapping, result: ImportResult) {
    setStep({ kind: 'review', sheet, mapping, result, error: null, busy: true });
    try {
      setStep({ kind: 'done', result: await send(sheet, mapping, true) });
    } catch (error) {
      setStep({ kind: 'review', sheet, mapping, result, error: messageOf(error), busy: false });
    }
  }

  const missingRequired =
    step.kind === 'map'
      ? IMPORT_FIELDS.filter((field) => field.required && !step.mapping[field.id])
      : [];

  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-4">
      <Link
        href="/counterparties"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All counterparties
      </Link>
      <div>
        <h2 id="import-heading" className="text-lg font-semibold">
          Import counterparties from a spreadsheet
        </h2>
        <p className="text-sm text-muted-foreground">
          Into {organization.name}. In Excel, use File → Save As → “CSV UTF-8 (Comma delimited)”.
          One row per company or per location; rows with the same legal name and country become one
          counterparty. Companies already in the list are skipped, not changed.
        </p>
      </div>
      <RealDataNote organization={organization.name} />

      {step.kind === 'choose' && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus-within:ring-2 focus-within:ring-ring"
          >
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            Choose CSV file
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void choose(event)}
            />
          </label>
          {step.error && (
            <p role="alert" className="text-sm text-red-700">
              {step.error}
            </p>
          )}
        </div>
      )}

      {step.kind === 'map' && local && (
        <>
          <p className="text-sm">
            <strong>{step.sheet.fileName}</strong>: {step.sheet.records.length} rows,{' '}
            {step.sheet.headers.length} columns. Check how your columns match the fields below.
          </p>
          <ColumnMapping
            sheet={step.sheet}
            mapping={step.mapping}
            onChange={(mapping) => {
              setStep({ ...step, mapping, error: null });
            }}
          />
          {missingRequired.length > 0 ? (
            <p role="status" className="text-sm text-red-700">
              Choose a column for {missingRequired.map((field) => field.label).join(' and ')}.
            </p>
          ) : (
            <p role="status" className="text-sm">
              {local.valid} rows ready
              {local.issues.length > 0 &&
                ` · ${String(new Set(local.issues.map((issue) => issue.line)).size)} rows with problems`}
              .
            </p>
          )}
          {missingRequired.length === 0 && (
            <IssueList title="Problems to fix" issues={local.issues} />
          )}
          {step.error && (
            <p role="alert" className="text-sm text-red-700">
              {step.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={missingRequired.length > 0 || step.busy}
              onClick={() => void review(step.sheet, step.mapping)}
              className="rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {step.busy ? 'Checking…' : 'Review import'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep({ kind: 'choose', error: null });
              }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Choose another file
            </button>
          </div>
        </>
      )}

      {step.kind === 'review' && (
        <>
          <ReviewSummary result={step.result} />
          <IssueList title="Problems to fix" issues={step.result.issues} />
          <IssueList title="Warnings" issues={step.result.warnings} />
          {step.error && (
            <p role="alert" className="text-sm text-red-700">
              {step.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                step.busy ||
                step.result.issues.length > 0 ||
                step.result.summary.newCounterparties === 0
              }
              onClick={() => void commit(step.sheet, step.mapping, step.result)}
              className="rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {step.busy
                ? 'Importing…'
                : `Import ${String(step.result.summary.newCounterparties)} new counterparties`}
            </button>
            <button
              type="button"
              disabled={step.busy}
              onClick={() => {
                setStep({
                  kind: 'map',
                  sheet: step.sheet,
                  mapping: step.mapping,
                  error: null,
                  busy: false,
                });
              }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Back to columns
            </button>
          </div>
        </>
      )}

      {step.kind === 'done' && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">
            Imported {step.result.summary.newCounterparties} counterparties with{' '}
            {step.result.summary.contacts} contacts and {step.result.summary.facilities} locations.
          </p>
          {step.result.summary.existingCounterparties > 0 && (
            <p>
              {step.result.summary.existingCounterparties} were already in the list and were left
              unchanged.
            </p>
          )}
          <Link href="/counterparties" className="w-fit underline underline-offset-4">
            See the counterparties
          </Link>
        </div>
      )}
    </section>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

function ReviewSummary({ result }: { result: ImportResult }) {
  const { summary } = result;
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {summary.newCounterparties} new counterparties ({summary.contacts} contacts,{' '}
        {summary.facilities} locations)
        {summary.existingCounterparties > 0 &&
          ` · ${String(summary.existingCounterparties)} already in the list`}
        {summary.emptyRows > 0 && ` · ${String(summary.emptyRows)} empty rows skipped`}.
      </p>
      <div className="max-h-96 overflow-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Counterparties in this import</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Counterparty
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Rows
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Contacts
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Locations
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {result.counterparties.map((item) => (
              <tr key={`${item.country}:${item.legalName}`} className="border-t">
                <th scope="row" className="px-4 py-1.5 text-left font-medium">
                  {item.legalName}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {countryName(item.country)}
                  </span>
                </th>
                <td className="px-4 py-1.5">{item.lines.join(', ')}</td>
                <td className="px-4 py-1.5 tabular-nums">{item.contacts}</td>
                <td className="px-4 py-1.5 tabular-nums">{item.facilities}</td>
                <td className="px-4 py-1.5">
                  {item.status === 'new' ? 'Will be added' : 'Already in the list; skipped'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

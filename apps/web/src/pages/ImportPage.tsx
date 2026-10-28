import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  MAX_RAW_VALUE_LENGTH,
  parseImportRow,
  suggestMapping,
  type CounterpartyType,
  type ImportFieldId,
  type ImportIssue,
} from '@grain/domain';
import { FileSpreadsheet } from 'lucide-react';
import Papa from 'papaparse';
import { useId, useMemo, useState, type ChangeEvent } from 'react';

import { BackLink } from '../components/BackLink';
import { PageHeader } from '../components/PageHeader';
import { RealDataNote } from '../components/RealDataNote';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { FileButton } from '../components/ui/file-button';
import { Select } from '../components/ui/input';
import { SegmentedControl } from '../components/ui/segmented-control';
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

/** Who the rows without a type are: a file of buyers or a file of sellers. */
type FileSide = Extract<CounterpartyType, 'buyer' | 'seller'>;

/** A file, how its columns fill the fields, and who the rows without a type are. */
interface Plan {
  sheet: Sheet;
  mapping: Mapping;
  side: FileSide;
}

type Step =
  | { kind: 'choose'; error: string | null }
  | ({ kind: 'map'; error: string | null; busy: boolean } & Plan)
  | ({
      kind: 'review';
      result: ImportResult;
      error: string | null;
      busy: boolean;
    } & Plan)
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
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          {title} ({issues.length})
        </CardTitle>
      </CardHeader>
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
    </Card>
  );
}

/** The file's columns that fill no field, so the user can see what is left out. */
function UnusedColumns({ sheet, mapping }: { sheet: Sheet; mapping: Mapping }) {
  const used = new Set(Object.values(mapping));
  const unused = sheet.headers.filter((header) => !used.has(header));
  if (unused.length === 0) {
    return <p className="text-sm text-muted-foreground">Every column in your file is used.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p>
        <strong>
          {unused.length === 1
            ? '1 column in your file is not used:'
            : `${String(unused.length)} columns in your file are not used:`}
        </strong>{' '}
        if one of them holds a field above under another name, choose it for that field. Columns
        left unused are not imported.
      </p>
      <ul aria-label="Columns not used" className="flex flex-wrap gap-1.5">
        {unused.map((header) => (
          <li key={header} className="rounded-badge border bg-muted px-2 py-0.5 text-xs">
            {header}
          </li>
        ))}
      </ul>
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
  // Which field each column already fills, to say so in the other fields' lists.
  const usedBy = new Map(
    (Object.entries(mapping) as [ImportFieldId, string][]).map(([field, header]) => [
      header,
      FIELD_LABELS[field],
    ]),
  );
  return (
    <Card asChild>
      <fieldset>
        <legend className="sr-only">Match your columns to fields</legend>
        <div className="grid grid-cols-1 divide-y text-sm">
          {IMPORT_FIELDS.map((field) => {
            const id = `${baseId}-${field.id}`;
            const header = mapping[field.id];
            return (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-1.5 px-4 py-2.5 sm:grid-cols-[12rem_1fr_1fr] sm:items-center sm:gap-3"
              >
                <label htmlFor={id} className="font-medium">
                  {field.label}
                  {field.required && <span className="text-danger"> (required)</span>}
                </label>
                <Select
                  id={id}
                  value={header ?? ''}
                  onChange={(event) => {
                    const rest = Object.fromEntries(
                      Object.entries(mapping).filter(([key]) => key !== field.id),
                    ) as Mapping;
                    onChange(
                      event.target.value === ''
                        ? rest
                        : { ...rest, [field.id]: event.target.value },
                    );
                  }}
                >
                  <option value="">— not in my file —</option>
                  {sheet.headers.map((name) => {
                    const other = usedBy.get(name);
                    return (
                      <option key={name} value={name}>
                        {other && other !== field.label ? `${name} (used for ${other})` : name}
                      </option>
                    );
                  })}
                </Select>
                <span className="truncate text-xs text-muted-foreground">
                  {header === undefined
                    ? field.required
                      ? 'Choose the column that holds this.'
                      : ''
                    : (sample[header] ?? '') !== ''
                      ? `e.g. ${sample[header] ?? ''}`
                      : ''}
                </span>
              </div>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}

/** /counterparties/import: CSV → column mapping → server review → import. */
export function ImportPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [step, setStep] = useState<Step>({ kind: 'choose', error: null });

  const local = useMemo(() => {
    if (step.kind !== 'map') return null;
    const issues: ImportIssue[] = [];
    let valid = 0;
    for (const row of mappedRows(step.sheet, step.mapping)) {
      const result = parseImportRow(row.line, row.values, { defaultTypes: [step.side] });
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
        side: 'buyer',
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

  async function send({ sheet, mapping, side }: Plan, commit: boolean): Promise<ImportResult> {
    const path = '/counterparties/import';
    const body = JSON.stringify({
      organizationId: organization.id,
      fileName: sheet.fileName.slice(0, 200),
      commit,
      defaultTypes: [side],
      rows: mappedRows(sheet, mapping),
    });
    return apiJson<ImportResult>(path, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  async function review(plan: Plan) {
    setStep({ kind: 'map', ...plan, error: null, busy: true });
    try {
      const result = await send(plan, false);
      setStep({ kind: 'review', ...plan, result, error: null, busy: false });
    } catch (error) {
      setStep({ kind: 'map', ...plan, error: messageOf(error), busy: false });
    }
  }

  async function commit(plan: Plan, result: ImportResult) {
    setStep({ kind: 'review', ...plan, result, error: null, busy: true });
    try {
      setStep({ kind: 'done', result: await send(plan, true) });
    } catch (error) {
      setStep({ kind: 'review', ...plan, result, error: messageOf(error), busy: false });
    }
  }

  function planOf(current: Plan): Plan {
    return { sheet: current.sheet, mapping: current.mapping, side: current.side };
  }

  const missingRequired =
    step.kind === 'map'
      ? IMPORT_FIELDS.filter((field) => field.required && !step.mapping[field.id])
      : [];

  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-4">
      <PageHeader
        id="import-heading"
        back={<BackLink href="/counterparties">All counterparties</BackLink>}
        title="Import counterparties from a spreadsheet"
        description={
          <>
            Buyers or sellers, into {organization.name}. In Excel, use File → Save As → “CSV UTF-8
            (Comma delimited)”. One row per company or per location; rows with the same legal name
            and country become one counterparty. Your columns can have any names: you choose which
            column fills which field. Companies already in the list are skipped, not changed.
          </>
        }
      />
      <RealDataNote organization={organization.name} />

      {step.kind === 'choose' && (
        <div className="flex flex-col gap-2">
          <FileButton
            variant="primary"
            accept=".csv,text/csv"
            onChange={(event) => void choose(event)}
          >
            <FileSpreadsheet aria-hidden="true" />
            Choose CSV file
          </FileButton>
          {step.error && (
            <p role="alert" className="text-sm text-danger">
              {step.error}
            </p>
          )}
        </div>
      )}

      {step.kind === 'map' && local && (
        <>
          <p className="text-sm">
            <strong>{step.sheet.fileName}</strong>: {step.sheet.records.length} rows,{' '}
            {step.sheet.headers.length} columns. Columns whose names we recognised are already
            chosen. For each field, check the column, or choose the one that holds it when your file
            names it differently.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span aria-hidden="true" className="font-medium">
              {step.mapping.types
                ? 'Rows with an empty type are:'
                : 'The companies in this file are:'}
            </span>
            <SegmentedControl
              label={
                step.mapping.types
                  ? 'Rows with an empty type are'
                  : 'The companies in this file are'
              }
              options={[
                { value: 'buyer', label: 'Buyers' },
                { value: 'seller', label: 'Sellers' },
              ]}
              value={step.side}
              onChange={(side) => {
                setStep({ ...step, side, error: null });
              }}
            />
          </div>
          <ColumnMapping
            sheet={step.sheet}
            mapping={step.mapping}
            onChange={(mapping) => {
              setStep({ ...step, mapping, error: null });
            }}
          />
          <UnusedColumns sheet={step.sheet} mapping={step.mapping} />
          {missingRequired.length > 0 ? (
            <p role="status" className="text-sm text-danger">
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
            <p role="alert" className="text-sm text-danger">
              {step.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={missingRequired.length > 0 || step.busy}
              onClick={() => void review(planOf(step))}
            >
              {step.busy ? 'Checking…' : 'Review import'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep({ kind: 'choose', error: null });
              }}
            >
              Choose another file
            </Button>
          </div>
        </>
      )}

      {step.kind === 'review' && (
        <>
          <ReviewSummary result={step.result} />
          <IssueList title="Problems to fix" issues={step.result.issues} />
          <IssueList title="Warnings" issues={step.result.warnings} />
          {step.error && (
            <p role="alert" className="text-sm text-danger">
              {step.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                step.busy ||
                step.result.issues.length > 0 ||
                step.result.summary.newCounterparties === 0
              }
              onClick={() => void commit(planOf(step), step.result)}
            >
              {step.busy
                ? 'Importing…'
                : `Import ${String(step.result.summary.newCounterparties)} new counterparties`}
            </Button>
            <Button
              variant="outline"
              disabled={step.busy}
              onClick={() => {
                setStep({ kind: 'map', ...planOf(step), error: null, busy: false });
              }}
            >
              Back to columns
            </Button>
          </div>
        </>
      )}

      {step.kind === 'done' && (
        <Card role="status" className="flex flex-col gap-2 p-4 text-sm">
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
          <Button asChild variant="outline" className="mt-1 w-fit">
            <Link href="/counterparties">See the counterparties</Link>
          </Button>
        </Card>
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
      <Card className="overflow-hidden">
        <Table containerClassName="max-h-96 overflow-y-auto">
          <TableCaption>Counterparties in this import</TableCaption>
          <TableHeader className="sticky top-0 bg-card">
            <tr>
              <TableHead>Counterparty</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Locations</TableHead>
              <TableHead>Result</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {result.counterparties.map((item) => (
              <TableRow key={`${item.country}:${item.legalName}`}>
                <TableRowHeader className="py-1.5">
                  {item.legalName}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {countryName(item.country)}
                  </span>
                </TableRowHeader>
                <TableCell className="py-1.5">{item.lines.join(', ')}</TableCell>
                <TableCell className="py-1.5">{item.contacts}</TableCell>
                <TableCell className="py-1.5">{item.facilities}</TableCell>
                <TableCell className="py-1.5">
                  {item.status === 'new' ? 'Will be added' : 'Already in the list; skipped'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

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

import { apiJson, ApiError, type ImportResult } from '../lib/api';
import { countryName } from '../lib/directory';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { FindCoordinates } from './FindCoordinates';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';
import { FileButton } from './ui/file-button';
import { Select } from './ui/select';
import { SegmentedControl } from './ui/segmented-control';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from './ui/table';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const STEPS = ['Choose the file', 'Match the columns', 'Check', 'Coordinates'] as const;
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

/** The fields a column can fill; the trading name is no longer collected (2026-10-30). */
const SHOWN_FIELDS = IMPORT_FIELDS.filter((field) => field.id !== 'tradingName');

/** Columns matched by their names, without the trading name. */
function suggested(headers: string[]): Mapping {
  const mapping = suggestMapping(headers);
  delete mapping.tradingName;
  return mapping;
}

const STEP_INDEX: Record<Step['kind'], number> = { choose: 0, map: 1, review: 2, done: 3 };

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
          {SHOWN_FIELDS.map((field) => {
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
                  onValueChange={(next) => {
                    const rest = Object.fromEntries(
                      Object.entries(mapping).filter(([key]) => key !== field.id),
                    ) as Mapping;
                    onChange(next === '' ? rest : { ...rest, [field.id]: next });
                  }}
                  options={[
                    { value: '', label: '— not in my file —' },
                    ...sheet.headers.map((name) => {
                      const other = usedBy.get(name);
                      return {
                        value: name,
                        label:
                          other && other !== field.label ? `${name} (used for ${other})` : name,
                      };
                    }),
                  ]}
                />
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

/**
 * Counterparties from a spreadsheet, in the + button's window (owner's request,
 * 2026-10-30): CSV → column mapping → server review → import → coordinates from the
 * addresses. `onImported` lets the list reload; `onClose` closes the window.
 */
export function ImportSpreadsheet({
  session,
  onImported,
  onClose,
}: {
  session: DirectorySession;
  onImported: () => void;
  onClose: () => void;
}) {
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

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const sheet = await readSheet(file);
      setStep({
        kind: 'map',
        sheet,
        mapping: suggested(sheet.headers),
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

  async function send(
    { sheet, mapping, side }: Plan,
    commit: boolean,
    reviewed?: string | null,
  ): Promise<ImportResult> {
    const path = '/counterparties/import';
    const body = JSON.stringify({
      organizationId: organization.id,
      fileName: sheet.fileName.slice(0, 200),
      commit,
      ...(commit && { reviewed }),
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
      setStep({ kind: 'done', result: await send(plan, true, result.fingerprint) });
      onImported();
    } catch (error) {
      // The list changed since the check: nothing was written, and its answer is the new plan
      // to look over (Codex's review of ivanmueller/gss#95).
      const fresh =
        error instanceof ApiError && error.code === 'PLAN_CHANGED'
          ? (error.body as ImportResult)
          : result;
      setStep({ kind: 'review', ...plan, result: fresh, error: messageOf(error), busy: false });
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
    <section aria-label="Import spreadsheet" className="flex flex-col gap-4">
      <ol
        aria-label="Steps"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={STEP_INDEX[step.kind] === index ? 'step' : undefined}
            className={
              STEP_INDEX[step.kind] === index ? 'font-semibold text-foreground' : undefined
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step.kind === 'choose' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Buyers or sellers, one row per company or per location. In Excel, use File → Save As →
            “CSV UTF-8 (Comma delimited)”. Rows with the same legal name and country become one
            counterparty; companies already in the list are skipped, not changed. Commodities from
            the file are listed as unverified until someone on the team verifies them.
          </p>
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
                (step.result.summary.newCounterparties === 0 &&
                  step.result.summary.existingWithAdditions === 0)
              }
              onClick={() => void commit(planOf(step), step.result)}
            >
              {step.busy ? 'Importing…' : importLabel(step.result)}
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
        <div className="flex flex-col gap-3">
          <Card role="status" className="flex flex-col gap-1 p-4 text-sm">
            {step.result.summary.newCounterparties > 0 && (
              <p className="font-medium">
                Imported {step.result.summary.newCounterparties} counterparties with{' '}
                {step.result.summary.contacts} contacts and {step.result.summary.facilities}{' '}
                locations.
              </p>
            )}
            {step.result.summary.existingWithAdditions > 0 && (
              <p className="font-medium">Added {added(step.result)}.</p>
            )}
            {step.result.summary.existingUpdated > 0 && (
              <p className="font-medium">
                Updated {plural(step.result.summary.existingUpdated, 'company', 'companies')} from
                the file.
              </p>
            )}
            {step.result.summary.existingCounterparties > 0 && (
              <p>
                {step.result.summary.existingCounterparties} were already in the list: filled cells
                replaced their details, empty ones kept them, and verified grains were left as they
                were.
              </p>
            )}
          </Card>
          {step.result.importBatchId !== null &&
          step.result.summary.facilities + step.result.summary.addedFacilities > 0 ? (
            <FindCoordinates
              session={session}
              scope={{ importBatchId: step.result.importBatchId }}
              doneLabel="Done"
              onDone={onClose}
            />
          ) : (
            <Button className="w-fit" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * What the file adds to companies already in the list, e.g. "2 new locations and 1 new
 * contact for 1 company already in the list".
 */
function added({ summary }: ImportResult): string {
  const parts = [
    summary.addedFacilities > 0 && plural(summary.addedFacilities, 'new location', 'new locations'),
    summary.addedContacts > 0 && plural(summary.addedContacts, 'new contact', 'new contacts'),
    summary.addedCommodities > 0 && plural(summary.addedCommodities, 'new grain', 'new grains'),
  ].filter((part): part is string => part !== false);
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
      : (parts[0] ?? '');
  if (list === '') {
    return `updates to ${plural(summary.existingUpdated, 'company', 'companies')} already in the list`;
  }
  return `${list} for ${plural(summary.existingWithAdditions, 'company', 'companies')} already in the list`;
}

/** The import button: new companies, new locations for listed ones, or both. */
function importLabel(result: ImportResult): string {
  const { newCounterparties, existingWithAdditions } = result.summary;
  if (existingWithAdditions === 0) return `Import ${String(newCounterparties)} new counterparties`;
  if (newCounterparties === 0) return 'Add to the companies already in the list';
  return `Import ${String(newCounterparties)} new counterparties and add to listed ones`;
}

/** One company's line on the check step. */
function resultText(item: ImportResult['counterparties'][number]): string {
  if (item.status === 'new') return 'Will be added';
  if (item.status === 'archived') return 'Archived; skipped';
  const parts = [
    item.facilities > 0 && plural(item.facilities, 'location', 'locations'),
    item.contacts > 0 && plural(item.contacts, 'contact', 'contacts'),
  ].filter((part): part is string => part !== false);
  if (parts.length > 0) return `Already in the list; adds ${parts.join(' and ')}`;
  return item.changes.length > 0
    ? 'Already in the list; updated'
    : 'Already in the list; nothing new';
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
        {summary.existingWithAdditions > 0 && `; ${added(result)}`}
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
                  {resultText(item)}
                  {item.changes.length > 0 && (
                    <ul
                      aria-label={`Changes to ${item.legalName}`}
                      className="mt-1 list-disc pl-4 text-xs text-muted-foreground"
                    >
                      {item.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

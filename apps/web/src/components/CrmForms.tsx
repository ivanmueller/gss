import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  CONTACT_NOTES_MAX,
  parseContactLog,
  parseFollowUp,
  type ContactLogFormValues,
  type CrmFieldId,
  type CrmIssue,
  type FollowUpFormValues,
  type TeamMemberName,
} from '@grain/domain';
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';

import { ApiError } from '../lib/api';
import { centralInputToRequest } from '../lib/crm';
import { controlProps, Field, issueText } from './DirectoryFields';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';

// The CRM's forms: logging a contact (with an optional follow-up) and planning or changing
// a follow-up. They check with the API's rules (packages/domain/src/crm.ts) before sending.
// Times are typed in Central time and sent as UTC instants.

const LABELS: Record<CrmFieldId, string> = {
  occurredAt: 'When',
  channel: 'How',
  contactName: 'Who you spoke to',
  notes: 'Notes',
  task: 'What to do',
  dueAt: 'Due',
  assignedTo: 'Who is responsible',
};

const HINTS: Partial<Record<CrmFieldId, ReactNode>> = {
  occurredAt: 'Central time.',
  contactName: 'Pick one of their contacts or type a name.',
  task: 'E.g. send the November bid sheet.',
  dueAt: 'Central time.',
};

/** The issues in a 422 answer to a CRM form, if any. */
function crmIssues(error: unknown): CrmIssue[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) {
    return [];
  }
  const issues: unknown = (error.body as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as CrmIssue[]) : [];
}

type Values = Partial<Record<CrmFieldId, string>>;

function CrmField({
  field,
  values,
  issues,
  onChange,
  disabled,
  team,
  contactNames,
  className,
}: {
  field: CrmFieldId;
  values: Values;
  issues: readonly CrmIssue[];
  onChange: (changes: Values) => void;
  disabled: boolean;
  team?: readonly TeamMemberName[];
  contactNames?: readonly string[];
  className?: string;
}) {
  const baseId = useId();
  const id = `${baseId}-${field}`;
  const label = LABELS[field];
  const issue = issues.find((item) => item.field === field);
  const error = issue && issueText(label, issue.message);
  const value = values[field] ?? '';
  const set = (next: string) => {
    onChange({ [field]: next });
  };
  const common = {
    ...controlProps(id, error),
    value,
    disabled,
    onChange: (event: { target: { value: string } }) => {
      set(event.target.value);
    },
  };
  let control: ReactNode;
  if (field === 'channel' || field === 'assignedTo') {
    const options =
      field === 'channel'
        ? CONTACT_CHANNELS.map((channel) => ({
            value: channel,
            label: CONTACT_CHANNEL_LABELS[channel],
          }))
        : (team ?? []).map((member) => ({ value: member.userId, label: member.name }));
    control = (
      <Select
        {...controlProps(id, error)}
        value={value}
        onValueChange={set}
        disabled={disabled}
        options={options}
      />
    );
  } else if (field === 'notes') {
    control = <Textarea {...common} rows={4} maxLength={CONTACT_NOTES_MAX} />;
  } else if (field === 'occurredAt' || field === 'dueAt') {
    control = <Input {...common} type="datetime-local" />;
  } else {
    const listId = field === 'contactName' && contactNames?.length ? `${id}-contacts` : undefined;
    control = (
      <>
        <Input {...common} type="text" autoComplete="off" maxLength={200} list={listId} />
        {listId && (
          <datalist id={listId}>
            {contactNames?.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
      </>
    );
  }
  return (
    <Field
      id={id}
      label={label}
      required={field !== 'notes' && field !== 'occurredAt'}
      error={error}
      hint={HINTS[field]}
      className={className}
    >
      {control}
    </Field>
  );
}

/** Buttons and the messages of a failed save, shared by the forms. */
function FormFooter({
  busy,
  issues,
  error,
  submitLabel,
  busyLabel,
  onCancel,
  onReload,
}: {
  busy: boolean;
  issues: readonly CrmIssue[];
  error: { code: string; message: string } | null;
  submitLabel: string;
  busyLabel: string;
  onCancel: () => void;
  onReload?: (() => void) | undefined;
}) {
  const stale = error?.code === 'ENTRY_CHANGED' || error?.code === 'RECORD_CHANGED';
  return (
    <>
      {issues.length > 0 && (
        <p role="status" className="text-sm text-danger">
          Some fields need fixing; see the messages above.
        </p>
      )}
      {error && issues.length === 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{error.message}</p>
          {stale && onReload && (
            <Button type="button" size="sm" variant="outline" onClick={onReload}>
              Reload
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function failure(error: unknown) {
  return {
    code: error instanceof ApiError ? error.code : '',
    message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
  };
}

const logRequest = (values: Values): ContactLogFormValues => ({
  occurredAt: centralInputToRequest(values.occurredAt),
  channel: values.channel ?? '',
  contactName: values.contactName ?? '',
  notes: values.notes ?? '',
});

const planRequest = (values: Values): FollowUpFormValues => ({
  task: values.task ?? '',
  dueAt: centralInputToRequest(values.dueAt),
  assignedTo: values.assignedTo ?? '',
});

/**
 * Logs a contact or corrects one. With `team`, it offers a follow-up planned in the same
 * step (new entries only); `followUpDefaults` fills it in when ticked.
 */
export function ContactLogForm({
  initial,
  contactNames,
  team,
  followUpDefaults,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  onReload,
}: {
  initial: ContactLogFormValues;
  contactNames: readonly string[];
  team?: readonly TeamMemberName[];
  followUpDefaults?: FollowUpFormValues;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (log: ContactLogFormValues, followUp: FollowUpFormValues | null) => Promise<void>;
  onCancel: () => void;
  onReload?: () => void;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [issues, setIssues] = useState<CrmIssue[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const change = (changes: Values) => {
    setValues((current) => ({ ...current, ...changes }));
  };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const log = logRequest(values);
    const plan = withFollowUp ? planRequest(values) : null;
    const checkedLog = parseContactLog(log, new Date());
    const checkedPlan = plan ? parseFollowUp(plan) : null;
    const found = [
      ...(checkedLog.status === 'invalid' ? checkedLog.issues : []),
      ...(checkedPlan?.status === 'invalid' ? checkedPlan.issues : []),
    ];
    setIssues(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      await onSubmit(log, plan);
    } catch (caught) {
      setIssues(crmIssues(caught));
      setError(failure(caught));
      setBusy(false);
    }
  }

  const props = { values, issues, onChange: change, disabled: busy };
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CrmField field="occurredAt" {...props} />
        <CrmField field="channel" {...props} />
        <CrmField field="contactName" {...props} contactNames={contactNames} />
        <CrmField field="notes" {...props} className="sm:col-span-3" />
      </div>
      {team && (
        <fieldset className="flex flex-col gap-3">
          <label className="flex w-fit items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={withFollowUp}
              disabled={busy}
              onChange={(event) => {
                setWithFollowUp(event.target.checked);
                if (event.target.checked && followUpDefaults) {
                  setValues((current) => ({ ...followUpDefaults, ...current }));
                }
              }}
            />
            Plan a follow-up
          </label>
          {withFollowUp && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CrmField field="task" {...props} />
              <CrmField field="dueAt" {...props} />
              <CrmField field="assignedTo" {...props} team={team} />
            </div>
          )}
        </fieldset>
      )}
      <FormFooter
        busy={busy}
        issues={issues}
        error={error}
        submitLabel={submitLabel}
        busyLabel={busyLabel}
        onCancel={onCancel}
        onReload={onReload}
      />
    </form>
  );
}

/** Plans a follow-up or changes one. */
export function FollowUpForm({
  initial,
  team,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  onReload,
}: {
  initial: FollowUpFormValues;
  team: readonly TeamMemberName[];
  submitLabel: string;
  busyLabel: string;
  onSubmit: (values: FollowUpFormValues) => Promise<void>;
  onCancel: () => void;
  onReload?: () => void;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [issues, setIssues] = useState<CrmIssue[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const plan = planRequest(values);
    const checked = parseFollowUp(plan);
    setIssues(checked.status === 'invalid' ? checked.issues : []);
    if (checked.status === 'invalid') return;
    setBusy(true);
    try {
      await onSubmit(plan);
    } catch (caught) {
      setIssues(crmIssues(caught));
      setError(failure(caught));
      setBusy(false);
    }
  }

  const props = {
    values,
    issues,
    disabled: busy,
    onChange: (changes: Values) => {
      setValues((current) => ({ ...current, ...changes }));
    },
  };
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CrmField field="task" {...props} />
        <CrmField field="dueAt" {...props} />
        <CrmField field="assignedTo" {...props} team={team} />
      </div>
      <FormFooter
        busy={busy}
        issues={issues}
        error={error}
        submitLabel={submitLabel}
        busyLabel={busyLabel}
        onCancel={onCancel}
        onReload={onReload}
      />
    </form>
  );
}

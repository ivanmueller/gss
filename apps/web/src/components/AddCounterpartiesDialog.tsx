import { ArrowLeft, FileUp, PencilLine, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { canDeleteCounterparties } from '../lib/directory';
import { setSearchParams } from '../lib/router';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { AddCounterpartyForm } from './AddCounterpartyForm';
import { ImportSpreadsheet } from './ImportSpreadsheet';
import { UndoImport } from './UndoImport';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';

export const ADD_TABS = ['one', 'import'] as const;
export type AddTab = (typeof ADD_TABS)[number];

type Step = 'choose' | AddTab | 'undo';

const CHOICE =
  'flex items-start gap-3 rounded-card border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:bg-accent';

/**
 * One + button for operations and admins (owner's requests, 2026-10-30). It opens a small
 * window to choose how to add counterparties; the choice replaces it with the next window,
 * which rises into place: the add form, or the spreadsheet import in its steps. Back returns
 * to the choice. `?add=one` or `?add=import` opens straight on that window, so the old
 * addresses of the two pages still lead there.
 */
export function AddCounterpartiesDialog({
  session,
  initialTab,
  onImported,
}: {
  session: DirectorySession;
  /** Open on this window when the page opens; closed when null. */
  initialTab: AddTab | null;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(initialTab !== null);
  const [step, setStep] = useState<Step>(initialTab ?? 'choose');

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep('choose');
      if (initialTab !== null) setSearchParams({ add: null });
    }
  }
  const close = () => {
    change(false);
  };

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit"
      onClick={() => {
        setStep('choose');
      }}
    >
      <ArrowLeft aria-hidden="true" />
      Ways to add
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="ml-auto"
          aria-label="Add counterparties"
          title="Add counterparties"
        >
          <Plus aria-hidden="true" />
        </Button>
      </DialogTrigger>
      {step === 'choose' ? (
        <DialogContent
          key="choose"
          title="Add counterparties"
          description="Add one company yourself, or many at once from a spreadsheet."
        >
          <nav aria-label="Ways to add" className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={CHOICE}
              onClick={() => {
                setStep('one');
              }}
            >
              <PencilLine
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Add by hand</span>
                <span className="text-sm text-muted-foreground">
                  One company, with its first contact and location.
                </span>
              </span>
            </button>
            <button
              type="button"
              className={CHOICE}
              onClick={() => {
                setStep('import');
              }}
            >
              <FileUp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Import spreadsheet</span>
                <span className="text-sm text-muted-foreground">
                  Many companies from a CSV file, checked before anything is saved.
                </span>
              </span>
            </button>
            {/* Admins undo an import to start it again (owner's request, 2026-11-04). */}
            {canDeleteCounterparties(session.organization.role) && (
              <button
                type="button"
                className={CHOICE}
                onClick={() => {
                  setStep('undo');
                }}
              >
                <Undo2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">Undo an import</span>
                  <span className="text-sm text-muted-foreground">
                    Remove the companies a spreadsheet import added, to import it again. Admins
                    only.
                  </span>
                </span>
              </button>
            )}
          </nav>
        </DialogContent>
      ) : (
        <DialogContent
          // A new window for each choice, so it rises in each time.
          key={step}
          title={
            step === 'one'
              ? 'Add a counterparty'
              : step === 'import'
                ? 'Import counterparties'
                : 'Undo an import'
          }
          description={
            step === 'one'
              ? 'One company, with its first location if you have it.'
              : step === 'import'
                ? 'Buyers, sellers or carriers from a spreadsheet, checked before anything is saved.'
                : 'Choose an import to see what undoing it removes. Nothing is removed until you confirm.'
          }
          className="max-w-3xl animate-dialog-in"
          // A half-filled form or a matched spreadsheet is not lost to a stray click outside;
          // Escape and the close button still close it.
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          {back}
          {step === 'one' ? (
            <AddCounterpartyForm session={session} onCancel={close} />
          ) : step === 'import' ? (
            <ImportSpreadsheet session={session} onImported={onImported} onClose={close} />
          ) : (
            <UndoImport session={session} onUndone={onImported} onClose={close} />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

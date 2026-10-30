import { FileUp, PencilLine, Plus } from 'lucide-react';
import { useState } from 'react';

import { setSearchParams } from '../lib/router';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { AddCounterpartyForm } from './AddCounterpartyForm';
import { ImportSpreadsheet } from './ImportSpreadsheet';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

export const ADD_TABS = ['one', 'import'] as const;
export type AddTab = (typeof ADD_TABS)[number];

/**
 * One + button for operations and admins that opens a window where counterparties are
 * added, one by hand or many from a spreadsheet, without leaving the list (owner's
 * requests, 2026-10-30). `?add=one` or `?add=import` opens it on that tab, so the old
 * addresses of the two pages still lead here.
 */
export function AddCounterpartiesDialog({
  session,
  initialTab,
  onImported,
}: {
  session: DirectorySession;
  /** Open on this tab when the page opens; closed when null. */
  initialTab: AddTab | null;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(initialTab !== null);
  const [tab, setTab] = useState<AddTab>(initialTab ?? 'one');

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setTab('one');
      if (initialTab !== null) setSearchParams({ add: null });
    }
  }
  const close = () => {
    change(false);
  };

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
      <DialogContent
        title="Add counterparties"
        description="Add one company yourself, or many at once from a spreadsheet."
        className="max-w-3xl"
        // A half-filled form or a matched spreadsheet is not lost to a stray click outside;
        // Escape and the close button still close it.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value === 'import' ? 'import' : 'one');
          }}
        >
          <TabsList aria-label="Ways to add">
            <TabsTrigger value="one">
              <PencilLine aria-hidden="true" className="size-4" />
              Add one
            </TabsTrigger>
            <TabsTrigger value="import">
              <FileUp aria-hidden="true" className="size-4" />
              Import spreadsheet
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <AddCounterpartyForm session={session} onCancel={close} />
          </TabsContent>
          <TabsContent value="import">
            <ImportSpreadsheet session={session} onImported={onImported} onClose={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

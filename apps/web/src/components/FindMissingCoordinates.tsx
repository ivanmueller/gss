import { MapPin } from 'lucide-react';
import { useState } from 'react';

import type { DirectorySession } from '../pages/CounterpartiesPage';
import { FindCoordinates } from './FindCoordinates';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/**
 * Finds coordinates for every location of the list that has none, in one go, page after
 * page (2026-11-04): after a large import whose lookup failed, or for locations added since.
 * For operations and admins. `onDone` lets the map show what was found.
 */
export function FindMissingCoordinates({
  session,
  onDone,
}: {
  session: DirectorySession;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          setOpen(true);
        }}
      >
        <MapPin aria-hidden="true" />
        Find missing coordinates
      </Button>
      {open && (
        <DialogContent
          title="Find missing coordinates"
          description="Every location without coordinates is looked up from its address. Each lookup counts toward Geocodio's free daily allowance of 2,500."
        >
          <FindCoordinates
            session={session}
            scope={null}
            doneLabel="Done"
            onDone={() => {
              setOpen(false);
              onDone();
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

import { MapPinned } from 'lucide-react';

import { RoleLabel } from './RoleLabel';

export function MapPanel() {
  return (
    <section
      aria-labelledby="map-heading"
      className="flex min-h-80 flex-col rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="map-heading" className="text-sm font-semibold">
          Map
        </h2>
        <p className="flex gap-3 text-xs">
          <RoleLabel role="seller" suffix="offer" />
          <RoleLabel role="buyer" suffix="bid" />
        </p>
      </div>
      <div className="m-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-6 text-center">
        <MapPinned aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-medium">Map placeholder</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This demo has no map. Your organization’s real locations are on the Map page; pick a
          synthetic facility from the Facilities section here.
        </p>
      </div>
    </section>
  );
}

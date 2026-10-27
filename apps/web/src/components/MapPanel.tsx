import { MapPinned } from 'lucide-react';

import { RoleLabel } from './RoleLabel';
import { Card, CardHeader, CardTitle } from './ui/card';

export function MapPanel() {
  return (
    <Card asChild>
      <section aria-labelledby="map-heading" className="flex min-h-80 flex-col">
        <CardHeader>
          <CardTitle id="map-heading">Map</CardTitle>
          <p className="flex gap-3 text-xs">
            <RoleLabel role="seller" suffix="offer" />
            <RoleLabel role="buyer" suffix="bid" />
          </p>
        </CardHeader>
        <div className="m-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-control border border-dashed bg-muted/50 p-6 text-center">
          <MapPinned aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-medium">Map placeholder</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This demo has no map. Your organization’s real locations are on the Map page; pick a
            synthetic facility from the Facilities section here.
          </p>
        </div>
      </section>
    </Card>
  );
}

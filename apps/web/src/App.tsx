import { useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { FacilityList } from './components/FacilityList';
import { FacilityTable } from './components/FacilityTable';
import { FilterBar, type RoleFilter } from './components/FilterBar';
import { MapPanel } from './components/MapPanel';
import { QuoteInspector } from './components/QuoteInspector';
import { SyntheticBanner } from './components/SyntheticBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { SYNTHETIC_FACILITIES } from './data/synthetic';
import { useApiHealth } from './lib/useApiHealth';
import { useMediaQuery } from './lib/useMediaQuery';

// Tailwind's `lg` breakpoint.
const DESKTOP_QUERY = '(min-width: 1024px)';

export function App() {
  const health = useApiHealth();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [selectedId, setSelectedId] = useState(SYNTHETIC_FACILITIES[0]?.id ?? '');

  const visible =
    roleFilter === 'all'
      ? SYNTHETIC_FACILITIES
      : SYNTHETIC_FACILITIES.filter((facility) => facility.roles.includes(roleFilter));
  const selected = SYNTHETIC_FACILITIES.find((facility) => facility.id === selectedId);

  const listProps = { facilities: visible, selectedId, onSelect: setSelectedId };
  const inspector = <QuoteInspector facility={selected} />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader health={health} />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4">
        <SyntheticBanner />
        <FilterBar value={roleFilter} onChange={setRoleFilter} />
        {isDesktop ? (
          <div className="grid grid-cols-[3fr_2fr] gap-4">
            <MapPanel />
            {inspector}
            <div className="col-span-2">
              <FacilityTable {...listProps} />
            </div>
          </div>
        ) : (
          <>
            <Tabs defaultValue="list">
              <TabsList aria-label="Workspace view">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="map">Map</TabsTrigger>
              </TabsList>
              <TabsContent value="list">
                <FacilityList {...listProps} />
              </TabsContent>
              <TabsContent value="map">
                <MapPanel />
              </TabsContent>
            </Tabs>
            {inspector}
          </>
        )}
      </main>
    </div>
  );
}

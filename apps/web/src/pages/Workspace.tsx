import { useState } from 'react';

import { FacilityList } from '../components/FacilityList';
import { FacilityTable } from '../components/FacilityTable';
import { FilterBar, type RoleFilter } from '../components/FilterBar';
import { MapPanel } from '../components/MapPanel';
import { PageHeader } from '../components/PageHeader';
import { QuoteInspector } from '../components/QuoteInspector';
import { SyntheticBanner } from '../components/SyntheticBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SYNTHETIC_FACILITIES } from '../data/synthetic';
import { useMediaQuery } from '../lib/useMediaQuery';

// Tailwind's `lg` breakpoint.
const DESKTOP_QUERY = '(min-width: 1024px)';

/** The demo trading workspace, on synthetic data only. */
export function Workspace() {
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
    <section aria-labelledby="workspace-heading" className="flex flex-col gap-4">
      <PageHeader
        id="workspace-heading"
        title="Workspace"
        description="Pick a facility to see its latest quote. A demo on synthetic data until bids and offers are built."
      />
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
    </section>
  );
}

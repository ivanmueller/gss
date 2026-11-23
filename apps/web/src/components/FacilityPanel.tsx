import { FACILITY_GROUPS } from '@grain/domain';

import type { MapBounds } from '../lib/mapbox';
import { FACILITY_COLOURS } from '../lib/facilitiesMap';
import { facilityLive, type FacilityEntry } from './Facilities';
import { landDay } from './LandPanel';
import { MapPanel, MapTip, PanelBadge, PanelSection, PanelTiles, TipHead } from './MapPanel';
import { Button } from './ui/button';

// A facility on the oil and gas map (F-278): the box at the pointer with its simple lines, and
// the panel on the right when it is clicked, as for land and wells (F-265).

const groupName = (f: FacilityEntry) =>
  FACILITY_GROUPS.find((g) => g.key === f.group)?.name ?? 'Other';

/** Where the point comes from, in words: many are a square's centre, not the facility's spot. */
export function facilityPlace(located: string | null): string {
  switch (located) {
    case 'Facility Licence':
      return 'From the facility’s licence';
    case 'Well Licence':
      return 'From its well’s licence';
    case 'LSD Centre':
      return 'The centre of its legal subdivision (about 400 m across), not its own spot';
    case 'Section Centre':
      return 'The centre of its section (about 1.6 km across), not its own spot';
    default:
      return 'Not said by the AER';
  }
}

/** The licence as the AER numbers it: "F 6422" is a facility licence, "W …" a well's. */
export function facilityLicence(licence: string | null): string {
  if (licence === null) return '—';
  const [kind, number] = licence.split(' ');
  if (number === undefined) return licence;
  return kind === 'F' ? `Facility ${number}` : kind === 'W' ? `Well ${number}` : licence;
}

export function FacilityTip({ facility }: { facility: FacilityEntry | null }) {
  if (!facility) return null;
  return (
    <MapTip>
      <TipHead title={facility.id} aside={facility.status} />
      {facility.name && <p className="mt-0.5 truncate font-medium">{facility.name}</p>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-2 shrink-0"
          style={{ backgroundColor: FACILITY_COLOURS[facility.group] }}
        />
        <span className="truncate">{facility.subType ?? groupName(facility)}</span>
      </p>
      {facility.operator?.name && (
        <p className="mt-0.5 truncate text-xs">{facility.operator.name}</p>
      )}
    </MapTip>
  );
}

export function FacilityPanel({
  facility,
  fileDate,
  goTo,
  onClose,
}: {
  facility: FacilityEntry | null;
  fileDate: string | null;
  goTo: (bounds: MapBounds) => void;
  onClose: () => void;
}) {
  if (!facility) return null;
  const f = facility;
  const colour = FACILITY_COLOURS[f.group];
  const company = (c: FacilityEntry['operator']) =>
    c?.name ? (
      <p>
        {c.name}
        {c.code && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{c.code}</span>}
      </p>
    ) : (
      <p className="text-muted-foreground">Not given</p>
    );
  const sameCompany =
    f.licensee !== null && f.operator !== null && f.licensee.code === f.operator.code;
  return (
    <MapPanel
      label={`Facility ${f.id}`}
      eyebrow={`Facility · ${groupName(f)}`}
      title={f.id}
      onClose={onClose}
    >
      {f.name && <p className="mt-1 font-medium">{f.name}</p>}
      <PanelBadge colour={facilityLive(f.status) ? colour : '#78716c'}>
        {f.status ?? 'No status'}
      </PanelBadge>
      <PanelTiles
        tiles={[
          { label: 'Type code', value: f.subCode !== null ? String(f.subCode) : '—' },
          { label: 'Licence', value: facilityLicence(f.licence) },
          {
            label: 'Point',
            value:
              f.located === 'LSD Centre' || f.located === 'Section Centre' ? 'Square' : 'Licence',
            title: facilityPlace(f.located),
          },
        ]}
      />
      <div className="mt-3">
        <Button
          size="sm"
          onClick={() => {
            const d = 0.01;
            goTo([f.longitude - d, f.latitude - d, f.longitude + d, f.latitude + d]);
          }}
        >
          Zoom to facility
        </Button>
      </div>
      <PanelSection title="Type">
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0"
            style={{ backgroundColor: colour }}
          />
          {f.subType ?? groupName(f)}
        </p>
      </PanelSection>
      <PanelSection title="Operator">{company(f.operator)}</PanelSection>
      {!sameCompany && <PanelSection title="Licensee">{company(f.licensee)}</PanelSection>}
      <PanelSection title="Where">
        <p className="font-mono text-xs">
          {f.latitude.toFixed(5)}, {f.longitude.toFixed(5)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{facilityPlace(f.located)}</p>
      </PanelSection>
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        The AER’s ST102 facility list{fileDate ? `, its file of ${landDay(fileDate)}` : ''}.
      </p>
    </MapPanel>
  );
}

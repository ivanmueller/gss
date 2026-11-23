import { PIPELINE_SUBSTANCES, pipelineSubstanceOf, type PipelineSubstance } from '@grain/domain';
import { useEffect, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import type { MapBounds } from '../lib/mapbox';
import { PIPELINE_COLOURS, pipelineStrength } from '../lib/pipelinesMap';
import { landDay } from './LandPanel';
import { MapPanel, MapTip, PanelBadge, PanelSection, PanelTiles, TipHead } from './MapPanel';
import type { PipelineEntry } from './Pipelines';
import { Button } from './ui/button';

// A pipeline segment on the oil and gas map (F-249): the box at the pointer with its simple
// lines, and the panel on the right when it is clicked, with every column the AER lists for it,
// asked for when the panel opens (GET /api/v1/petroleum/pipelines/segment/:id).

/** The answer of the segment route (apps/api/src/petro-pipelines.ts, PipelineSegmentAnswer). */
export interface PipelineSegment {
  id: number;
  segmentId: string | null;
  licence: string;
  line: string | null;
  federal: boolean;
  licensee: { code: string | null; name: string | null } | null;
  status: string | null;
  substances: string[];
  from: { facility: string | null; location: string | null };
  to: { facility: string | null; location: string | null };
  lengthKm: string | null;
  diameterMm: string | null;
  wallMm: string | null;
  material: string | null;
  pipeType: string | null;
  pipeGrade: string | null;
  maxPressure: string | null;
  h2s: string | null;
  fieldCentre: string | null;
  licenceApproved: string | null;
  lastOccurrenceYear: number | null;
  geometrySource: string | null;
  bounds: [number, number, number, number];
}

const groupName = (group: PipelineSubstance) =>
  PIPELINE_SUBSTANCES.find((s) => s.key === group)?.name ?? 'Other';

/**
 * The nominal pipe size the trade calls a pipe by, from its outside diameter in millimetres, as
 * the standard pipe schedule (ASME B36.10M) pairs them: a 219.1 mm pipe is "8-inch", though it is
 * 8.6 inches across.
 */
const NOMINAL: Record<string, string> = {
  '21.3': '½',
  '26.7': '¾',
  '33.4': '1',
  '42.2': '1¼',
  '48.3': '1½',
  '60.3': '2',
  '73': '2½',
  '88.9': '3',
  '101.6': '3½',
  '114.3': '4',
  '141.3': '5',
  '168.3': '6',
  '219.1': '8',
  '273.1': '10',
  '323.9': '12',
  '355.6': '14',
  '406.4': '16',
  '457': '18',
  '508': '20',
  '559': '22',
  '610': '24',
  '660': '26',
  '711': '28',
  '762': '30',
  '813': '32',
  '864': '34',
  '914': '36',
  '1067': '42',
  '1219': '48',
};

/** A diameter in millimetres with its nominal size when it has one: "508 mm (20-inch)". */
export function pipeSize(mm: number | string | null): string {
  if (mm === null) return '—';
  const n = typeof mm === 'number' ? mm : Number(mm);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const nominal = NOMINAL[String(n)];
  return nominal ? `${String(n)} mm (${nominal}-inch)` : `${String(n)} mm`;
}

/** The colour of a status's badge: the line's own while in use, grey once out of use. */
const badgeColour = (status: string | null, colour: string) =>
  pipelineStrength(status) === 1 ? colour : '#78716c';

export function PipelineTip({ pipeline }: { pipeline: PipelineEntry | null }) {
  if (!pipeline) return null;
  return (
    <MapTip>
      <TipHead title={`Line ${pipeline.line}`} aside={pipeline.status} />
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="h-0.5 w-3 shrink-0"
          style={{ backgroundColor: PIPELINE_COLOURS[pipeline.group] }}
        />
        <span className="truncate">{pipeline.substance ?? groupName(pipeline.group)}</span>
        <span className="ml-auto shrink-0 font-mono">{pipeSize(pipeline.diameterMm)}</span>
      </p>
      {pipeline.licensee?.name && (
        <p className="mt-0.5 truncate text-xs">{pipeline.licensee.name}</p>
      )}
    </MapTip>
  );
}

/** The segment's details as answered; until an answer for the segment shown, it is loading. */
type Asked =
  | { state: 'found'; id: number; segment: PipelineSegment }
  | { state: 'failed'; id: number; text: string };

export function PipelinePanel({
  pipeline,
  member,
  fileDate,
  goTo,
  onClose,
}: {
  pipeline: PipelineEntry | null;
  member: { organizationId: string; token: string };
  fileDate: string | null;
  goTo: (bounds: MapBounds) => void;
  onClose: () => void;
}) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const id = pipeline?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    apiJson<PipelineSegment>(
      `/petroleum/pipelines/segment/${String(id)}?organization_id=${encodeURIComponent(member.organizationId)}`,
      member.token,
      { signal: controller.signal },
    )
      .then((segment) => {
        setAsked({ state: 'found', id, segment });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAsked({
          state: 'failed',
          id,
          text:
            error instanceof ApiError && error.code === 'NOT_FOUND'
              ? 'This segment is no longer loaded: the pipelines were loaded again. Click the line again.'
              : 'The segment’s details could not be loaded. Try again in a moment.',
        });
      });
    return () => {
      controller.abort();
    };
  }, [id, member.organizationId, member.token]);

  if (!pipeline) return null;
  const p = pipeline;
  const colour = PIPELINE_COLOURS[p.group];
  const found = asked?.state === 'found' && asked.id === p.id ? asked.segment : null;
  const failed = asked?.state === 'failed' && asked.id === p.id ? asked.text : null;
  const s = found;
  const place = (end: { facility: string | null; location: string | null }) => (
    <p>
      {end.facility ?? 'Not given'}
      {end.location && (
        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{end.location}</span>
      )}
    </p>
  );
  const row = (label: string, value: string | null) =>
    value === null ? null : (
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="text-right font-mono">{value}</dd>
      </div>
    );

  return (
    <MapPanel
      label={`Pipeline ${p.line}`}
      eyebrow={`Pipeline · ${groupName(p.group)}`}
      title={p.line}
      onClose={onClose}
    >
      <PanelBadge colour={badgeColour(p.status, colour)}>{p.status ?? 'No status'}</PanelBadge>
      <PanelTiles
        tiles={[
          {
            label: 'Size',
            value: p.diameterMm !== null ? `${String(p.diameterMm)} mm` : '—',
            title: pipeSize(p.diameterMm),
          },
          { label: 'Length', value: s?.lengthKm ? `${s.lengthKm} km` : '—' },
          { label: 'Licence', value: s?.licence ?? p.line.split('-')[0] ?? '—' },
        ]}
      />
      {s && (
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              const [w, so, e, n] = s.bounds;
              const pad = 0.003;
              goTo([w - pad, so - pad, e + pad, n + pad]);
            }}
          >
            Zoom to line
          </Button>
        </div>
      )}
      {!found && !failed && (
        <p className="mt-3 text-xs text-muted-foreground">Loading the segment’s details…</p>
      )}
      {failed && <p className="mt-3 text-xs text-destructive">{failed}</p>}
      <PanelSection title="Licensee">
        {p.licensee?.name ? (
          <p>
            {p.licensee.name}
            {p.licensee.code && (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {p.licensee.code}
              </span>
            )}
          </p>
        ) : (
          <p className="text-muted-foreground">Not given</p>
        )}
      </PanelSection>
      <PanelSection title="Carries">
        {(s?.substances ?? (p.substance ? [p.substance] : [])).map((name, i) => (
          <p key={`${name}-${String(i)}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-3 shrink-0"
              style={{ backgroundColor: PIPELINE_COLOURS[pipelineSubstanceOf(name)] }}
            />
            {name}
            {i === 0 && (s?.substances.length ?? 0) > 1 && (
              <span className="text-xs text-muted-foreground">ranked first by the AER</span>
            )}
          </p>
        ))}
      </PanelSection>
      {s && (
        <>
          <PanelSection title="From">{place(s.from)}</PanelSection>
          <PanelSection title="To">{place(s.to)}</PanelSection>
          <PanelSection title="Pipe">
            <dl className="flex flex-col gap-1 text-sm">
              {row('Outside diameter', s.diameterMm ? pipeSize(s.diameterMm) : null)}
              {row('Wall thickness', s.wallMm ? `${s.wallMm} mm` : null)}
              {row('Material', s.material)}
              {row('Type', s.pipeType)}
              {row('Grade', s.pipeGrade)}
              {row('Max. operating pressure', s.maxPressure)}
              {row('H2S content', s.h2s)}
            </dl>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Pressure and H2S content as the AER lists them: its layout gives no unit for either.
            </p>
          </PanelSection>
          <PanelSection title="Licence">
            <dl className="flex flex-col gap-1 text-sm">
              {row('Licence and line', p.line)}
              {row('Licensed', s.licenceApproved ? landDay(s.licenceApproved) : null)}
              {row(
                'Last built, tested or changed',
                s.lastOccurrenceYear !== null ? String(s.lastOccurrenceYear) : null,
              )}
              {row('AER field centre', s.fieldCentre)}
              {row('Where the line comes from', s.geometrySource)}
              {row('AER segment ID', s.segmentId)}
            </dl>
            {s.federal && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Marked by the AER as in the National Energy Board’s 80000 series.
              </p>
            )}
          </PanelSection>
        </>
      )}
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        The AER’s pipeline file{fileDate ? `, its file of ${landDay(fileDate)}` : ''}. Where the
        line is drawn is the AER’s best information, not a survey.
      </p>
    </MapPanel>
  );
}

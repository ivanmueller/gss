import {
  assignColours,
  DEFAULT_LAYER_COLOUR,
  featureFields,
  featureValueCounts,
  formatAlberta,
  MAP_LAYER_KIND_LABELS,
  normalizeFeatureCollection,
  OTHER_VALUES_COLOUR,
  groupingOf,
  railroadPreset,
  type LayerInspection,
  type LayerFeatureCollection,
  type MapLayerList,
  type MapLayerView,
} from '@grain/domain';
import { ChevronDown, ChevronRight, Layers, Map as MapIcon, Pencil, Plus } from 'lucide-react';
import { useId, useState, type ChangeEvent, type SubmitEvent } from 'react';

import { apiJson, sendJson } from '../lib/api';
import { hasFileColours, readLayerFile } from '../lib/mapLayers';
import { message, prepareWithProgress, takesOverview } from '../lib/mapLayerPrepare';
import { forgetApiAnswers, useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ImportArcgisMapForm } from './ArcgisMapImport';
import { panelEntries } from './MapLayers';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
import { FileButton } from './ui/file-button';
import { Input, Textarea } from './ui/input';
import { SegmentedControl } from './ui/segmented-control';
import { Select } from './ui/select';

// Map layers on the Team page, for admins (the owner's answers of 2026-11-07, F-107): add a
// layer from a web address (ArcGIS or a WMS map service) or a file (GeoJSON, KML or a zipped
// shapefile), with its source and terms of use; change its name, terms and colours (F-135);
// prepare a live layer's zoomed-out view (F-134); remove one (kept, not deleted). Everyone
// switches layers on and off on the Workspace map and Counterparties → map view.

const NO_FIELD = '';
const PREVIEW = 8;

function ColourPreview({ colours }: { colours: [string, string][] }) {
  if (colours.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {colours.slice(0, PREVIEW).map(([value, colour]) => (
        <span key={value} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="h-1 w-4 rounded-full"
            style={{ backgroundColor: colour }}
          />
          {value}
        </span>
      ))}
      <span>
        {colours.length.toLocaleString('en-CA')} values, each its own colour (the most common
        first).
      </span>
    </p>
  );
}

/** The colour of a layer in one colour. */
function ColourPicker({
  id,
  colour,
  onChange,
}: {
  id: string;
  colour: string;
  onChange: (colour: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="font-medium">
        Colour
      </label>
      <input
        id={id}
        type="color"
        value={colour}
        className="h-8 w-12 cursor-pointer rounded-control border bg-background"
        onChange={(event) => {
          onChange(event.target.value.toLowerCase());
        }}
      />
    </div>
  );
}

/** A layer's shared fields and limit (F-137). */
interface Shared {
  alsoFields: string[];
  onlyField: string | null;
  onlyValues: string[];
}

const NO_SHARED: Shared = { alsoFields: [], onlyField: null, onlyValues: [] };

/** The limit's values as typed ("M, I"), tidied. */
function parseOnlyValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    ),
  ];
}

/**
 * Lines counted for more than their first owner, and a limit to some features (F-137): a button
 * for the publisher's own railroad settings when the layer has their fields, and the fields to
 * choose from otherwise.
 */
function SharedSettings({
  id,
  fields,
  colourField,
  shared,
  disabled,
  onChange,
  onPreset,
}: {
  id: string;
  fields: readonly string[];
  colourField: string | null;
  shared: Shared;
  disabled: boolean;
  onChange: (shared: Shared) => void;
  onPreset: (preset: NonNullable<ReturnType<typeof railroadPreset>>) => void;
}) {
  const preset = railroadPreset(fields);
  const [values, setValues] = useState(shared.onlyValues.join(', '));
  const others = fields.filter((f) => f !== colourField);
  const summary = [
    shared.alsoFields.length > 0 ? `also counts ${shared.alsoFields.join(', ')}` : null,
    shared.onlyField !== null
      ? `only where ${shared.onlyField} is ${shared.onlyValues.join(' or ')}`
      : null,
  ].filter((part) => part !== null);
  return (
    <fieldset className="flex flex-col gap-2 rounded-control border p-3">
      <legend className="px-1 font-medium">Shared track and limits (optional)</legend>
      {preset && (
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={disabled}
            onClick={() => {
              setValues(preset.onlyValues.join(', '));
              onPreset(preset);
            }}
          >
            Use ArcGIS’s railroad settings
          </Button>
          <p className="text-xs text-muted-foreground">
            As the publisher’s own railroad maps: a railroad’s lines include track it co-owns
            (RROWNER2, RROWNER3) or has the right to run on (TRKRGHTS1 to 9); main lines and
            industry track only (NET is M or I).
          </p>
        </div>
      )}
      <p className="text-xs">
        {summary.length > 0
          ? `Now: ${summary.join('; ')}.`
          : 'Now: each line counts for its colour field only.'}
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer">Choose the fields yourself</summary>
        <div className="flex flex-col gap-2 pt-2">
          {colourField !== null && (
            <div className="flex flex-col gap-1">
              <span className="font-medium">Also count lines under</span>
              <div className="grid max-h-40 grid-cols-2 gap-x-3 overflow-y-auto">
                {others.map((f) => (
                  <label key={f} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      disabled={disabled}
                      checked={shared.alsoFields.includes(f)}
                      onChange={() => {
                        const also = shared.alsoFields.includes(f)
                          ? shared.alsoFields.filter((x) => x !== f)
                          : [...shared.alsoFields, f];
                        onChange({ ...shared, alsoFields: also.slice(0, 16) });
                      }}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1" htmlFor={`${id}-only-field`}>
              <span className="font-medium">Only where</span>
              <Select
                id={`${id}-only-field`}
                className="w-40"
                value={shared.onlyField ?? NO_FIELD}
                disabled={disabled}
                onValueChange={(value) => {
                  const onlyField = value === NO_FIELD ? null : value;
                  onChange({
                    ...shared,
                    onlyField,
                    onlyValues: onlyField === null ? [] : parseOnlyValues(values),
                  });
                }}
                options={[
                  { value: NO_FIELD, label: 'Every feature' },
                  ...fields.map((f) => ({ value: f, label: f })),
                ]}
              />
            </label>
            {shared.onlyField !== null && (
              <label className="flex flex-col gap-1" htmlFor={`${id}-only-values`}>
                <span className="font-medium">is one of</span>
                <Input
                  id={`${id}-only-values`}
                  className="h-8 w-32"
                  value={values}
                  placeholder="M, I"
                  disabled={disabled}
                  onChange={(event) => {
                    setValues(event.target.value);
                  }}
                  onBlur={() => {
                    onChange({ ...shared, onlyValues: parseOnlyValues(values) });
                  }}
                />
              </label>
            )}
          </div>
        </div>
      </details>
    </fieldset>
  );
}

/**
 * Changing a layer (F-135): its name, source and terms, and its colours. Changing Colour by
 * counts the new field's values; a live lines layer's zoomed-out view is prepared again for it.
 */
function EditMapLayerForm({
  layer,
  session,
  onSaved,
}: {
  layer: MapLayerView;
  session: DirectorySession;
  onSaved: () => void;
}) {
  const { token, organization } = session;
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const query = `?organization_id=${organization.id}`;
  const [name, setName] = useState(layer.name);
  const [sourceName, setSourceName] = useState(layer.sourceName);
  const [termsUrl, setTermsUrl] = useState(layer.termsUrl);
  const [termsNote, setTermsNote] = useState(layer.termsNote);
  const [wmsLayers, setWmsLayers] = useState(layer.wmsLayers ?? '');
  const [colour, setColour] = useState(layer.colour);
  const [colourField, setColourField] = useState(layer.colourField ?? NO_FIELD);
  const [colours, setColours] = useState<[string, string][]>(layer.colours);
  const [shared, setShared] = useState<Shared>({
    alsoFields: layer.alsoFields,
    onlyField: layer.onlyField,
    onlyValues: layer.onlyValues,
  });
  const [fields, setFields] = useState<string[] | null>(null);
  const [file, setFile] = useState<LayerFeatureCollection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const colourable = layer.kind === 'arcgis_features' || layer.kind === 'file';

  // The fields it can be coloured by: from the service, or from the kept file.
  function loadFields() {
    if (fields !== null || !colourable) return;
    setBusy('Reading its fields…');
    const load =
      layer.kind === 'file'
        ? apiJson<unknown>(`/map-layers/${layer.id}/file`, token).then((body) => {
            const checked = normalizeFeatureCollection(body);
            if (!checked.ok) throw new Error(checked.message);
            setFile(checked.collection);
            return featureFields(checked.collection);
          })
        : sendJson<LayerInspection>(`/map-layers/inspect${query}`, token, 'POST', {
            url: layer.url,
            field: null,
          }).then((answer) => answer.fields);
    load
      .then(setFields)
      .catch((reason: unknown) => {
        setProblem(message(reason, 'Its fields could not be read.'));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  /** Counts the values to colour by, with the fields that also count, within the limit. */
  function recount(value: string, settings: Shared) {
    setColours([]);
    if (value === NO_FIELD) return;
    if (layer.kind === 'file' && file) {
      setColours(assignColours(featureValueCounts(file, value)));
      return;
    }
    setBusy('Counting its values…');
    sendJson<LayerInspection>(`/map-layers/inspect${query}`, token, 'POST', {
      url: layer.url,
      field: value,
      ...settings,
    })
      .then((answer) => {
        setColours(assignColours(answer.values ?? []));
      })
      .catch((reason: unknown) => {
        setProblem(message(reason, 'Its values could not be counted.'));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function chooseField(value: string) {
    setColourField(value);
    const settings = value === NO_FIELD ? NO_SHARED : shared;
    setShared(settings);
    recount(value, settings);
  }

  function changeShared(settings: Shared, field = colourField) {
    setShared(settings);
    recount(field, settings);
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = colourField === NO_FIELD ? null : colourField;
    setBusy('Saving…');
    setProblem(null);
    sendJson(`/map-layers/${layer.id}`, token, 'PATCH', {
      version: layer.version,
      name: name.trim(),
      sourceName: sourceName.trim(),
      termsUrl: termsUrl.trim(),
      termsNote: termsNote.trim(),
      wmsLayers: layer.kind === 'wms' ? wmsLayers.trim() : null,
      colour: chosen === null ? colour : OTHER_VALUES_COLOUR,
      colourField: chosen,
      colours: chosen === null ? [] : colours,
      ...(chosen === null ? NO_SHARED : shared),
    })
      .then(async () => {
        forgetApiAnswers('/map-layers');
        // Its zoomed-out view is built under its settings: prepared again when they change.
        const saved = {
          id: layer.id,
          colourField: chosen,
          ...(chosen === null ? NO_SHARED : shared),
        };
        if (takesOverview(layer.kind) && layer.overview?.grouping !== groupingOf(saved)) {
          const failed = await prepareWithProgress(saved, token, setBusy);
          if (failed !== null) {
            setProblem(
              `Saved. Its zoomed-out view could not be prepared again: ${failed} Try again with Prepare zoomed-out view in the list.`,
            );
            return;
          }
        }
        onSaved();
      })
      .catch((reason: unknown) => {
        setProblem(message(reason, 'The layer could not be saved.'));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  return (
    <form className="flex flex-col gap-4 text-sm" onSubmit={save}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={field('name')} className="font-medium">
          Name
        </label>
        <Input
          id={field('name')}
          value={name}
          maxLength={200}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      {layer.kind === 'wms' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('wms')} className="font-medium">
            WMS layer names
          </label>
          <Input
            id={field('wms')}
            value={wmsLayers}
            onChange={(event) => {
              setWmsLayers(event.target.value);
            }}
          />
        </div>
      )}
      <fieldset className="flex flex-col gap-3 rounded-control border p-3">
        <legend className="px-1 font-medium">Source and terms of use</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('source')}>Published by</label>
          <Input
            id={field('source')}
            value={sourceName}
            maxLength={200}
            onChange={(event) => {
              setSourceName(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('terms-url')}>Link to its terms of use</label>
          <Input
            id={field('terms-url')}
            type="url"
            value={termsUrl}
            onChange={(event) => {
              setTermsUrl(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('terms-note')}>What the terms allow</label>
          <Textarea
            id={field('terms-note')}
            value={termsNote}
            maxLength={2000}
            rows={3}
            onChange={(event) => {
              setTermsNote(event.target.value);
            }}
          />
        </div>
      </fieldset>
      {colourable && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('colour-field')} className="font-medium">
            Colour by
          </label>
          {fields === null ? (
            <div className="flex items-center gap-2">
              <span>{layer.colourField ?? 'One colour'}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={loadFields}
              >
                Change
              </Button>
            </div>
          ) : (
            <Select
              id={field('colour-field')}
              value={colourField}
              onValueChange={chooseField}
              disabled={busy !== null}
              options={[
                { value: NO_FIELD, label: 'One colour' },
                ...fields.map((f) => ({ value: f, label: f })),
              ]}
            />
          )}
          <ColourPreview colours={colourField === NO_FIELD ? [] : colours} />
        </div>
      )}
      {layer.kind === 'arcgis_features' && fields !== null && (
        <SharedSettings
          id={field('shared')}
          fields={fields}
          colourField={colourField === NO_FIELD ? null : colourField}
          shared={shared}
          disabled={busy !== null}
          onChange={(settings) => {
            changeShared(settings);
          }}
          onPreset={({ colourField: presetField, ...settings }) => {
            setColourField(presetField);
            changeShared(settings, presetField);
          }}
        />
      )}
      {colourField === NO_FIELD && (
        <ColourPicker id={field('colour')} colour={colour} onChange={setColour} />
      )}
      {busy && (
        <p role="status" className="text-muted-foreground">
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            busy !== null ||
            name.trim() === '' ||
            sourceName.trim() === '' ||
            termsUrl.trim() === '' ||
            termsNote.trim() === '' ||
            (colourField !== NO_FIELD && colours.length === 0)
          }
        >
          Save
        </Button>
      </div>
    </form>
  );
}

type Source = 'web' | 'map' | 'file';

function AddMapLayerForm({ session, onAdded }: { session: DirectorySession; onAdded: () => void }) {
  const { token, organization } = session;
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const query = `?organization_id=${organization.id}`;
  const [source, setSource] = useState<Source>('web');
  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<LayerInspection | null>(null);
  const [file, setFile] = useState<{
    name: string;
    collection: LayerFeatureCollection;
    skipped: number;
    ownColours: boolean;
  } | null>(null);
  const [wmsLayers, setWmsLayers] = useState('');
  const [name, setName] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [termsNote, setTermsNote] = useState('');
  const [colour, setColour] = useState(DEFAULT_LAYER_COLOUR);
  const [colourField, setColourField] = useState(NO_FIELD);
  const [colours, setColours] = useState<[string, string][]>([]);
  const [shared, setShared] = useState<Shared>(NO_SHARED);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [addedWithProblem, setAddedWithProblem] = useState<string | null>(null);

  const fields =
    source === 'web' ? (inspection?.fields ?? []) : file ? featureFields(file.collection) : [];
  const ready = source === 'web' ? inspection !== null : file !== null;

  function inspect(chosenField: string | null, settings: Shared = NO_SHARED) {
    setBusy(chosenField === null ? 'Checking the address…' : 'Counting its values…');
    setProblem(null);
    return sendJson<LayerInspection>(`/map-layers/inspect${query}`, token, 'POST', {
      url,
      field: chosenField,
      ...settings,
    })
      .then((answer) => {
        setInspection(answer);
        if (chosenField === null) {
          if (name === '' && answer.title) setName(answer.title.slice(0, 200));
          if (termsNote === '' && answer.copyright) setTermsNote(answer.copyright);
          if (answer.wmsLayers) setWmsLayers(answer.wmsLayers);
          setColourField(NO_FIELD);
          setColours([]);
          setShared(NO_SHARED);
        } else {
          setColours(assignColours(answer.values ?? []));
        }
      })
      .catch((reason: unknown) => {
        setProblem(message(reason, 'The address could not be checked.'));
        if (chosenField === null) setInspection(null);
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function chooseField(value: string) {
    setColourField(value);
    setColours([]);
    const settings = value === NO_FIELD ? NO_SHARED : shared;
    setShared(settings);
    if (value === NO_FIELD) return;
    if (source === 'web') void inspect(value, settings);
    else if (file) setColours(assignColours(featureValueCounts(file.collection, value)));
  }

  function changeShared(settings: Shared, field = colourField) {
    setShared(settings);
    setColours([]);
    void inspect(field === NO_FIELD ? null : field, settings);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setBusy('Reading the file…');
    setProblem(null);
    setFile(null);
    setColourField(NO_FIELD);
    setColours([]);
    void readLayerFile(chosen)
      .then((result) => {
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        setFile({
          name: chosen.name.slice(0, 200),
          collection: result.collection,
          skipped: result.skipped,
          ownColours: hasFileColours(result),
        });
        if (name === '') setName(chosen.name.replace(/\.[^.]+$/, '').slice(0, 200));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const details = {
      name: name.trim(),
      sourceName: sourceName.trim(),
      termsUrl: termsUrl.trim(),
      termsNote: termsNote.trim(),
      // Coloured by a field, values without a colour of their own are grey (F-135).
      colour: colourField === NO_FIELD ? colour : OTHER_VALUES_COLOUR,
      colourField: colourField === NO_FIELD ? null : colourField,
      colours: colourField === NO_FIELD ? [] : colours,
      ...(colourField === NO_FIELD && shared.onlyField === null ? NO_SHARED : shared),
    };
    const body =
      source === 'web'
        ? {
            ...details,
            source: 'web',
            url,
            wmsLayers: inspection?.kind === 'wms' ? wmsLayers.trim() || null : null,
          }
        : { ...details, source: 'file', fileName: file?.name ?? '', geojson: file?.collection };
    setBusy('Saving…');
    setProblem(null);
    sendJson<{ id: string }>(`/map-layers${query}`, token, 'POST', body)
      .then(async ({ id: added }) => {
        forgetApiAnswers('/map-layers');
        // A live lines layer gets its zoomed-out view straight away (F-134).
        if (source === 'web' && inspection && takesOverview(inspection.kind)) {
          const failed = await prepareWithProgress(
            {
              id: added,
              colourField: details.colourField,
              alsoFields: details.alsoFields,
              onlyField: details.onlyField,
              onlyValues: details.onlyValues,
            },
            token,
            setBusy,
          );
          if (failed !== null) {
            setAddedWithProblem(
              `The layer was added. Its zoomed-out view could not be prepared: ${failed} Try again with Prepare zoomed-out view in the list.`,
            );
            return;
          }
        }
        onAdded();
      })
      .catch((reason: unknown) => {
        setProblem(message(reason, 'The layer could not be saved.'));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  if (addedWithProblem !== null) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p role="alert" className="text-warning">
          {addedWithProblem}
        </p>
        <div className="flex justify-end">
          <Button onClick={onAdded}>Done</Button>
        </div>
      </div>
    );
  }

  const sourceControl = (
    <SegmentedControl
      label="Where the layer comes from"
      options={[
        { value: 'web', label: 'Web address' },
        { value: 'map', label: 'ArcGIS map' },
        { value: 'file', label: 'File' },
      ]}
      value={source}
      onChange={(value) => {
        setSource(value);
        setProblem(null);
        setColourField(NO_FIELD);
        setColours([]);
      }}
    />
  );

  // A whole ArcGIS map's layers, as ArcGIS presents them (F-138).
  if (source === 'map') {
    return (
      <div className="flex flex-col gap-4 text-sm">
        {sourceControl}
        <ImportArcgisMapForm session={session} onAdded={onAdded} />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4 text-sm" onSubmit={save}>
      {sourceControl}

      {source === 'web' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('url')} className="font-medium">
            Web address
          </label>
          <div className="flex gap-2">
            <Input
              id={field('url')}
              value={url}
              placeholder="https://…/FeatureServer/0"
              onChange={(event) => {
                setUrl(event.target.value);
                setInspection(null);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || url.trim() === ''}
              onClick={() => void inspect(null)}
            >
              Check
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            An ArcGIS layer (ends in /FeatureServer, /MapServer or /ImageServer, often followed by a
            number) or a WMS map service, such as those on open.canada.ca.
          </p>
          {inspection && (
            <p role="status" className="text-xs">
              Found: {MAP_LAYER_KIND_LABELS[inspection.kind]}
              {inspection.title ? `, “${inspection.title}”` : ''}
              {inspection.count !== null
                ? `, ${inspection.count.toLocaleString('en-CA')} pieces${shared.onlyField !== null ? ' within its limit' : ''}`
                : ''}
              .
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">File</span>
          <FileButton
            accept=".geojson,.json,.kml,.zip"
            disabled={busy !== null}
            onChange={chooseFile}
          >
            Choose file
          </FileButton>
          <p className="text-xs text-muted-foreground">
            GeoJSON, KML, or a shapefile zipped with its .prj file. Up to 50,000 shapes; add a big
            national dataset by its web address instead.
          </p>
          {file && (
            <p role="status" className="text-xs">
              {file.name}: {file.collection.features.length.toLocaleString('en-CA')} shapes
              {file.skipped > 0
                ? ` (${file.skipped.toLocaleString('en-CA')} without a usable shape left out)`
                : ''}
              .
              {file.ownColours &&
                ' It has colours of its own, used unless you colour it by a field.'}
            </p>
          )}
        </div>
      )}

      {inspection?.kind === 'wms' && source === 'web' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('wms')} className="font-medium">
            WMS layer names
          </label>
          <Input
            id={field('wms')}
            value={wmsLayers}
            placeholder="e.g. crops:2025"
            onChange={(event) => {
              setWmsLayers(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            As the service lists them; separate several with commas.
          </p>
        </div>
      )}

      {ready && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('name')} className="font-medium">
              Name
            </label>
            <Input
              id={field('name')}
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>

          <fieldset className="flex flex-col gap-3 rounded-control border p-3">
            <legend className="px-1 font-medium">Source and terms of use</legend>
            <p className="text-xs text-muted-foreground">
              A layer is shown only with its source and terms recorded. Read the terms on the
              source’s page and say in a few words what they allow (for example “Public domain” or
              “Open Government Licence – Canada”).
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={field('source')}>Published by</label>
              <Input
                id={field('source')}
                value={sourceName}
                maxLength={200}
                onChange={(event) => {
                  setSourceName(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={field('terms-url')}>Link to its terms of use</label>
              <Input
                id={field('terms-url')}
                type="url"
                value={termsUrl}
                placeholder="https://…"
                onChange={(event) => {
                  setTermsUrl(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={field('terms-note')}>What the terms allow</label>
              <Textarea
                id={field('terms-note')}
                value={termsNote}
                maxLength={2000}
                rows={3}
                onChange={(event) => {
                  setTermsNote(event.target.value);
                }}
              />
            </div>
          </fieldset>

          {(source === 'file' || inspection?.kind === 'arcgis_features') && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={field('colour-field')} className="font-medium">
                Colour by
              </label>
              <Select
                id={field('colour-field')}
                value={colourField}
                onValueChange={chooseField}
                disabled={busy !== null}
                options={[
                  { value: NO_FIELD, label: 'One colour' },
                  ...fields.map((f) => ({ value: f, label: f })),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Choose a field to give each of its values its own colour, such as each railroad by
                its owner (RROWNER1 on North American Rail Network Lines). Values without a colour
                of their own are grey.
              </p>
              <ColourPreview colours={colourField === NO_FIELD ? [] : colours} />
            </div>
          )}

          {source === 'web' && inspection?.kind === 'arcgis_features' && (
            <SharedSettings
              id={field('shared')}
              fields={fields}
              colourField={colourField === NO_FIELD ? null : colourField}
              shared={shared}
              disabled={busy !== null}
              onChange={(settings) => {
                changeShared(settings);
              }}
              onPreset={({ colourField: presetField, ...settings }) => {
                setColourField(presetField);
                changeShared(settings, presetField);
              }}
            />
          )}

          {colourField === NO_FIELD && (
            <ColourPicker id={field('colour')} colour={colour} onChange={setColour} />
          )}
        </>
      )}

      {busy && (
        <p role="status" className="text-muted-foreground">
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            !ready ||
            busy !== null ||
            name.trim() === '' ||
            sourceName.trim() === '' ||
            termsUrl.trim() === '' ||
            termsNote.trim() === '' ||
            (colourField !== NO_FIELD && colours.length === 0)
          }
        >
          Add layer
        </Button>
      </div>
    </form>
  );
}

function LayerRow({
  layer,
  session,
  onChanged,
  inMap = false,
  selected,
}: {
  layer: MapLayerView;
  session: DirectorySession;
  onChanged: () => void;
  /** Listed under its ArcGIS map, which shows the map, source and terms once (F-142). */
  inMap?: boolean;
  /** Its tick box under its map, to remove only some of the map's layers (F-142). */
  selected?: { checked: boolean; onChange: () => void };
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const overview = layer.overview?.grouping === groupingOf(layer) ? layer.overview : null;

  function prepare() {
    setProblem(null);
    void prepareWithProgress(layer, session.token, setPreparing).then((failed) => {
      setPreparing(null);
      if (failed !== null) setProblem(failed);
      else {
        forgetApiAnswers('/map-layers');
        onChanged();
      }
    });
  }

  function remove() {
    setBusy(true);
    setProblem(null);
    sendJson(`/map-layers/${layer.id}/remove`, session.token, 'POST', { version: layer.version })
      .then(() => {
        forgetApiAnswers('/map-layers');
        onChanged();
      })
      .catch((reason: unknown) => {
        setProblem(message(reason, 'The layer could not be removed.'));
        setBusy(false);
      });
  }

  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          {selected && (
            <input
              type="checkbox"
              className="size-4 accent-primary"
              aria-label={`Select ${layer.name}`}
              checked={selected.checked}
              onChange={selected.onChange}
            />
          )}
          <span
            aria-hidden="true"
            className="size-3 rounded-full"
            style={{ backgroundColor: layer.colours[0]?.[1] ?? layer.colour }}
          />
          {layer.name}
        </span>
        {confirming ? (
          <span className="flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
              Remove for everyone
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </Button>
          </span>
        ) : (
          <span className="flex gap-2">
            <Dialog open={editing} onOpenChange={setEditing}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </DialogTrigger>
              <DialogContent title={`Edit ${layer.name}`}>
                <EditMapLayerForm
                  layer={layer}
                  session={session}
                  onSaved={() => {
                    setEditing(false);
                    onChanged();
                  }}
                />
              </DialogContent>
            </Dialog>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Remove
            </Button>
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {MAP_LAYER_KIND_LABELS[layer.kind]}
        {layer.fileName !== null &&
          ` · ${layer.fileName}, ${(layer.featureCount ?? 0).toLocaleString('en-CA')} shapes`}
        {layer.colourField !== null &&
          ` · coloured by ${layer.colourField} (${layer.colours.length.toLocaleString('en-CA')} values)`}
        {layer.alsoFields.length > 0 && ` · also counts ${layer.alsoFields.join(', ')}`}
        {layer.onlyField !== null &&
          ` · only where ${layer.onlyField} is ${layer.onlyValues.join(' or ')}`}
        {layer.definitionExpression !== null && ` · only where ${layer.definitionExpression}`}
      </span>
      {layer.map !== null && !inMap && (
        <span className="text-xs text-muted-foreground">
          From the ArcGIS map{' '}
          <a
            href={`https://www.arcgis.com/home/item.html?id=${layer.map.itemId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {layer.map.title}
          </a>
          , drawn as ArcGIS shows it
          {layer.lineWidth !== null && ` (lines ${String(layer.lineWidth)} pt`}
          {layer.lineWidth !== null && layer.opacity < 1 && ', '}
          {layer.lineWidth === null && layer.opacity < 1 && ' ('}
          {layer.opacity < 1 && `${String(Math.round(layer.opacity * 100))}% opaque`}
          {(layer.lineWidth !== null || layer.opacity < 1) && ')'}.
        </span>
      )}
      {layer.url !== null && (
        // Which service exactly: a publisher's per-railroad views share one name (2026-11-07).
        <span className="text-xs break-all text-muted-foreground">{layer.url}</span>
      )}
      {!inMap && (
        <>
          <span className="text-xs text-muted-foreground">
            Source:{' '}
            <a
              href={layer.termsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {layer.sourceName}
            </a>{' '}
            · {layer.termsNote}
          </span>
          <span className="text-xs text-muted-foreground">
            Added by {layer.createdByName}, {formatAlberta(layer.createdAt)}.
          </span>
        </>
      )}
      {takesOverview(layer.kind) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {overview
              ? `Zoomed-out view: ${overview.featureCount.toLocaleString('en-CA')} lines from ${overview.sourceCount.toLocaleString('en-CA')} pieces, prepared by ${overview.preparedByName}, ${formatAlberta(overview.preparedAt)}.`
              : 'No zoomed-out view yet: zoomed out, only part of this layer shows.'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={preparing !== null}
            onClick={prepare}
          >
            {overview ? 'Prepare again' : 'Prepare zoomed-out view'}
          </Button>
        </div>
      )}
      {preparing && (
        <p role="status" className="text-xs text-muted-foreground">
          {preparing}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * An ArcGIS map's layers under one entry (the owner's request of 2026-11-09, F-142): the map's
 * title, how many layers, its source and terms once, and **Remove map**; opened, each layer with
 * a tick box, and **Remove selected**. Removing asks first; removed layers are kept, never
 * deleted.
 */
function MapLayerGroup({
  itemId,
  title,
  layers,
  session,
  onChanged,
}: {
  itemId: string;
  title: string;
  layers: MapLayerView[];
  session: DirectorySession;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirming, setConfirming] = useState<'all' | 'selected' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const first = layers[0];
  const chosen = layers.filter((layer) => selected.has(layer.id));
  const count = (n: number) => `${n.toLocaleString('en-CA')} ${n === 1 ? 'layer' : 'layers'}`;

  function remove(which: MapLayerView[]) {
    setProblem(null);
    void (async () => {
      const failed: string[] = [];
      for (const [i, layer] of which.entries()) {
        setBusy(`Removing ${String(i + 1)} of ${String(which.length)}: ${layer.name}…`);
        try {
          await sendJson(`/map-layers/${layer.id}/remove`, session.token, 'POST', {
            version: layer.version,
          });
        } catch (reason) {
          failed.push(`${layer.name}: ${message(reason, 'not removed.')}`);
        }
      }
      setBusy(null);
      setConfirming(null);
      setSelected(new Set());
      forgetApiAnswers('/map-layers');
      if (failed.length > 0) setProblem(`Not all were removed. ${failed.join(' ')}`);
      onChanged();
    })();
  }

  if (!first) return null;
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 font-medium">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the layers of ${title}`}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
          <MapIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            · {count(layers.length)}
          </span>
        </span>
        {confirming === 'all' ? (
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                remove(layers);
              }}
            >
              Remove all {count(layers.length)} for everyone
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setConfirming(null);
              }}
            >
              Keep
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => {
              setConfirming('all');
            }}
          >
            Remove map
          </Button>
        )}
      </div>
      <span className="pl-9 text-xs text-muted-foreground">
        ArcGIS map{' '}
        <a
          href={`https://www.arcgis.com/home/item.html?id=${itemId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {title}
        </a>
        , each layer drawn as ArcGIS shows it.
      </span>
      <span className="pl-9 text-xs text-muted-foreground">
        Source:{' '}
        <a
          href={first.termsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {first.sourceName}
        </a>{' '}
        · {first.termsNote}
      </span>
      <span className="pl-9 text-xs text-muted-foreground">
        Added by {first.createdByName}, {formatAlberta(first.createdAt)}.
      </span>
      {open && (
        <div className="flex flex-col gap-2 pl-9">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {chosen.length.toLocaleString('en-CA')} selected
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setSelected(new Set(layers.map((layer) => layer.id)));
              }}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              Select none
            </Button>
            {chosen.length > 0 &&
              (confirming === 'selected' ? (
                <span className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      remove(chosen);
                    }}
                  >
                    Remove {count(chosen.length)} for everyone
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      setConfirming(null);
                    }}
                  >
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirming('selected');
                  }}
                >
                  Remove selected
                </Button>
              ))}
          </div>
          <ul aria-label={`${title}: layers`}>
            {layers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                session={session}
                onChanged={onChanged}
                inMap
                selected={{
                  checked: selected.has(layer.id),
                  onChange: () => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(layer.id)) next.delete(layer.id);
                      else next.add(layer.id);
                      return next;
                    });
                  },
                }}
              />
            ))}
          </ul>
        </div>
      )}
      {busy && (
        <p role="status" className="pl-9 text-xs text-muted-foreground">
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="pl-9 text-xs text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

export function MapLayerSettings({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [list, reload] = useApiResource<MapLayerList>(
    `/map-layers?organization_id=${organization.id}`,
    token,
  );

  return (
    <Card asChild>
      <section aria-labelledby={`${id}-heading`}>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle id={`${id}-heading`} className="flex items-center gap-2">
            <Layers aria-hidden="true" className="size-4" />
            Map layers
          </CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus aria-hidden="true" />
                Add map layer
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Add map layer"
              description="From a web address (ArcGIS or a WMS map service) or a file. Everyone can switch it on under Layers on the Workspace map and Counterparties → map view."
            >
              <AddMapLayerForm
                session={session}
                onAdded={() => {
                  setOpen(false);
                  reload();
                }}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="text-sm">
          {list.status === 'error' ? (
            <p role="alert" className="text-danger">
              Could not load the map layers: {list.error.message}
            </p>
          ) : list.status === 'loading' ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : list.data.layers.length === 0 ? (
            <p className="text-muted-foreground">
              No map layers yet. Add one from a web address or a file; everyone can then switch it
              on under Layers on the Workspace map and Counterparties → map view.
            </p>
          ) : (
            <ul>
              {/* A map's layers under one entry, top first as ArcGIS lists them (F-142). */}
              {panelEntries(list.data.layers).map((entry) =>
                entry.kind === 'layer' ? (
                  <LayerRow
                    key={entry.layer.id}
                    layer={entry.layer}
                    session={session}
                    onChanged={reload}
                  />
                ) : (
                  <MapLayerGroup
                    key={`map-${entry.itemId}`}
                    itemId={entry.itemId}
                    title={entry.title}
                    layers={entry.layers}
                    session={session}
                    onChanged={reload}
                  />
                ),
              )}
            </ul>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

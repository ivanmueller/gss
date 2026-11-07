import {
  assignColours,
  DEFAULT_LAYER_COLOUR,
  featureFields,
  featureValueCounts,
  formatAlberta,
  MAP_LAYER_KIND_LABELS,
  normalizeFeatureCollection,
  OTHER_VALUES_COLOUR,
  type LayerInspection,
  type LayerFeatureCollection,
  type MapLayerList,
  type MapLayerView,
} from '@grain/domain';
import { Layers, Pencil, Plus } from 'lucide-react';
import { useId, useState, type ChangeEvent, type SubmitEvent } from 'react';

import { ApiError, apiJson, sendJson } from '../lib/api';
import { hasFileColours, readLayerFile } from '../lib/mapLayers';
import { prepareOverview } from '../lib/mapOverview';
import { forgetApiAnswers, useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
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

/** A live lines layer takes a zoomed-out view (F-134). */
function takesOverview(kind: MapLayerView['kind']): boolean {
  return kind === 'arcgis_features';
}

/**
 * Prepares a layer's zoomed-out view, saying how far it has got; resolves to an error message, or
 * null when done.
 */
async function prepareWithProgress(
  layer: Pick<MapLayerView, 'id' | 'colourField'>,
  token: string,
  say: (text: string) => void,
): Promise<string | null> {
  say('Preparing the zoomed-out view…');
  try {
    await prepareOverview(layer, token, ({ read, total }) => {
      say(
        `Preparing the zoomed-out view: ${read.toLocaleString('en-CA')} of ${total.toLocaleString('en-CA')} pieces read…`,
      );
    });
    return null;
  } catch (reason) {
    return message(reason, 'The zoomed-out view could not be prepared.');
  }
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

/** The colours chosen for a layer's values, previewed. */
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

  function chooseField(value: string) {
    setColourField(value);
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
    })
      .then(async () => {
        forgetApiAnswers('/map-layers');
        // Its zoomed-out view is grouped by the field it is coloured by: prepared again.
        if (takesOverview(layer.kind) && layer.overview?.colourField !== chosen) {
          const failed = await prepareWithProgress(
            { id: layer.id, colourField: chosen },
            token,
            setBusy,
          );
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

type Source = 'web' | 'file';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [addedWithProblem, setAddedWithProblem] = useState<string | null>(null);

  const fields =
    source === 'web' ? (inspection?.fields ?? []) : file ? featureFields(file.collection) : [];
  const ready = source === 'web' ? inspection !== null : file !== null;

  function inspect(chosenField: string | null) {
    setBusy(chosenField === null ? 'Checking the address…' : 'Counting its values…');
    setProblem(null);
    return sendJson<LayerInspection>(`/map-layers/inspect${query}`, token, 'POST', {
      url,
      field: chosenField,
    })
      .then((answer) => {
        setInspection(answer);
        if (chosenField === null) {
          if (name === '' && answer.title) setName(answer.title.slice(0, 200));
          if (termsNote === '' && answer.copyright) setTermsNote(answer.copyright);
          if (answer.wmsLayers) setWmsLayers(answer.wmsLayers);
          setColourField(NO_FIELD);
          setColours([]);
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
    if (value === NO_FIELD) return;
    if (source === 'web') void inspect(value);
    else if (file) setColours(assignColours(featureValueCounts(file.collection, value)));
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
            { id: added, colourField: details.colourField },
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

  return (
    <form className="flex flex-col gap-4 text-sm" onSubmit={save}>
      <SegmentedControl
        label="Where the layer comes from"
        options={[
          { value: 'web', label: 'Web address' },
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
              {inspection.title ? `, “${inspection.title}”` : ''}.
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
}: {
  layer: MapLayerView;
  session: DirectorySession;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const overview = layer.overview?.colourField === layer.colourField ? layer.overview : null;

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
      </span>
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
              {list.data.layers.map((layer) => (
                <LayerRow key={layer.id} layer={layer} session={session} onChanged={reload} />
              ))}
            </ul>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

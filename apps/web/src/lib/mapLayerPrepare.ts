import type { MapLayerView } from '@grain/domain';

import { ApiError } from './api';
import { prepareOverview, type OverviewLayer } from './mapOverview';

// Preparing a live layer's zoomed-out view with its progress in words (F-134), for Team → Map
// layers: after a layer is added by hand or from an ArcGIS map (F-138), and Prepare again.

/** A live lines layer takes a zoomed-out view (F-134). */
export function takesOverview(kind: MapLayerView['kind']): boolean {
  return kind === 'arcgis_features';
}

/**
 * Prepares a layer's zoomed-out view, saying how far it has got; resolves to an error message, or
 * null when done.
 */
export async function prepareWithProgress(
  layer: OverviewLayer,
  token: string,
  say: (text: string) => void,
): Promise<string | null> {
  say('Preparing the zoomed-out view…');
  // After it ends, a late message never sets the busy text again.
  let ended = false;
  try {
    await prepareOverview(layer, token, (progress) => {
      if (ended) return;
      const n = (value: number) => value.toLocaleString('en-CA');
      say(
        progress.stage === 'reading'
          ? `Preparing the zoomed-out view: ${n(progress.done)} of ${n(progress.total)} pieces read…`
          : progress.stage === 'joining'
            ? 'Preparing the zoomed-out view: joining the lines…'
            : `Preparing the zoomed-out view: saving part ${n(progress.done)} of ${n(progress.total)}…`,
      );
    });
    return null;
  } catch (reason) {
    return message(reason, 'The zoomed-out view could not be prepared.');
  } finally {
    ended = true;
  }
}

export function message(reason: unknown, fallback: string): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

/** The colours chosen for a layer's values, previewed. */

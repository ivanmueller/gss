import type { ExpressionSpecification } from 'mapbox-gl';

/**
 * Where the oil and gas map's detail (the wells' legs, the land held, the sale parcels) gives
 * way to the far-out view (F-260; the owner, 2026-11-21, by the distance bar and the mouse
 * wheel: it starts to fade on the second scroll after the bar reads 20 km, and is gone on the
 * second scroll after it reads 30 km). Around the Duvernay the bar turns to 20 km near zoom
 * 8.1 and to 30 km near zoom 7.5, and one notch of the wheel is about 0.15 of a zoom.
 */

/** The zoom at which the detail is gone, and under which it is neither drawn nor asked for. */
export const DETAIL_GONE = 7.3;
/** The zoom from which the detail is at full strength. */
export const DETAIL_FULL = 7.8;

/** An opacity that is nothing at DETAIL_GONE and `full` from DETAIL_FULL in. */
export function fadeIn(full: number | ExpressionSpecification): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], DETAIL_GONE, 0, DETAIL_FULL, full];
}

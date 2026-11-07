// shpjs ships no types; this is the one call the app makes (lib/mapLayers.ts).
declare module 'shpjs' {
  /** A zipped shapefile as GeoJSON: one collection, or one per shapefile in the zip. */
  export default function shp(data: ArrayBuffer): Promise<unknown>;
}

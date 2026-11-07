// arcgis-pbf-parser ships no types; this is the one call the app makes (lib/mapOverview.ts).
declare module 'arcgis-pbf-parser' {
  /** An ArcGIS query answer in PBF (f=pbf) as GeoJSON, quantized coordinates restored. */
  export default function decode(data: Uint8Array): {
    featureCollection: {
      type: 'FeatureCollection';
      features: {
        type: 'Feature';
        properties: Record<string, unknown> | null;
        geometry: { type: string; coordinates: unknown } | null;
      }[];
    };
    exceededTransferLimit?: boolean;
  };
}

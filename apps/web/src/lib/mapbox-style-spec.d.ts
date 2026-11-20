// Mapbox's style checker ships with mapbox-gl without a declaration for this path; only the one
// function the wells test uses (st37Map.test.ts).
declare module 'mapbox-gl/dist/style-spec/index.es.js' {
  export function validate(style: unknown): { message: string }[];
}

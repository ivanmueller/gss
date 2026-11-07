import { buildOverview, splitOverview, type MercatorLine } from '@grain/domain';

// Joins a layer's pieces into its zoomed-out view and splits it into parts, away from the page's
// own thread so the page stays responsive while it runs (Codex's review of 8e0fd95; see
// lib/mapOverview.ts).

export interface OverviewJob {
  groups: [string | null, MercatorLine[]][];
  field: string | null;
}

export interface OverviewResult {
  parts: ReturnType<typeof splitOverview>;
  features: number;
}

/** The work itself, also run in place where the browser has no workers (tests). */
export function runOverviewJob(job: OverviewJob): OverviewResult {
  const overview = buildOverview(new Map(job.groups), job.field);
  return { parts: splitOverview(overview), features: overview.features.length };
}

// In a worker, `self` receives the job and posts the result back.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<OverviewJob>) => void) | null;
  postMessage: (message: OverviewResult) => void;
  document?: unknown;
};
if (scope.document === undefined) {
  scope.onmessage = (event) => {
    scope.postMessage(runOverviewJob(event.data));
  };
}

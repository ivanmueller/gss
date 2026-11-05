// The sources of the Grains reference, each checked on the date shown. A fact names its
// source by id (types.ts, Citation) and where in it the fact was read.

export interface GrainSource {
  title: string;
  publisher: string;
  /** The edition or date the source gives itself, when it gives one. */
  edition?: string;
  url: string;
  /** When it was read for this reference (YYYY-MM-DD). */
  checked: string;
}

export const GRAIN_SOURCES = {
  'cgc-oggg': {
    title: 'Official Grain Grading Guide',
    publisher: 'Canadian Grain Commission',
    edition: 'August 1, 2026',
    url: 'https://www.grainscanada.gc.ca/en/grain-quality/official-grain-grading-guide/',
    checked: '2026-11-05',
  },
  'cgc-test-weight': {
    title: 'Test weight for Canadian grains',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-quality/grain-grading/grading-factors/test-weight-grain.html',
    checked: '2026-11-05',
  },
  'cgc-variety-lists': {
    title: 'Variety designation lists, 2026',
    publisher: 'Canadian Grain Commission',
    edition: '2026',
    url: 'https://www.grainscanada.gc.ca/en/grain-quality/variety-lists/',
    checked: '2026-11-05',
  },
  'asg-rvt-2026': {
    title: 'Regional variety trial tables, spring 2026',
    publisher: 'Alberta Seed Guide',
    edition: 'January 2026',
    url: 'https://www.seed.ab.ca/wp-content/uploads/2026/01/asg_spring2026_rvts_jan08.pdf',
    checked: '2026-11-05',
  },
  'cgc-barley-2025': {
    title: 'Quality of Canadian barley in\u00a02025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/barley/2025/harvest-quality-report-barley-2025.html',
    checked: '2026-11-05',
  },
  'cgc-canola-2025-export': {
    title: 'Quality of Canadian canola exports in 2025-2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/canola/2025/export-canola-2025-2026.html',
    checked: '2026-11-05',
  },
  'cgc-canola-2025': {
    title: 'Quality of Canadian canola 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/canola/2025/harvest-quality-report-canola-2025.html',
    checked: '2026-11-05',
  },
  'cgc-canola-2025-province-crop-district': {
    title: 'Quality of western Canadian canola by province and crop district data in\u00a02025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/canola/2025/province-crop-district.html',
    checked: '2026-11-05',
  },
  'cgc-canola-2026-export': {
    title: 'Quality of Canadian canola exports in 2026-2027',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/canola/2026/export-canola-2026-2027.html',
    checked: '2026-11-05',
  },
  'cgc-flaxseed-2025': {
    title: 'Quality of western Canadian flaxseed 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/flaxseed/2025/harvest-quality-report-flaxseed-2025.html',
    checked: '2026-11-05',
  },
  'cgc-lentils-2025': {
    title: 'Quality of western Canadian lentils\u00a02025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/lentils/2025/harvest-quality-report-lentils-2025.html',
    checked: '2026-11-05',
  },
  'cgc-mustard-2025': {
    title: 'Quality of western Canadian mustard seed 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/mustard/2025/harvest-quality-report-mustard-2025.html',
    checked: '2026-11-05',
  },
  'cgc-oats-2025': {
    title: 'Quality of western Canadian oats in\u00a02025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/oats/2025/harvest-quality-report-oats-2025.html',
    checked: '2026-11-05',
  },
  'cgc-peas-2025': {
    title: 'Quality of western Canadian peas\u00a02025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/peas/2025/harvest-quality-report-peas-2025.html',
    checked: '2026-11-05',
  },
  'cgc-soybean-food-2025': {
    title: 'Quality of Canadian food-type soybeans 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/soybean-food/2025/',
    checked: '2026-11-05',
  },
  'cgc-soybean-oilseed-2025-export': {
    title: 'Quality of Canadian oilseed-type soybean exports in 2025-2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/soybean-oilseed/2025/export-soybean-oilseed-2025-2026.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-export-cwad': {
    title: 'Quality of Canada Western Amber Durum wheat exports in 2025-2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/export-quality-cwad-wheat-2025-2026.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-export-cwrs': {
    title: 'Quality of Canada Western Red Spring wheat exports in 2025-2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/export-quality-cwrs-wheat-2025-2026.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-cesrw': {
    title: 'Quality of Canada Eastern Soft Red Winter wheat in 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/harvest-quality-report-cesrw-2025.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-ceww': {
    title: 'Quality of Canada Eastern White Winter wheat in 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/harvest-quality-report-ceww-2025.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-cwad': {
    title: 'Quality of Canada Western Amber Durum in 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/harvest-quality-report-cwad-2025.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2025-cwrs': {
    title: 'Quality of Canada Western Red Spring wheat in 2025',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2025/harvest-quality-report-cwrs-2025.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2026-cwad': {
    title: 'Quality of Canada Western Amber Durum in 2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2026/harvest-quality-report-cwad-2026.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-2026-cwrs': {
    title: 'Quality of Canada Western Red Spring wheat in 2026',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/2026/harvest-quality-report-cwrs-2026.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-protein-history-cwad': {
    title: 'Historical protein content for Canada Western Amber Durum wheat',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/averages/historical-protein-content-cwad-wheat.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-protein-history-cwrs-crop-region': {
    title: 'Historical protein content for Canada Western Red Spring wheat by crop region',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/averages/historical-protein-content-cwrs-wheat-crop-region.html',
    checked: '2026-11-05',
  },
  'cgc-wheat-protein-history-cwrs': {
    title: 'Historical protein content for Canada Western Red Spring wheat',
    publisher: 'Canadian Grain Commission',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/grain-harvest-export-quality/wheat/averages/historical-protein-content-cwrs-wheat.html',
    checked: '2026-11-05',
  },
  'cgc-acreage-2025-cereals': {
    title: 'Cereal varieties by acreage insured in 2025',
    publisher: 'Canadian Grain Commission',
    edition: '2025',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/statistics/varieties-by-acreage/cereal-varieties/varieties-2025-c-en.csv',
    checked: '2026-11-05',
  },
  'cgc-acreage-2025-other': {
    title: 'Oilseed, pulse and minor crop varieties by acreage insured in 2025',
    publisher: 'Canadian Grain Commission',
    edition: '2025',
    url: 'https://www.grainscanada.gc.ca/en/grain-research/statistics/varieties-by-acreage/oilseed-pulse-minor-varieties/varieties-2025-g-en.csv',
    checked: '2026-11-05',
  },
} as const satisfies Record<string, GrainSource>;

export type SourceId = keyof typeof GRAIN_SOURCES;

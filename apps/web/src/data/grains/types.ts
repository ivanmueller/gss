// The Grains reference (owner's request, 2026-11-05): every grain graded in Canada, its
// official classes and grades, its varieties and its quality, each fact with its source.
// Public reference information only, copied from the sources in sources.ts; nothing here is
// GSS's own data, and nothing is estimated or filled in from memory. Numbers stay strings,
// exactly as the source prints them: they are shown, never calculated with.

import type { CommodityCode } from '@grain/domain';

import type { SourceId } from './sources';

/** The tile colours of the table: one group per kind of crop. */
export type GrainFamily = 'wheat' | 'coarse' | 'oilseed' | 'pulse' | 'special';

/** Where a fact was read: the source and the chapter, table or section within it. */
export interface Citation {
  source: SourceId;
  /** E.g. "Chapter 7, Table 2" or "Table 1"; enough to find the line again. */
  where: string;
}

/** One labelled fact, e.g. "Standard of measure: kg/hL". */
export interface GrainFact extends Citation {
  label: string;
  value: string;
}

/** A table copied from a source: its columns and rows as printed. */
export interface GrainTable extends Citation {
  title: string;
  columns: string[];
  rows: string[][];
  /** The source's own footnote or remark, when the table needs it to be read correctly. */
  note?: string;
}

/** An official class (CGC), e.g. Canada Western Red Spring, with its designated varieties. */
export interface GrainClass {
  name: string;
  /** E.g. "CWRS". */
  abbreviation?: string;
  region?: 'Western' | 'Eastern';
  /** The grade names of the class, highest first, as the Official Grain Grading Guide names them. */
  grades?: string[];
  gradesCitation?: Citation;
  /** The varieties designated to the class, as the source lists them. */
  varieties?: string[];
  varietiesCitation?: Citation;
  facts?: GrainFact[];
  tables?: GrainTable[];
}

export interface Grain {
  /** The address of its page, e.g. "oats" for /grains/oats. */
  id: string;
  name: string;
  /** One or two letters for the tile, e.g. "Oa". */
  symbol: string;
  /** Its place in the table, from 1. */
  number: number;
  family: GrainFamily;
  /** Other names the source uses, e.g. "Rapeseed". */
  otherNames?: string[];
  /** GSS's commodities that are this grain, so their badges can open its page. */
  commodities: CommodityCode[];
  /** One or two key facts for the tile, by label from `facts`. */
  tileFacts?: string[];
  facts: GrainFact[];
  classes: GrainClass[];
  /** Grades, moisture, quality and trial tables. */
  tables: GrainTable[];
}

import { mergeOperators, type Operator, type OperatorSourceRow } from '@grain/domain';

import { PIPELINES_SCHEMA_VERSION } from './petro-pipelines';

/**
 * The operators route reads the wells, facilities and pipelines tables: it needs the schema
 * that has all three, the pipelines' (20261203010000).
 */
export const OPERATORS_SCHEMA_VERSION = PIPELINES_SCHEMA_VERSION;

export interface OperatorsAnswer {
  /** Every operator once, the largest first. */
  operators: Operator[];
}

export function operatorsAnswer(rows: readonly OperatorSourceRow[]): OperatorsAnswer {
  return { operators: mergeOperators(rows) };
}

import type { OperatorSourceRow } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * The operators of what is stored (F-302): the AER's wells by licensee name, its facilities by
 * operator and its pipelines by licensee, each with its business associate code where the
 * source has one, counted. Read as `petro_api` with the person's membership, as every other
 * oil and gas read; no table of its own.
 */
export interface OperatorsDatabase {
  operators(ctx: PetroleumContext): Promise<OperatorSourceRow[]>;
}

export function operatorQueries(sql: postgres.Sql): OperatorsDatabase {
  return {
    operators(ctx) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '15s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const rows = await tx<
          { source: OperatorSourceRow['source']; code: string | null; name: string; n: number }[]
        >`
          select 'wells' as source, null::text as code, licensee as name, count(*)::int as n
          from petro.st37_wells where licensee is not null group by licensee
          union all
          select 'facilities', operator_code, operator, count(*)::int
          from petro.facilities where operator is not null group by operator_code, operator
          union all
          select 'pipelines', licensee_code, licensee, count(*)::int
          from petro.pipelines where licensee is not null group by licensee_code, licensee`;
        return rows.map((r) => ({ source: r.source, code: r.code, name: r.name, count: r.n }));
      });
    },
  };
}

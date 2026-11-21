import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Monthly production by well (F-252 step 3; 20261124010000_petro_well_production.sql), from
 * Petrinex's public Conventional Volumetric Data. Loaded by hand by the "Load Petrinex
 * production" workflow; members only read. Volumes are in Petrinex's units: m3 for oil, water
 * and condensate, e3m3 for gas; null when the month's file has no line of that product.
 */

export interface ProductionMonth {
  /** "2026-08". */
  month: string;
  oil: number | null;
  gas: number | null;
  water: number | null;
  condensate: number | null;
}

export interface WellProductionMonth extends ProductionMonth {
  hours: number | null;
}

export interface FormationProductionMonth extends ProductionMonth {
  /** How many wells have a row this month. */
  wells: number;
}

export interface ProductionLoad {
  loadedAt: string;
  formation: string | null;
  firstMonth: string;
  lastMonth: string;
}

export interface ProductionDatabase {
  /** Members: the latest load and one well's months, oldest first. */
  wellProduction(
    ctx: PetroleumContext,
    uwi: string,
  ): Promise<{ load: ProductionLoad | null; months: WellProductionMonth[] }>;
  /** Members: the latest load and the production of one play's wells added up, by month. */
  formationProduction(
    ctx: PetroleumContext,
    formation: string,
  ): Promise<{ load: ProductionLoad | null; months: FormationProductionMonth[] }>;
}

interface LoadRow {
  loaded_at: Date;
  formation: string | null;
  first_month: string;
  last_month: string;
}

interface MonthRow {
  month: string;
  oil: string | null;
  gas: string | null;
  water: string | null;
  condensate: string | null;
}

const num = (value: string | null) => (value === null ? null : Number(value));

const volumes = (r: MonthRow): ProductionMonth => ({
  month: r.month,
  oil: num(r.oil),
  gas: num(r.gas),
  water: num(r.water),
  condensate: num(r.condensate),
});

async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '10s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

async function latestLoad(tx: postgres.TransactionSql): Promise<ProductionLoad | null> {
  const [load] = await tx<LoadRow[]>`
    select loaded_at, formation, to_char(first_month, 'YYYY-MM') as first_month,
           to_char(last_month, 'YYYY-MM') as last_month
    from petro.production_loads order by id desc limit 1`;
  return load
    ? {
        loadedAt: load.loaded_at.toISOString(),
        formation: load.formation,
        firstMonth: load.first_month,
        lastMonth: load.last_month,
      }
    : null;
}

export function productionQueries(sql: postgres.Sql): ProductionDatabase {
  return {
    wellProduction(ctx, uwi) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const load = await latestLoad(tx);
        const rows = await tx<(MonthRow & { hours: number | null })[]>`
          select to_char(month, 'YYYY-MM') as month, oil_m3 as oil, gas_e3m3 as gas,
                 water_m3 as water, condensate_m3 as condensate, hours
          from petro.well_production where uwi = ${uwi} order by month`;
        return { load, months: rows.map((r) => ({ ...volumes(r), hours: r.hours })) };
      });
    },
    formationProduction(ctx, formation) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const load = await latestLoad(tx);
        const rows = await tx<(MonthRow & { wells: number })[]>`
          select to_char(month, 'YYYY-MM') as month, sum(oil_m3) as oil, sum(gas_e3m3) as gas,
                 sum(water_m3) as water, sum(condensate_m3) as condensate, count(*)::int as wells
          from petro.well_production
          where uwi in (select uwi from petro.st37_wells where formation = ${formation})
          group by month order by month`;
        return { load, months: rows.map((r) => ({ ...volumes(r), wells: r.wells })) };
      });
    },
  };
}

import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Monthly production by well (F-252 step 3; 20261124010000_petro_well_production.sql), from
 * Petrinex's public Conventional Volumetric Data, with the water and gas injected into the wells
 * of a waterflood pool (F-300; 20261212010000_petro_well_injection.sql). Loaded by hand by the
 * "Load Petrinex production" workflow; members only read. Volumes are in Petrinex's units: m3
 * for oil, water and condensate, e3m3 for gas; null when the month's file has no line of that
 * product.
 */

export interface ProductionMonth {
  /** "2026-08". */
  month: string;
  oil: number | null;
  gas: number | null;
  water: number | null;
  condensate: number | null;
  /** Water injected, m3 (F-300). */
  waterInjected: number | null;
  /** Gas injected, e3m3 (F-300). */
  gasInjected: number | null;
}

export interface WellProductionMonth extends ProductionMonth {
  hours: number | null;
}

export interface FormationProductionMonth extends ProductionMonth {
  /** How many wells have a production row this month. */
  wells: number;
  /** How many wells took injection this month (F-300). */
  injectors: number;
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
  water_injected: string | null;
  gas_injected: string | null;
}

const num = (value: string | null) => (value === null ? null : Number(value));

const volumes = (r: MonthRow): ProductionMonth => ({
  month: r.month,
  oil: num(r.oil),
  gas: num(r.gas),
  water: num(r.water),
  condensate: num(r.condensate),
  waterInjected: num(r.water_injected),
  gasInjected: num(r.gas_injected),
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
        // A month is the well's production, its injection (F-300), or both; the hours are
        // those on production, else those injecting.
        const rows = await tx<(MonthRow & { hours: number | null })[]>`
          select to_char(coalesce(p.month, i.month), 'YYYY-MM') as month, p.oil_m3 as oil,
                 p.gas_e3m3 as gas, p.water_m3 as water, p.condensate_m3 as condensate,
                 i.water_m3 as water_injected, i.gas_e3m3 as gas_injected,
                 coalesce(p.hours, i.hours) as hours
          from (select * from petro.well_production where uwi = ${uwi}) p
          full join (select * from petro.well_injection where uwi = ${uwi}) i
            on i.month = p.month
          order by 1`;
        return { load, months: rows.map((r) => ({ ...volumes(r), hours: r.hours })) };
      });
    },
    formationProduction(ctx, formation) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const load = await latestLoad(tx);
        const rows = await tx<(MonthRow & { wells: number; injectors: number })[]>`
          with play as (select uwi from petro.st37_wells where formation = ${formation}),
          p as (
            select month, sum(oil_m3) as oil, sum(gas_e3m3) as gas, sum(water_m3) as water,
                   sum(condensate_m3) as condensate, count(*)::int as wells
            from petro.well_production where uwi in (select uwi from play) group by month
          ),
          i as (
            select month, sum(water_m3) as water_injected, sum(gas_e3m3) as gas_injected,
                   count(*)::int as injectors
            from petro.well_injection where uwi in (select uwi from play) group by month
          )
          select to_char(coalesce(p.month, i.month), 'YYYY-MM') as month, p.oil, p.gas, p.water,
                 p.condensate, i.water_injected, i.gas_injected,
                 coalesce(p.wells, 0) as wells, coalesce(i.injectors, 0) as injectors
          from p full join i on i.month = p.month
          order by 1`;
        return {
          load,
          months: rows.map((r) => ({ ...volumes(r), wells: r.wells, injectors: r.injectors })),
        };
      });
    },
  };
}

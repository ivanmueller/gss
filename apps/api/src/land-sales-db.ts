import type { LandShape } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';
import type { OutlineRing } from './play-outlines';
import type { St37Box } from './st37-db';

/**
 * Crown land sales (F-242; 20261127010000_petro_land_sales.sql): the parcels of the province's
 * public offerings of petroleum and natural gas rights, with their results. Loaded by hand by
 * the "Load land sales" workflow; members only read. Money is summed by the database and
 * handed on as text, never as a float.
 */

export interface LandSaleParcelRow {
  id: string;
  saleDate: string;
  contractNo: string;
  contractType: string | null;
  region: string | null;
  hectares: string | null;
  zone: string | null;
  land: string;
  inexact: boolean;
  /** The result as published (ACCEPTED, NO OFFERS ...); null until the sale has results. */
  status: string | null;
  bonus: string | null;
  dollarsPerHectare: string | null;
  buyers: string | null;
  /** The restriction codes that apply to it, separated by spaces (F-265); null for none. */
  restrictions: string | null;
  /** Its deeper rights reversion zone codes, the same way; null for none. */
  reversionZones: string | null;
  shape: LandShape;
}

export interface LandSaleLoad {
  loadedAt: string;
  firstSale: string;
  lastSale: string;
  area: St37Box;
  /**
   * Each sale's documents by sale date, as the load kept them from the department's page
   * (F-265): whatever the column holds, checked before any of it is sent on.
   */
  documents: unknown;
}

/**
 * What narrows the parcels: the hashes (md5) of the zones that include a play's rights, sales
 * from a date on and sales before a date: the page reads every year a few years at a time
 * (F-263), and asks for the totals of one sale (F-267). And a play's outline: the parcels and the totals
 * are then of the parcels lying inside it (F-264).
 */
export interface LandSaleFilter {
  zones: readonly string[] | null;
  since: string | null;
  until?: string | null;
  outline?: readonly OutlineRing[] | null;
}

export interface LandSaleSummary {
  /** Parcels with a result, those accepted, and their money and land. */
  offered: number;
  sold: number;
  bonus: string;
  hectaresSold: string;
  /** The bonus paid over the hectares sold; null when none sold. */
  averagePerHectare: string | null;
  highPerHectare: string | null;
  /** The next sale not held yet, with how many of its parcels are kept. */
  nextSale: { date: string; parcels: number } | null;
  /**
   * Every sale the rights keep a parcel of, the newest first, whatever the dates asked for:
   * how many of its parcels are kept, how many sold, and whether it has results (F-267).
   */
  sales: { date: string; parcels: number; sold: number; held: boolean }[];
  /** The bonus paid by quarter, over every year loaded (the filter's rights, not its date). */
  quarters: { quarter: string; bonus: string; sold: number }[];
}

export interface LandSalesDatabase {
  /**
   * Members: the latest load, and up to `limit` parcels whose box touches the view (one more
   * tells the caller the view holds more), the newest sales first.
   */
  landSales(
    ctx: PetroleumContext,
    box: St37Box,
    filter: LandSaleFilter,
    limit: number,
  ): Promise<{ load: LandSaleLoad | null; parcels: LandSaleParcelRow[] }>;
  /** Members: the totals of every parcel loaded that the filter keeps. */
  landSaleSummary(ctx: PetroleumContext, filter: LandSaleFilter): Promise<LandSaleSummary>;
}

async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '10s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

/**
 * A play's outline for a query (`with ${outlineRings(tx, filter)} select ...`): each ring read
 * once as a polygon, with the box around it, which rules most parcels out before the ring is
 * walked.
 */
const outlineRings = (tx: postgres.TransactionSql, filter: LandSaleFilter) => tx`
  outline as materialized (
    select o.hole, o.ring::polygon as ring, box(o.ring::polygon) as reach
    from jsonb_to_recordset((${JSON.stringify(filter.outline ?? [])}::text)::jsonb)
      as o(hole boolean, ring text))`;
/**
 * Whether a parcel lies inside the outline: the middle of its bounds is within an outer ring
 * and within no hole. Every parcel when there is no outline.
 */
const inOutline = (tx: postgres.TransactionSql, filter: LandSaleFilter) => tx`
  (${(filter.outline ?? null) === null}::boolean
   or (exists (select 1 from outline o
               where not o.hole and o.reach @> center(bounds) and o.ring @> center(bounds))
       and not exists (select 1 from outline o
                       where o.hole and o.reach @> center(bounds) and o.ring @> center(bounds))))`;

export function landSalesQueries(sql: postgres.Sql): LandSalesDatabase {
  return {
    landSales(ctx, box, filter, limit) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const [load] = await tx<
          {
            loaded_at: Date;
            first_sale: string;
            last_sale: string;
            west: string;
            south: string;
            east: string;
            north: string;
            documents: unknown;
          }[]
        >`
          select loaded_at, first_sale::text as first_sale, last_sale::text as last_sale,
                 west, south, east, north, documents
          from petro.land_sale_loads order by id desc limit 1`;
        const rows = await tx<
          {
            id: string;
            sale_date: string;
            contract_no: string;
            contract_type: string | null;
            region: string | null;
            hectares: string | null;
            zone: string | null;
            land: string;
            inexact: boolean;
            status: string | null;
            bonus: string | null;
            dollars_per_hectare: string | null;
            buyers: string | null;
            restrictions: string | null;
            reversion_zones: string | null;
            shape: LandShape;
          }[]
        >`
          with ${outlineRings(tx, filter)}
          select id::text as id, sale_date::text as sale_date, contract_no, contract_type, region,
                 hectares::text as hectares, zone, land, inexact, status, bonus::text as bonus,
                 dollars_per_hectare::text as dollars_per_hectare, buyers, restrictions,
                 reversion_zones, shape
          from petro.land_sale_parcels
          where bounds && box(point(${box.west}::float8, ${box.south}::float8),
                              point(${box.east}::float8, ${box.north}::float8))
            and (${filter.zones === null}::boolean
                 or md5(zone) in (select jsonb_array_elements_text(
                   (${JSON.stringify(filter.zones ?? [])}::text)::jsonb)))
            and (${filter.since}::date is null or sale_date >= ${filter.since}::date)
            and (${filter.until ?? null}::date is null or sale_date < ${filter.until ?? null}::date)
            and ${inOutline(tx, filter)}
          order by sale_date desc, contract_no
          limit ${limit + 1}`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                firstSale: load.first_sale,
                lastSale: load.last_sale,
                area: {
                  west: Number(load.west),
                  south: Number(load.south),
                  east: Number(load.east),
                  north: Number(load.north),
                },
                documents: load.documents,
              }
            : null,
          parcels: rows.map((r) => ({
            id: r.id,
            saleDate: r.sale_date,
            contractNo: r.contract_no,
            contractType: r.contract_type,
            region: r.region,
            hectares: r.hectares,
            zone: r.zone,
            land: r.land,
            inexact: r.inexact,
            status: r.status,
            bonus: r.bonus,
            dollarsPerHectare: r.dollars_per_hectare,
            buyers: r.buyers,
            restrictions: r.restrictions,
            reversionZones: r.reversion_zones,
            shape: r.shape,
          })),
        };
      });
    },
    landSaleSummary(ctx, filter) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        // The rights, and the play's outline when there is one: the totals are of the parcels
        // the map shows.
        const outline = outlineRings(tx, filter);
        const rights = tx`(${filter.zones === null}::boolean
                           or md5(zone) in (select jsonb_array_elements_text(
                   (${JSON.stringify(filter.zones ?? [])}::text)::jsonb)))
                          and ${inOutline(tx, filter)}`;
        const [totals] = await tx<
          {
            offered: number;
            sold: number;
            bonus: string;
            hectares_sold: string;
            average: string | null;
            high: string | null;
          }[]
        >`
          with ${outline}
          select count(*) filter (where status is not null)::int as offered,
                 count(*) filter (where status = 'ACCEPTED')::int as sold,
                 coalesce(sum(bonus) filter (where status = 'ACCEPTED'), 0)::text as bonus,
                 coalesce(sum(hectares) filter (where status = 'ACCEPTED'), 0)::text as hectares_sold,
                 round(sum(bonus) filter (where status = 'ACCEPTED')
                       / nullif(sum(hectares) filter (where status = 'ACCEPTED'), 0), 2)::text as average,
                 max(dollars_per_hectare) filter (where status = 'ACCEPTED')::text as high
          from petro.land_sale_parcels
          where ${rights}
            and (${filter.since}::date is null or sale_date >= ${filter.since}::date)
            and (${filter.until ?? null}::date is null or sale_date < ${filter.until ?? null}::date)`;
        const [next] = await tx<{ sale_date: string; parcels: number }[]>`
          with ${outline}
          select sale_date::text as sale_date, count(*)::int as parcels
          from petro.land_sale_parcels
          where status is null and ${rights}
            and sale_date >= (now() at time zone 'America/Edmonton')::date
          group by sale_date order by sale_date limit 1`;
        const sales = await tx<
          { sale_date: string; parcels: number; sold: number; held: boolean }[]
        >`
          with ${outline}
          select sale_date::text as sale_date, count(*)::int as parcels,
                 count(*) filter (where status = 'ACCEPTED')::int as sold,
                 coalesce(bool_or(status is not null), false) as held
          from petro.land_sale_parcels
          where ${rights}
          group by sale_date order by sale_date desc`;
        const quarters = await tx<{ quarter: string; bonus: string; sold: number }[]>`
          with ${outline}
          select to_char(date_trunc('quarter', sale_date), 'YYYY"-Q"Q') as quarter,
                 sum(bonus)::text as bonus, count(*)::int as sold
          from petro.land_sale_parcels
          where status = 'ACCEPTED' and ${rights}
          group by 1 order by 1`;
        return {
          offered: totals?.offered ?? 0,
          sold: totals?.sold ?? 0,
          bonus: totals?.bonus ?? '0',
          hectaresSold: totals?.hectares_sold ?? '0',
          averagePerHectare: totals?.average ?? null,
          highPerHectare: totals?.high ?? null,
          nextSale: next ? { date: next.sale_date, parcels: next.parcels } : null,
          sales: sales.map((s) => ({
            date: s.sale_date,
            parcels: s.parcels,
            sold: s.sold,
            held: s.held,
          })),
          quarters: quarters.map((q) => ({ quarter: q.quarter, bonus: q.bonus, sold: q.sold })),
        };
      });
    },
  };
}

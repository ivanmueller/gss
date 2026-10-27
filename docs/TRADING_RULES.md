# Canonical trading domain rules

All engine implementations must follow this file; do not change rules without golden-number tests.

# 5. Canonical domain language and calculations

## 5.1 Fundamental concepts

- **Counterparty:** Legal/commercial organization or person; can act as buyer, seller, broker or carrier.
- **Facility:** Geocoded physical location of pickup/delivery; multiple facilities can belong to one counterparty.
- **Seller offer:** A seller-originated request for a price for grain being sold by that seller; may be firm or indicative. The workspace order book calls it an **ask**.
- **Buyer bid:** A buyer-originated price for the grain that buyer is willing to purchase; may be firm or indicative.
- **Quote revision:** Immutable economic record of price, currency, quantity, time, specification and delivery basis.
- **Trade scenario:** Reproducible saved assessment; not a contract or execution.
- **Trade:** Contractually negotiated transaction, introduced in subsequent phases behind approval controls.

A facility's `buyer` or `seller` role is not exclusive: some organizations buy and sell depending on product and market.

## 5.2 Mandatory data on every quotation

`id`, `organization_id`, `facility_id`, `counterparty_id`, `side` (`BID`/`OFFER`), `commodity_id`, `grade_id` or recorded equivalent quality spec, `raw_price`, `currency`, `unit`, `delivery_basis`, `quote_status`, `source_type`, `source_reference`, `quoted_at`, `valid_from`, `valid_until`, `delivery_window_start`, `delivery_window_end`, `quantity_min_mt`, `quantity_max_mt`, `recorded_by`, `revision_number` and change metadata. Required fields may be explicitly `UNKNOWN` only where the system labels a quote non-actionable.

For freight and landed costs, store responsibility and applicability (which leg or service is included in a quote) to avoid double-counting freight already included in a delivered bid/offer. Quality/grade compatibility and delivery timing are validated before margin is classified as actionable.

## 5.3 Numeric rules

- Use PostgreSQL `numeric` and a decimal arithmetic library (`decimal.js` or equivalent) in the trading engine. **Do not use JavaScript floating-point money arithmetic.**
- Internal canonical quantity: metric tonnes (`MT`); store original quoted quantity and unit unchanged as well.
- Internal reporting currency for first release: CAD; store source currency and the exact FX `CAD per 1 USD` conversion factor used.
- Currency unit must have explicit pair and direction, `USD/CAD = CAD per USD`. If converting a USD price to CAD: `CAD_price = USD_price × CAD_per_USD`.
- FX reference (owner's decision, 2026-10-27, `docs/DECISIONS.md`): the Bank of Canada's daily USD/CAD rate. A rate more than four calendar days old is stale; USD prices are then not converted and scenarios needing them are blocked.
- A `USD/bushel` quote cannot normalize without a vetted commodity-specific and applicable contractual pounds-per-bushel convention. The conversion value, source and version must be snapshotted.
- Distinguish U.S. short ton (`2,000 lb`), metric tonne (`1,000 kg`), and other vendor-specific units.
- Freight quoted per load requires an actual contract payload assumption to convert to per-MT; do not infer payload from truck class alone.
- Quantities, rates and totals retain working precision; round only at explicit reporting or settlement boundaries. On screen, converted amounts are rounded to cents, half away from zero; ranking, spreads and sums use the exact amounts.
- Negative margin is valid and displayed plainly. Unavailable margin is **null plus an error**, never zero.

## 5.4 Baseline economics

For a simple purchase-origin/sell-destination movement with all values normalized to CAD/MT of grain delivered:

```
Revenue_CAD_per_delivered_MT
 = buyer_bid_USD_per_MT * CAD_per_USD

Gross_margin_CAD_per_delivered_MT
 = Revenue - seller_cost - incremental_freight - handling
   - border_cost - other_incremental_costs

Scenario_gross_margin_CAD
 = Gross_margin_CAD_per_delivered_MT * delivered_quantity_MT
```

The production engine must separately model **loaded/purchased quantity** and **delivered/saleable quantity** when shrink, dockage, wastage or quality adjustment is nonzero. Then total economics must use purchase quantity for purchase-side costs and delivered/saleable quantity for sales revenue; do not simply deduct an arbitrary loss factor from margin. V1 defaults loss to zero **only as an explicit user-approved scenario assumption**. Financing, hedging, inventory carrying costs, taxes, company overhead, credit/default risk, and other costs are excluded unless explicitly modeled. Accordingly this is an **indicative gross contribution**, not net profit or booked P&L.

### Golden acceptance fixture (synthetic, not a live trade)

| Input | Value |
|---|---:|
| Seller offer | CAD 820.00 / MT |
| Buyer bid | USD 725.00 / MT |
| FX | CAD 1.360000 / USD 1 |
| Freight | CAD 105.00 / delivered MT |
| Handling and border | CAD 12.00 / delivered MT |
| Other incremental costs | CAD 3.00 / delivered MT |
| Delivered quantity | 42.000 MT |
| Assumed loss | 0.000 MT |
| Revenue in CAD | 725 × 1.36 = CAD 986.00 / MT |
| Total modeled cost | 820 + 105 + 12 + 3 = CAD 940.00 / MT |
| Expected gross margin | **CAD 46.00 / MT** |
| Scenario gross contribution | **CAD 1,932.00** |

Reject the scenario as `BLOCKED_INCOMPLETE` when FX, required freight, or unit normalization is missing; do not replace with zero. If quotes are indicative, scenario output is also indicative even if arithmetic is complete.

### Mandatory calculation warnings

Quote expired; quote withdrawn; nonmatching commodity/grade; uncertain quality specs; insufficient volume; non-overlapping delivery windows; unmatched delivery basis; missing or low-confidence freight; ambiguous unit conversion; FX quote missing/stale; customs/duties not determined; costs double-counted; scenario P&L excludes financing/hedge risk. Blocking errors are distinct from warnings.

## 5.5 Tradability gate

A scenario is *mathematically calculable* only when every required input is known and normalized. It is *potentially actionable* only when quotes are affirmatively designated firm/current by authorized users, quality and delivery terms match, quantity is available, freight and border assumptions are confirmed, and human verification/approval has occurred. No automation executes a physical trade.


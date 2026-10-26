# Acceptance criteria and golden fixtures

These tests are requirements, not a claim that tests have been written or passed.

# 14. Test strategy and non-negotiable edge cases

| Test class | Minimum cases |
|---|---|
| Quote validity | Firm/current vs indicative; midnight expiration across local time zones; withdrawn/revised quote |
| Unit normalizer | CAD/MT, USD/MT, USD/bushel with explicit commodity lb/bu; reject missing factors; U.S. short tons |
| FX | Source direction; CAD per USD vs inverse; 0 or negative invalid; stale/manual FX warnings |
| Pricing math | Synthetic CAD 46/MT fixture; negative margin; fractional tonne; decimal rounding; quantity loss |
| Quantity | Offer/bid volumes not matched; min > requested; purchase vs saleable metric tonnes |
| Basis | Ex-farm vs delivered; included freight not charged twice; unknown terms block actionable ranking |
| Quality | Incompatible grade/protein/moisture specifications block matches |
| Time | Delivery windows no overlap; quote expired on one side |
| Authorization | Anonymous, forbidden role, cross-tenant ID guessed, cross-tenant map query/export/document URL |
| Durability | Saved scenario keeps source quote revision, FX, fee, conversion factor and engine version after inputs change |
| Import | Duplicate files, invalid units, malformed CSV, incompatible dates, partial row failures, provenance |
| UI | Keyboard navigation, map/table filtering, very small viewport, missing locations |
| Deployment | Fresh migration, staging smoke, rollback and backup restore rehearsal |

Financial tests compare exact decimal output strings and explicitly defined rounding, not fuzzy JS float tolerances. Every bug involving money, authorization or trade status becomes a permanent regression fixture.


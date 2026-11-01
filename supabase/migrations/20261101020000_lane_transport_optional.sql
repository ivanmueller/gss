-- A lane's truck or rail only when stated (the owner's answer of 2026-11-01,
-- docs/DECISIONS.md): "Neither unless stated. So if it's not stated don't assume." A lane
-- may now be saved without a transport (null, shown as not stated); truck, rail or both
-- only when the person or the spreadsheet says so. The check on its values stays as it was
-- (null passes it), and changing it to or from not stated goes through the same update
-- grant, policies, trigger and audit.

alter table app.carrier_lanes alter column transport drop not null;

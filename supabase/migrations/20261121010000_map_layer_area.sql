-- F-240: each map layer belongs to one side of the platform, grain or oil and gas (the owner,
-- 2026-11-18: "oil and gas has its own layers"). The grain maps offer only grain layers, the
-- oil and gas map (map.torvenco.com) only oil and gas layers. Layers added before this change
-- are grain. Admins choose the area when adding a layer and may change it later; the existing
-- policies (members read, org admins add and change), the keep trigger (a removed layer stays
-- unchanged) and the audit trigger cover it.

alter table app.map_layers
  add column area text not null default 'grain' check (area in ('grain', 'oil_gas'));

grant update (area) on app.map_layers to app_api;
